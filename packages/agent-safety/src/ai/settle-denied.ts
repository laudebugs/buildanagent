/**
 * `settleDeniedApprovals()`: marks UI tool parts whose approved call `signedToolApproval()` denied on resume as denied,
 * so a chat that stores UI messages doesn't replay the approval. `ai` streams a `tool-output-denied` chunk for such a
 * call, but Cloudflare `agents` 0.33.0 treats that chunk as a replay once the stored part is `approval-responded`, so
 * `AIChatAgent` keeps the part as approved and without a result. The next model step that converts it then fails with
 * `AI_MissingToolResultsError`. The `ai` import is type-only.
 */
import type { UIMessage } from "ai";

/**
 * Returns `messages` with every tool part whose call id is in `denied`, and whose state is still
 * `approval-responded`, moved to `output-denied` with its approval marked `approved: false`, as `ai`'s UI message
 * types and validator require for that state. The approval keeps its id and the person's reason. Messages it doesn't
 * change are returned as they are, so compare the result with `messages` to know whether to store it.
 *
 * Collect `denied` from `signedToolApproval()`'s `onRejected`, and keep it where your chat keeps its messages.
 */
export function settleDeniedApprovals<MESSAGE extends UIMessage>(
  messages: readonly MESSAGE[],
  denied: ReadonlySet<string>,
): MESSAGE[] {
  return messages.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      const tool = part as { toolCallId?: unknown; state?: unknown; approval?: object };
      if (typeof tool.toolCallId !== "string" || tool.state !== "approval-responded" || !denied.has(tool.toolCallId)) {
        return part;
      }
      changed = true;
      // `ai` 7.0.162 validates an `output-denied` part's approval with `approved: z.literal(false)`.
      return { ...part, state: "output-denied", approval: { ...tool.approval, approved: false } };
    });
    // The new part keeps its tool type, input and approval id; only its state and the approval's verdict change.
    return changed ? ({ ...message, parts } as MESSAGE) : message;
  });
}
