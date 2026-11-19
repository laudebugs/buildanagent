// The smallest Pi agent: create a session, prompt it, read the answer, dispose it.
// Docs: sdk.md "SDK", "Session lifecycle", "Subscribing to events"
import { check, fauxAssistantMessage, fauxSession, fauxText } from "./lib/faux.ts";

// #region hello
const { session, faux } = await fauxSession([fauxAssistantMessage(fauxText("Hello from Pi."))]); // book:note faux
const events: string[] = [];
session.subscribe((e) => events.push(e.type));
try {
  await session.prompt("Say hello."); // book:note prompt
  check(session.getLastAssistantText() === "Hello from Pi.", "getLastAssistantText() returns the final answer");
  check(faux.state.callCount === 1, "one model request for a text-only answer");
  check(events.includes("message_update") && events.includes("message_end"), "streams message_update then message_end");
  check(events.at(-1) === "agent_settled", "agent_settled is the last event of the run");
  check(
    JSON.stringify(session.getActiveToolNames()) === // book:note tools
      JSON.stringify(["read", "bash", "edit", "write"]),
    "default active tools are read, bash, edit, write",
  );
} finally {
  session.dispose();
}
// #endregion
