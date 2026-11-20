/**
 * `costGuard()`: an AI SDK language-model middleware that refuses a call before it is sent when the spend so far plus
 * the call's projected cost would pass a USD cap (D9's rule, which our SDK's loop applies too). In `ai` 7.0.162 each
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
import {
  gatewayContext,
  gatewayUsage,
  messageKeys,
  priceResponse,
  type ReportedCall,
  responsePartChars,
  toolsKey,
} from "./estimate.js";
import type { Spend } from "./spend.js";

/** One call the guard let through, reported once its cost is known. */
export interface GuardedCall {
  /** The model's `provider`, as the AI SDK names it, such as `anthropic.messages`. */
  readonly provider: string;
  readonly modelId: string;
  /** The most the call could cost, which the guard checked against the cap before sending it. */
  readonly projectedUsd: number;
  /**
   * What the call cost, priced from the usage its response reported, or `null` when the response reported none or the
   * call was interrupted before it did. The guard then adds `projectedUsd` to the spend instead. After a response
   * without usage it also refuses every later call with `unknown_price`; after an interrupted call it carries on.
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
  readonly tools: string;
  readonly projectedUsd: number;
}

/** A finished call whose prompt a later call may continue. */
interface Recorded {
  readonly model: string;
  readonly prompt: readonly string[];
  readonly tools: string;
  readonly usage: Usage;
  readonly responseChars: number;
}

/** How an admitted call ended. */
type Outcome =
  /** The response ended, with the usage it reported, if any, and the characters it returned. */
  | { readonly kind: "finished"; readonly usage: ModelUsage | undefined; readonly responseChars: number }
  /** The call was aborted, or its stream cancelled or broken, before the response reported its usage. */
  | { readonly kind: "interrupted" };

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
  // The dollars this guard has added to the spend, so a read that raced an `add()` still counts it.
  private addedUsd = 0;
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

  /**
   * Reads the spend, and returns a function that gives the spend so far plus what calls in flight may cost. Call that
   * function in the same synchronous step that reserves, so no other call's reservation slips in between. A call that
   * settles while `get()` runs has already given back its reservation, and a store need not show its `add()` to a read
   * that started first, so what this guard added meanwhile counts too; a read that did see the add then counts it
   * twice, which errs towards refusing.
   */
  private async readSpend(model: InnerModel): Promise<() => number> {
    const added = this.addedUsd;
    const stored: unknown = await this.options.spend.get();
    if (typeof stored !== "number" || !Number.isFinite(stored) || stored < 0) {
      const message = `the Spend returned ${String(stored)}, not a number of dollars, so the USD cap can't be checked`;
      this.refuse("unknown_price", model, message, Number.NaN, null);
    }
    return () => stored + this.reservedUsd + (this.addedUsd - added);
  }

  /** The prompt index and usage of the latest finished call that this request continues, if any. */
  private reported(model: string, prompt: readonly string[], tools: string, roles: Prompt): ReportedCall | undefined {
    for (const call of this.recent.toReversed()) {
      // Another model counts tokens with another tokenizer, and new tools add input the usage doesn't hold.
      const continues =
        call.model === model &&
        call.tools === tools &&
        call.prompt.length < prompt.length &&
        roles[call.prompt.length]?.role === "assistant" &&
        call.prompt.every((key, i) => key === prompt[i]);
      if (continues) return { index: call.prompt.length, usage: call.usage, responseChars: call.responseChars };
    }
    return undefined;
  }

  /** Projects the call and reserves its projection against the cap, or throws `BudgetExceeded`. */
  async admit(model: InnerModel, params: CallOptions): Promise<Admitted> {
    const { capUsd, catalog = defaultCatalog } = this.options;
    const id = `${model.provider}/${model.modelId}`;
    const entry = findCatalogEntry(catalog, catalogProvider(model), model.modelId);
    if (entry === undefined) {
      const message = `the price of ${id} is unknown, so a call under a USD cap can't be checked; add the model to the catalog`;
      this.refuse("unknown_price", model, message, (await this.readSpend(model))(), null);
    }
    const prompt = messageKeys(params.prompt);
    const tools = toolsKey(params.tools);
    const continued = this.reported(id, prompt, tools, params.prompt);
    const context = gatewayContext(params.prompt, params.tools, continued);
    const tokens = {
      inputTokens: estimateInputTokens(context),
      maxOutputTokens: params.maxOutputTokens ?? entry.maxOutputTokens,
    };
    const projectedUsd = projectCost(tokens, entry).total;
    const spentNow = await this.readSpend(model);
    // Everything from here to the reservation runs in one step, so a call admitted meanwhile is seen.
    const spent = spentNow();
    if (this.unknown !== undefined) this.refuse("unknown_price", model, this.unknown, spent, projectedUsd);
    if (projectedUsd === null) {
      const message = `the catalog has no rate for ${id} at ${tokens.inputTokens} input tokens, so a call under a USD cap can't be checked`;
      this.refuse("unknown_price", model, message, spent, null);
    }
    if (spent + projectedUsd > capUsd) {
      const message = `${id} was not called: ${dollars(spent)} is spent or in flight and the call can cost up to ${dollars(projectedUsd)}, which passes the cap of ${dollars(capUsd)}`;
      this.refuse("budget_exceeded", model, message, spent, projectedUsd);
    }
    this.reservedUsd += projectedUsd;
    return { model, entry, prompt, tools, projectedUsd };
  }

  /** Gives back a call's reservation when the provider rejected it with an error, which leaves no usage to price. */
  private release(call: Admitted): void {
    this.reservedUsd -= call.projectedUsd;
  }

  /**
   * Records a call's cost and gives back its reservation. A response that reported no usage, or usage the catalog
   * can't price, is charged its projection and stops the guard. An interrupted call is charged its projection, the most
   * it could have cost, and the guard carries on. If the `Spend` fails to record the cost, the guard stops too.
   */
  async settle(call: Admitted, outcome: Outcome): Promise<void> {
    const { provider, modelId } = call.model;
    let costUsd: number | null = null;
    if (outcome.kind === "finished") {
      const usage = gatewayUsage(outcome.usage);
      costUsd = usage.unreported ? null : priceResponse(usage, call.entry);
      if (costUsd === null) {
        this.unknown = usage.unreported
          ? `a call to ${provider}/${modelId} reported no usage, so the spend is unknown and the USD cap can't be checked`
          : `the catalog can't price the usage a call to ${provider}/${modelId} reported, so the USD cap can't be checked`;
      } else {
        const { prompt, tools } = call;
        this.recent.push({
          model: `${provider}/${modelId}`,
          prompt,
          tools,
          usage,
          responseChars: outcome.responseChars,
        });
        if (this.recent.length > RECENT_CALLS) this.recent.shift();
      }
    }
    const charged = costUsd ?? call.projectedUsd;
    try {
      await this.options.spend.add(charged);
      this.addedUsd += charged;
    } catch (error) {
      this.unknown = `the Spend failed to record what a call to ${provider}/${modelId} cost, so the spend is unknown and the USD cap can't be checked`;
      throw error;
    } finally {
      this.reservedUsd -= call.projectedUsd;
    }
    this.options.onCallCost?.({ provider, modelId, projectedUsd: call.projectedUsd, costUsd });
  }

  /**
   * Settles a call that threw before it returned a response. One its abort signal stopped may have been billed for
   * what the provider generated before it stopped, so it is charged its projection; any other error is a request the
   * provider rejected, which gives the reservation back. The caller sees the call's own error either way.
   */
  async failed(call: Admitted, params: CallOptions): Promise<void> {
    if (params.abortSignal?.aborted !== true) {
      this.release(call);
      return;
    }
    // A failed add has already stopped the guard; the abort is the error worth reporting.
    await this.settle(call, { kind: "interrupted" }).catch(() => undefined);
  }
}

/** The characters of text, reasoning and tool calls in a generated response. */
function generatedChars(content: readonly { readonly type: string }[]): number {
  return content.reduce((sum, part) => sum + responsePartChars(part), 0);
}

/**
 * Passes a stream through unchanged and settles the call once: with the `finish` part's usage when the stream ends, or
 * as interrupted when it is cancelled or errors before its `finish` part.
 */
function settledStream(
  stream: ReadableStream<StreamPart>,
  settle: (outcome: Outcome) => Promise<void>,
): ReadableStream<StreamPart> {
  let usage: ModelUsage | undefined;
  let finished = false;
  let responseChars = 0;
  let settled: Promise<void> | undefined;
  const once = (outcome: Outcome) => {
    settled ??= settle(outcome);
    return settled;
  };
  const ended = (): Outcome => ({ kind: "finished", usage, responseChars });
  return stream.pipeThrough(
    new TransformStream<StreamPart, StreamPart>({
      transform(part, controller) {
        responseChars += responsePartChars(part);
        if (part.type === "finish") {
          usage = part.usage;
          finished = true;
        }
        controller.enqueue(part);
      },
      flush: () => once(ended()),
      cancel: () => once(finished ? ended() : { kind: "interrupted" }),
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
        await ledger.failed(call, params);
        throw error;
      }
      await ledger.settle(call, {
        kind: "finished",
        usage: result.usage,
        responseChars: generatedChars(result.content),
      });
      return result;
    },
    wrapStream: async ({ doStream, params, model }) => {
      const call = await ledger.admit(model, params);
      let result: Awaited<ReturnType<typeof doStream>>;
      try {
        result = await doStream();
      } catch (error) {
        await ledger.failed(call, params);
        throw error;
      }
      return { ...result, stream: settledStream(result.stream, (outcome) => ledger.settle(call, outcome)) };
    },
  };
}
