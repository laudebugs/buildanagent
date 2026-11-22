import type { Message, Model } from "@buildanagent/gateway";
import type { CompactionEntry, Origin, SessionEntry } from "@buildanagent/protocol";
import type { Interceptors } from "@buildanagent/sdk";
import type { Session } from "../session/session.js";
import type { EntryInput, SessionKey } from "../session/store.js";

/** The five context layers, cheapest first. A layer can be switched off by name in `ContextPolicyOptions.layers`. */
export type LayerName = "write_cap" | "mask" | "summarize" | "mid_turn" | "overflow_retry";

/** Where the full text of a capped tool result goes, so the model keeps a pointer and nothing is lost. */
export interface SpillStore {
  /** Stores `text` for one tool call of one session and returns the path the model and the log name it by. */
  write(key: SessionKey, callId: string, text: string): Promise<string>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An entry as the policy hands it to the harness's writer: the writer adds its id, parent, time and origin. */
export type EntryBody = DistributiveOmit<EntryInput, "id" | "parentId" | "timestamp" | "origin">;
/** Writes one entry at the log's end and returns it as stored. */
export type AppendEntry = (origin: Origin, body: EntryBody) => Promise<SessionEntry>;

/** What `hooks.beforeCompact` receives: the span about to be summarised. */
export interface CompactEvent {
  /** The messages the summary replaces: the whole discarded span, never its tail only. */
  readonly span: readonly Message[];
  /** The estimated tokens of the context before compaction. */
  readonly tokens: number;
  readonly focus?: string;
}

/** Hooks around a compaction. */
export interface ContextHooks {
  /** Returns `{ summary }` to use that text in place of the model's; the entry then records `promptVersion: "hook"`. */
  readonly beforeCompact?: (event: CompactEvent) => Promise<{ readonly summary?: string } | undefined>;
  /** Called with the `compaction` entry after it is written. */
  readonly afterCompact?: (entry: CompactionEntry) => Promise<void>;
}

/** What a layer reports when it compacts or declines to. */
export interface CompactionRecord {
  readonly layer: LayerName;
  readonly event: "compacted" | "skipped";
  readonly detail: string;
}

/** Called with each record of a compaction or a skipped one. */
export type CompactionLog = (record: CompactionRecord) => void;

/** The settings of the summary layer. */
export interface SummarizeSettings {
  /** The tokens of the newest messages kept verbatim. Default 20,000. */
  readonly tailTokens?: number;
  /** The characters of each tool result the summary call reads. Default 2,000. */
  readonly toolOutputChars?: number;
  /** The output limit of the summary call. Default 4,096. */
  readonly maxOutputTokens?: number;
  /** The model that writes the summary. Default the turn's model. */
  readonly model?: Model;
  /** A hint that steers what the summary keeps; recorded on the entry. */
  readonly focus?: string;
  /**
   * The session's spend cap in US dollars, counted over the entries from the root to HEAD, so a branch left behind by a
   * re-run is not counted. A summary whose projected cost would pass it is skipped. It guards the summary call only: it
   * keeps no room for the turn's own next call, and a summary a hook wrote is not checked. Default none.
   */
  readonly capUsd?: number;
}

/** The settings of `createContextPolicy()`. */
export interface ContextPolicyOptions {
  /** Where the write cap keeps a result's full text. Required unless the `write_cap` layer is off. */
  readonly spill?: SpillStore;
  /**
   * The most bytes a tool result takes in the log, JSON escaping and a 1 KiB reserve for the entry's own fields
   * included, so the model reads a little less than this. Default 65,536, the stores' entry bound.
   */
  readonly writeCapBytes?: number;
  /** How masking shortens an older tool result and how often its cutoff moves. Defaults 500 characters, 8 messages. */
  readonly mask?: { readonly keepChars: number; readonly stepMessages: number };
  /** The token budget `fill()` reports against. Default the model's window less 16,384, at most 200,000. */
  readonly budgetTokens?: number;
  /** The share of the window at which the mid-turn layer compacts. Default 0.9. */
  readonly midTurnRatio?: number;
  /** The summary layer's settings. */
  readonly summarize?: SummarizeSettings;
  /** Hooks around a compaction. */
  readonly hooks?: ContextHooks;
  /** Told of each compaction and each one skipped. */
  readonly log?: CompactionLog;
  /** A layer set to `false` has no effect. Every layer defaults to on. */
  readonly layers?: Partial<Record<LayerName, boolean>>;
}

/** How full the request view is: an estimate, so a display can warn before the window does. */
export interface ContextFill {
  readonly tokens: number;
  readonly budget: number;
  readonly window: number;
}

/** What the policy knows about one turn. */
export interface TurnContextOptions {
  readonly session: Session;
  readonly model: Model;
  /** Called with the fill after each request view is built. */
  readonly onFill?: (fill: ContextFill) => void;
  /** True when the caller supplied the turn's history, so the log's entries do not describe the context. */
  readonly ownHistory?: boolean;
}

/** The policy's hooks and state for one turn. */
export interface TurnContext {
  /** The write cap in `afterToolCall` and masking in `transformContext`. */
  readonly interceptors: Pick<Interceptors, "transformContext" | "afterToolCall">;
  /** Where the write cap put a call's full text, or `undefined` when the call was not capped. */
  spillOf(callId: string): { readonly path: string; readonly bytes: number } | undefined;
  /**
   * Summarises the session when its context is over the budget, before the turn's input is written. Returns whether it
   * wrote a `compaction` entry.
   */
  compact(input: {
    readonly path: readonly SessionEntry[];
    readonly append: AppendEntry;
    /** Stops the summary call when the turn is aborted. */
    readonly signal?: AbortSignal;
  }): Promise<boolean>;
  /**
   * Gives the turn's writer to the layers that write inside a run, once it exists: `append` writes an entry and
   * `settle` waits for every entry the run has produced so far.
   */
  attach(bindings: { readonly append: AppendEntry; readonly settle: () => Promise<void> }): void;
  /**
   * Called when a model call failed because the request was too large. Compacts once, whatever the size, and returns
   * whether it wrote a `compaction` entry; the caller then tries the call again on the rebuilt context.
   */
  onOverflow(input: {
    readonly path: readonly SessionEntry[];
    readonly append: AppendEntry;
    readonly signal?: AbortSignal;
  }): Promise<boolean>;
  /** The fill after the latest request view. */
  fill(): ContextFill;
}

/** A context policy: the layers, built once and applied to every turn of a harness. */
export interface ContextPolicy {
  /** Starts the layers for one turn of one session. */
  forTurn(options: TurnContextOptions): TurnContext;
}
