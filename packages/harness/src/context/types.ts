import type { Model } from "@buildanagent/gateway";
import type { Interceptors } from "@buildanagent/sdk";
import type { Session } from "../session/session.js";
import type { SessionKey } from "../session/store.js";

/** The five context layers, cheapest first. A layer can be switched off by name in `ContextPolicyOptions.layers`. */
export type LayerName = "write_cap" | "mask" | "summarize" | "mid_turn" | "overflow_retry";

/** Where the full text of a capped tool result goes, so the model keeps a pointer and nothing is lost. */
export interface SpillStore {
  /** Stores `text` for one tool call of one session and returns the path the model and the log name it by. */
  write(key: SessionKey, callId: string, text: string): Promise<string>;
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
}

/** The policy's hooks and state for one turn. */
export interface TurnContext {
  /** The write cap in `afterToolCall` and masking in `transformContext`. */
  readonly interceptors: Pick<Interceptors, "transformContext" | "afterToolCall">;
  /** Where the write cap put a call's full text, or `undefined` when the call was not capped. */
  spillOf(callId: string): { readonly path: string; readonly bytes: number } | undefined;
  /** The fill after the latest request view. */
  fill(): ContextFill;
}

/** A context policy: the layers, built once and applied to every turn of a harness. */
export interface ContextPolicy {
  /** Starts the layers for one turn of one session. */
  forTurn(options: TurnContextOptions): TurnContext;
}
