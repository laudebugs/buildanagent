// The permission pipeline's rules for a support agent: a read runs, a page asks a person and deleting files is always
// refused. The pipeline decides each call and writes one `permission_decision` entry for it to the session it is given.
import {
  createPermissionPipeline,
  type Decision,
  type PermissionMode,
  type PermissionPipeline,
  type PolicySession,
} from "@buildanagent/harness/permissions";
import { createToolRegistry } from "@buildanagent/harness/tools";

// #region rules
/** The agent's rules. `interactive` says whether a person can answer a question. */
export function supportPipeline(options: { mode: PermissionMode; interactive: boolean }): PermissionPipeline {
  return createPermissionPipeline(
    {
      mode: options.mode,
      interactive: options.interactive,
      policyVersion: "support-1",
      allow: [{ tool: "lookup_customer" }],
      ask: [{ tool: "escalate", reason: "An on-call engineer will be paged." }],
      deny: [{ tool: "bash", commandPrefix: ["rm"], reason: "Deleting files is never allowed." }],
    },
    createToolRegistry(),
  );
}
// #endregion

/** One call as the model made it, decided with the entries the pipeline writes going to `session`. */
export function decide(
  pipeline: PermissionPipeline,
  session: PolicySession,
  tool: string,
  input: unknown = {},
): Promise<Decision> {
  const call = { callId: `call-${tool}`, tool, input, initiator: "model" } as const;
  return pipeline.decide(call, { session, hostContext: undefined, entries: [] });
}

/** The decisions for a read, a page and a delete, then for a tool no rule names. */
export async function decideCalls(pipeline: PermissionPipeline, session: PolicySession) {
  // #region decide
  const read = await decide(pipeline, session, "lookup_customer");
  const page = await decide(pipeline, session, "escalate", { reason: "Checkout is down." });
  const remove = await decide(pipeline, session, "bash", { command: "rm -rf build" });
  const other = await decide(pipeline, session, "export_data");
  // #endregion
  return { read, page, remove, other };
}
