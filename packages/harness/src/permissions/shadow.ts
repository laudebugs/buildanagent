import { canonicalInputHash, type ToolDefinition } from "@buildanagent/sdk";
import type { RegisteredTool } from "../tools/types.js";
import type { PermissionMode, PolicySession } from "./types.js";

const SHADOW_RESULT = "Shadow mode: this call was recorded and not run.";

/**
 * A `ToolWrapper` for `registry.definitions()`. In `shadow` mode it replaces each tool's `execute` with one that writes
 * a `shadow_call` entry and returns a fixed result, so the tool never runs. In any other mode it returns the tool as
 * registered. The mode is read when the wrapper is called, so build the turn's definitions after it is set.
 */
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
