import { canonicalInputHash, type ToolDefinition } from "@buildanagent/sdk";
import type { RegisteredTool } from "../tools/types.js";
import type { PermissionMode, PolicySession } from "./types.js";

const SHADOW_RESULT = "Shadow mode: this call was recorded and not run.";

/** The wrapper behind `PermissionPipeline.shadowWrapper()`, which owns the mode it is given. */
export function shadowWrapper(
  session: PolicySession,
  mode: PermissionMode,
): (tool: RegisteredTool) => ToolDefinition<unknown, unknown, unknown> {
  return (tool) => {
    if (mode !== "shadow") return tool.definition;
    return {
      ...tool.definition,
      async execute(input, ctx) {
        await session.append({
          type: "shadow_call",
          callId: ctx.callId,
          tool: tool.canonicalName,
          inputHash: await canonicalInputHash(input),
        });
        return { content: [{ type: "text", text: SHADOW_RESULT }] };
      },
    };
  };
}
