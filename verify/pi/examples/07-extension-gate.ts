// An inline extension registers a tool and blocks risky calls from the tool_call event.
// Pi has no built-in permission system: extensions are the gate.
// Docs: extensions.md "tool_call", sdk.md "inline extension", security.md
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { check, fauxAssistantMessage, fauxSession, fauxText, fauxToolCall } from "./lib/faux.ts";

let executed = 0;
const seen: string[] = [];
const cwd = mkdtempSync(join(tmpdir(), "pi-ext-"));
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir: join(cwd, ".pi-agent"),
  extensionFactories: [
    (pi) => {
      pi.registerTool({
        name: "restart_service",
        label: "Restart",
        description: "Restart a production service",
        parameters: Type.Object({ service: Type.String() }),
        execute: async () => {
          executed++;
          return { content: [{ type: "text", text: "restarted" }], details: {} };
        },
      });
      // #region gate
      pi.on("tool_call", async (event) => {
        seen.push(event.toolName); // book:note event
        if (event.toolName === "restart_service") return { block: true, reason: "change freeze" }; // book:note block
        return undefined; // book:note pass
      });
      // #endregion
    },
  ],
});
await resourceLoader.reload();

const { session } = await fauxSession(
  [
    fauxAssistantMessage([fauxToolCall("restart_service", { service: "api" })], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("The restart was blocked.")),
  ],
  { cwd, resourceLoader },
);
try {
  check(session.getActiveToolNames().includes("restart_service"), "extension-registered tool is active");
  await session.prompt("Restart the api service.");
  check(seen.includes("restart_service"), "tool_call fires before the tool executes");
  // #region gate-checks
  check(executed === 0, "returning { block: true } stops execution"); // book:note not-run
  const result = session.messages.find((m) => m.role === "toolResult") as
    | { isError?: boolean; content: unknown }
    | undefined;
  check(
    result?.isError === true && JSON.stringify(result.content).includes("change freeze"),
    "the block reason reaches the model as an error result", // book:note reason
  );
  // #endregion
} finally {
  session.dispose();
}
