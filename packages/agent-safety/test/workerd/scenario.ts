// The contract between the Cloudflare tests, which run in Node, and their Workers, approval-agent.ts, cost-agent.ts
// and interrupted-agent.ts, which run in workerd. It holds types only, so the Node side type-checks without the
// Workers globals.

/** What a scenario changes between the pause and the approval. */
export type Change =
  | "none"
  | "signature"
  | "key-id"
  | "input"
  | "forget"
  | "policy"
  | "needs-approval-signature"
  | "retry-after-forget";

/** What the agent reports after a scenario. */
export interface Report {
  /** Each stored refund part, as `<call id>:<state>`. */
  readonly states: string[];
  /** The inputs the refund tool's `execute` ran with. */
  readonly executed: unknown[];
  /** The cause of each denial `onRejected` received. */
  readonly denials: string[];
  /** Every error a turn reported. */
  readonly errors: string[];
  /** How many requests the model received. */
  readonly modelCalls: number;
}

/** What the Worker returns for a scenario: the report, the output chunks the client received, and what the model read. */
export interface Played extends Report {
  readonly streamed: string[];
  readonly outcomes: { kind: string; reason: string }[];
}

/** What the interrupted-write Worker returns: what the agent stored for the interrupted call, and what the model read. */
export interface Repaired {
  /** How the turn that followed the repair ended. */
  readonly status: string;
  /** The stored `send_email` part after the repair. */
  readonly stored: { readonly state: string; readonly output?: unknown; readonly errorText?: string | undefined };
  /** The output of each tool result in the model's requests. */
  readonly modelRead: unknown[];
  /** How often `send_email` ran, which must be never. */
  readonly sent: number;
}

/** What the cost-guard Worker returns: how far the capped turn got and the refusal that stopped it. */
export interface Capped {
  /** How the turn ended. */
  readonly status: string;
  /** How many requests the model received. */
  readonly modelCalls: number;
  /** What the turn had spent when it ended, in USD. */
  readonly spentUsd: number;
  /** The refusal `streamText`'s `onError` received, or `null` when nothing was refused. */
  readonly refusal: { readonly code: string; readonly spentUsd: number; readonly projectedUsd: number | null } | null;
  /** The message of the error that ended the turn, for an agent whose turn result carries the message and not the error. */
  readonly error?: string | null;
  /** The projection and cost of each call the guard let through. */
  readonly calls: { readonly projectedUsd: number; readonly costUsd: number | null }[];
}
