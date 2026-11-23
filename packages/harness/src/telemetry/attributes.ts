/**
 * The attribute names the log projection writes that the OpenTelemetry GenAI conventions do not define. The
 * conventions' own names come from `@buildanagent/sdk/otel`, so the live observer and this projection share one
 * module; ours sit in the `buildanagent.` namespace, outside anything a future convention could take.
 */

/** The `buildanagent.*` attribute names, keyed by what each holds. */
export const BUILDANAGENT_ATTRIBUTES = Object.freeze({
  /** The commit of the conventions repository whose names the spans follow; written on the session's root span. */
  semconvGenaiCommit: "buildanagent.semconv.genai.commit",
  /** The price of the call, or the sum over a turn or a session, in US dollars. Left out when the price is unknown. */
  costUsd: "buildanagent.cost.usd",
  /** Where the price comes from: `provider`, `catalog` or `unknown`. */
  costBasis: "buildanagent.cost.basis",
  /** What made the call: `model_call`, `summary` or `judge`. */
  usageSource: "buildanagent.usage.source",
  /** The SDK run a turn belongs to. */
  runId: "buildanagent.run.id",
  /** `run` for a turn that began with input, `continue` for one that resumed a paused turn. */
  turnMode: "buildanagent.turn.mode",
  /** How the turn's run ended. */
  turnStopReason: "buildanagent.turn.stop_reason",
  /** How many model steps the turn took. */
  turnSteps: "buildanagent.turn.steps",
  /** The id of the signed request an `approval_wait` span covers. */
  approvalRequestId: "buildanagent.approval.request_id",
  /** `allow`, `deny` or `answer`, from the entry that resolved the request. */
  approvalDecision: "buildanagent.approval.decision",
  /** `true` on a tool call that host code made with no model step. */
  toolCodeCall: "buildanagent.tool.code_call",
  /** The ids of the log entries that hold the content, written at content level `refs` instead of the content. */
  contentRef: "buildanagent.content.ref",
  /** `true` on a span whose closing entry is not in the log, so its end is the log's last timestamp. */
  unfinished: "buildanagent.span.unfinished",
} as const);
