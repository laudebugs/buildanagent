/**
 * `costGuard()`: an AI SDK language-model middleware that refuses a call before it is sent when the spend so far plus
 * the call's projected cost would pass a USD cap (D9's rule, which B14 applies in our own loop). In `ai` 7.0.162 each
 * step and each retry calls the step model's `doGenerate` or `doStream`, so a wrapped model's middleware sees every
 * provider request. The projection is the gateway's `projectCost()` over the gateway's `estimateInputTokens()`, the
 * formula the SDK's loop uses, so both caps agree on what a call can cost.
 */
import {
  type CatalogEntry,
  defaultCatalog,
  estimateInputTokens,
  findCatalogEntry,
  type PriceCatalog,
  projectCost,
  type Usage,
} from "@buildanagent/gateway";
import type { LanguageModelMiddleware } from "ai";
import { SafetyError } from "../errors.js";
import type { CallOptions, InnerModel, ModelUsage, Prompt, StreamPart } from "./ai-types.js";
import { BudgetExceeded, type BudgetRefusalCode } from "./budget-exceeded.js";
import { gatewayContext, gatewayUsage, messageKeys, priceResponse } from "./estimate.js";
import type { Spend } from "./spend.js";

/** One call the guard let through, reported once its cost is known. */
export interface GuardedCall {
  /** The model's `provider`, as the AI SDK names it, such as `anthropic.messages`. */
  readonly provider: string;
  readonly modelId: string;
  /** The most the call could cost, which the guard checked against the cap before sending it. */
  readonly projectedUsd: number;
  /**
   * What the call cost, priced from the usage its response reported, or `null` when the response reported none. The
   * guard then adds `projectedUsd` to the spend instead and refuses every later call with `unknown_price`.
   */
  readonly costUsd: number | null;
}

/** Options for `costGuard()`. */
export interface CostGuardOptions {
  /** The most the run or session may spend, in USD: a finite number, 0 or more. */
  readonly capUsd: number;
  /** Where the spend is kept. A fresh `memorySpend()` caps one run; a `Spend` the whole session shares caps the session. */
  readonly spend: Spend;
  /** The price catalog to read rates from. Defaults to the gateway's `defaultCatalog`. */
  readonly catalog?: PriceCatalog;
  /**
   * The output limit the guard sets on a call that sets none, and prices that call at. Left out, such a call is
   * priced at the catalog's output limit for the model and sent unchanged.
   */
  readonly maxOutputTokens?: number;
  /** Called after each call the guard let through, once its cost is known. */
  readonly onCallCost?: (call: GuardedCall) => void;
}

/** A call the guard admitted: what it projected and what it holds against the cap until the call settles. */
interface Admitted {
  readonly model: InnerModel;
  readonly entry: CatalogEntry;
  readonly prompt: readonly string[];
  readonly projectedUsd: number;
}

/** A finished call whose prompt a later call may continue. */
interface Recorded {
  readonly prompt: readonly string[];
  readonly usage: Usage;
}

// Enough finished calls to recognise the one a step continues while a few calls run side by side.
const RECENT_CALLS = 8;

function checkOptions(options: CostGuardOptions): void {
  const { capUsd, maxOutputTokens } = options;
  if (typeof capUsd !== "number" || !Number.isFinite(capUsd) || capUsd < 0) {
    throw new SafetyError(
      "invalid_budget",
      `capUsd must be a finite number of dollars, 0 or more, got ${String(capUsd)}`,
    );
  }
  if (maxOutputTokens !== undefined && (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0)) {
    throw new SafetyError(
      "invalid_budget",
      `maxOutputTokens must be a positive integer, got ${String(maxOutputTokens)}`,
    );
  }
}

/** A dollar amount for a message, to six significant digits, so float noise doesn't reach the text. */
function dollars(usd: number): string {
  return `$${Number(usd.toPrecision(6))}`;
}

/** The catalog provider a model's AI SDK provider name stands for: `anthropic.messages` is `anthropic`. */
function catalogProvider(model: InnerModel): string {
  return model.provider.split(".")[0] ?? model.provider;
}

/**
 * The guard's state for one cap. It holds the projections of calls in flight, so calls that run at the same time
 * through one guard share the cap instead of each checking it against the same spend.
 */
class Ledger {
  private reservedUsd = 0;
  private unknown: string | undefined;
  private readonly recent: Recorded[] = [];
  private readonly options: CostGuardOptions;

  constructor(options: CostGuardOptions) {
    this.options = options;
  }

  private refuse(
    code: BudgetRefusalCode,
    model: InnerModel,
    message: string,
    spentUsd: number,
    projectedUsd: number | null,
  ): never {
    throw new BudgetExceeded({
      code,
      message,
      capUsd: this.options.capUsd,
      spentUsd,
      projectedUsd,
      provider: model.provider,
      modelId: model.modelId,
    });
  }

  /** The prompt index and usage of the latest finished call that this prompt continues, if any. */
  private reported(prompt: readonly string[], roles: Prompt): { index: number; usage: Usage } | undefined {
    for (const call of this.recent.toReversed()) {
      const continues =
        call.prompt.length < prompt.length &&
        roles[call.prompt.length]?.role === "assistant" &&
        call.prompt.every((key, i) => key === prompt[i]);
      if (continues) return { index: call.prompt.length, usage: call.usage };
    }
    return undefined;
  }

  /** Projects the call and reserves its projection against the cap, or throws `BudgetExceeded`. */
  async admit(model: InnerModel, params: CallOptions): Promise<Admitted> {
    const { capUsd, catalog = defaultCatalog, spend } = this.options;
    const id = `${model.provider}/${model.modelId}`;
    const entry = findCatalogEntry(catalog, catalogProvider(model), model.modelId);
    if (entry === undefined) {
      this.refuse(
        "unknown_price",
        model,
        `the price of ${id} is unknown, so a call under a USD cap can't be checked; add the model to the catalog`,
        0,
        null,
      );
    }
    const prompt = messageKeys(params.prompt);
    const context = gatewayContext(params.prompt, params.tools, this.reported(prompt, params.prompt));
    const tokens = {
      inputTokens: estimateInputTokens(context),
      maxOutputTokens: params.maxOutputTokens ?? entry.maxOutputTokens,
    };
    const projectedUsd = projectCost(tokens, entry).total ?? Number.POSITIVE_INFINITY;
    const spent = (await spend.get()) + this.reservedUsd;
    // Read after the await, so a call that settled meanwhile is seen.
    if (this.unknown !== undefined) this.refuse("unknown_price", model, this.unknown, spent, projectedUsd);
    if (spent + projectedUsd > capUsd) {
      const message = `${id} was not called: ${dollars(spent)} is spent or in flight and the call can cost up to ${dollars(projectedUsd)}, which passes the cap of ${dollars(capUsd)}`;
      this.refuse("budget_exceeded", model, message, spent, projectedUsd);
    }
    this.reservedUsd += projectedUsd;
    return { model, entry, prompt, projectedUsd };
  }

  /** Gives back a call's reservation when it failed before a response, which providers don't bill. */
  release(call: Admitted): void {
    this.reservedUsd -= call.projectedUsd;
  }

  /** Records a finished call's cost and gives back its reservation. */
  async settle(call: Admitted, reportedUsage: ModelUsage | undefined): Promise<void> {
    const usage = gatewayUsage(reportedUsage);
    const costUsd = usage.unreported ? null : priceResponse(usage, call.entry);
    if (costUsd === null) {
      this.unknown = `a call to ${call.model.provider}/${call.model.modelId} reported no usage, so the spend is unknown and the USD cap can't be checked`;
    } else {
      this.recent.push({ prompt: call.prompt, usage });
      if (this.recent.length > RECENT_CALLS) this.recent.shift();
    }
    try {
      await this.options.spend.add(costUsd ?? call.projectedUsd);
    } finally {
      this.reservedUsd -= call.projectedUsd;
    }
    const { provider, modelId } = call.model;
    this.options.onCallCost?.({ provider, modelId, projectedUsd: call.projectedUsd, costUsd });
  }
}

/** Passes a stream through unchanged and settles the call once, when the stream ends or is cancelled. */
function settledStream(
  stream: ReadableStream<StreamPart>,
  settle: (usage: ModelUsage | undefined) => Promise<void>,
): ReadableStream<StreamPart> {
  let usage: ModelUsage | undefined;
  let settled: Promise<void> | undefined;
  const finish = () => {
    settled ??= settle(usage);
    return settled;
  };
  return stream.pipeThrough(
    new TransformStream<StreamPart, StreamPart>({
      transform(part, controller) {
        if (part.type === "finish") usage = part.usage;
        controller.enqueue(part);
      },
      flush: finish,
      cancel: finish,
    }),
  );
}

/**
 * A language-model middleware that caps what calls through it may spend. Before each call it estimates the input
 * tokens from the request, prices them and the call's output limit with the gateway's `projectCost()`, and throws
 * `BudgetExceeded` without calling the provider if the spend so far plus that projection would pass `capUsd`. A model
 * the catalog has no price for is refused before its first call, code `unknown_price`. After each call it adds the
 * cost of the usage the response reported, read from a stream's `finish` part. Wrap a whole provider with
 * `guardedProvider()`, so a model `prepareStep` picks from it is capped too.
 */
export function costGuard(options: CostGuardOptions): LanguageModelMiddleware {
  checkOptions(options);
  const ledger = new Ledger(options);
  const { maxOutputTokens } = options;
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) =>
      maxOutputTokens === undefined || params.maxOutputTokens !== undefined ? params : { ...params, maxOutputTokens },
    wrapGenerate: async ({ doGenerate, params, model }) => {
      const call = await ledger.admit(model, params);
      let result: Awaited<ReturnType<typeof doGenerate>>;
      try {
        result = await doGenerate();
      } catch (error) {
        ledger.release(call);
        throw error;
      }
      await ledger.settle(call, result.usage);
      return result;
    },
    wrapStream: async ({ doStream, params, model }) => {
      const call = await ledger.admit(model, params);
      let result: Awaited<ReturnType<typeof doStream>>;
      try {
        result = await doStream();
      } catch (error) {
        ledger.release(call);
        throw error;
      }
      return { ...result, stream: settledStream(result.stream, (usage) => ledger.settle(call, usage)) };
    },
  };
}
