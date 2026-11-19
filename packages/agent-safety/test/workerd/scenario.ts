// The contract between test/cloudflare-approval.test.ts, which runs in Node, and the Worker in approval-agent.ts,
// which runs in workerd. It holds types only, so the Node side type-checks without the Workers globals.

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
