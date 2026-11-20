/**
 * The capability strings `run_start` carries (agent-SDK guide §10, after Claude's runtime capability list). A peer
 * that is versioned apart from the SDK, such as a harness over RPC, reads them to learn what this release can do
 * without parsing its version. Each string names one behaviour and its contract version; a breaking change to that
 * behaviour gets a new string, such as `steering_v2`, beside the old one or in place of it.
 */

/**
 * The SDK's capability strings, in the order the README lists them. Every `run_start` event carries this list as
 * `capabilities`.
 */
export const CAPABILITIES: readonly string[] = Object.freeze([
  "abort_v1",
  "steering_v1",
  "approval_pause_v1",
  "clarification_pause_v1",
  "continue_run_v1",
  "blocking_approvals_v1",
  "usd_budget_v1",
  "progress_policy_v1",
  "depth_cap_v1",
  "output_tool_v1",
  "write_outcomes_v1",
  "turn_retries_v1",
  "raw_events_v1",
]);
