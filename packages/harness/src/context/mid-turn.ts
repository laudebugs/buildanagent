/**
 * Layer 4: compact inside a turn. The SDK's loop keeps the run's whole transcript, so a compaction in the middle of a
 * run cannot shorten it; it changes the view every later model call of the run reads. The first call that would push the
 * context past a share of the window summarises the span before a verbatim tail, writes a `compaction` entry, and from
 * then on the view is the summary, the tail and what the run adds. Later turns rebuild the same view from the log.
 */
import type { Message } from "@buildanagent/gateway";
import type { SessionEntry } from "@buildanagent/protocol";
import type { ContextEvent } from "@buildanagent/sdk";
import { contextWithStarts, summaryMessage } from "../session/rebuild.js";
import type { Session } from "../session/session.js";
import { estimate } from "./estimate.js";
import { withoutSignedReasoning } from "./mask.js";
import type { Compacted, CompactInput } from "./summarize.js";
import type { AppendEntry, CompactionLog } from "./types.js";

/** What a turn lends the layer once its writer exists: a way to write entries and to wait for the ones queued. */
export interface MidTurnBindings {
  readonly append: AppendEntry;
  /** Resolves once every entry the run has produced so far is in the log. */
  readonly settle: () => Promise<void>;
}

/** Runs one compaction with the policy's settings filled in. */
export type RunCompaction = (
  input: Pick<CompactInput, "path" | "append" | "signal" | "layer" | "force" | "view">,
) => Promise<Compacted | undefined>;

/** What the layer did to the run's transcript: the summary, where the kept tail starts, and how long the transcript was. */
interface Applied extends Compacted {
  readonly length: number;
}

/** The view after a compaction: the summary, then the kept tail, without signed reasoning the compaction made stale. */
function viewAfter(applied: Applied, messages: readonly Message[]): readonly Message[] {
  const tail = messages.slice(applied.keptFrom).flatMap((message, i) => {
    // Blocks the run wrote after the compaction were made under this view and stay; the older ones go.
    if (message.role !== "assistant" || applied.keptFrom + i >= applied.length) return [message];
    const trimmed = withoutSignedReasoning(message);
    return trimmed === undefined ? [] : [trimmed];
  });
  return [summaryMessage(applied.summary), ...tail];
}

/** One turn's mid-turn compaction. It compacts at most once, and only when `enabled`. */
export class MidTurn {
  readonly #session: Session;
  readonly #enabled: boolean;
  readonly #limitTokens: number;
  readonly #compact: RunCompaction;
  readonly #log: CompactionLog | undefined;
  #bindings: MidTurnBindings | undefined;
  #applied: Applied | undefined;
  #tried = false;

  constructor(options: {
    session: Session;
    enabled: boolean;
    limitTokens: number;
    compact: RunCompaction;
    log: CompactionLog | undefined;
  }) {
    this.#session = options.session;
    this.#enabled = options.enabled;
    this.#limitTokens = options.limitTokens;
    this.#compact = options.compact;
    this.#log = options.log;
  }

  attach(bindings: MidTurnBindings): void {
    this.#bindings = bindings;
  }

  /** Whether this turn has compacted, so the caller drops the last response's usage from its estimates. */
  get applied(): boolean {
    return this.#applied !== undefined;
  }

  /** The messages the next model call starts from: the run's own, or the compacted view of them. */
  async view(event: ContextEvent): Promise<readonly Message[]> {
    if (this.#applied === undefined && !(await this.#compactNow(event))) return event.messages;
    return viewAfter(this.#applied as Applied, event.messages);
  }

  async #compactNow(event: ContextEvent): Promise<boolean> {
    const bindings = this.#bindings;
    if (!this.#enabled || this.#tried || bindings === undefined) return false;
    if (estimate(event.system, event.messages, event.lastUsage) <= this.#limitTokens) return false;
    this.#tried = true;
    await bindings.settle();
    const path: readonly SessionEntry[] = await this.#session.path();
    const { context, starts } = contextWithStarts(path);
    if (context.messages.length !== event.messages.length) {
      this.#log?.({ layer: "mid_turn", event: "skipped", detail: "the log and the run's transcript do not line up" });
      return false;
    }
    const done = await this.#compact({
      path,
      append: bindings.append,
      signal: event.signal,
      layer: "mid_turn",
      force: true,
      view: { system: event.system, messages: event.messages, starts, lastUsage: event.lastUsage },
    });
    if (done === undefined) return false;
    this.#applied = { ...done, length: event.messages.length };
    return true;
  }
}
