// Behavior: a session persists under the client's base directory; after the first client stops, a
// new client can resumeSession(id) and the next model call carries the earlier turn. Custom tools are
// not persisted: a resume that doesn't pass them again offers the model none of them.
// Docs: docs/features/session-persistence.md, nodejs/README.md "resumeSession" and "listSessions".
import { approveAll, CopilotClient, defineTool } from "@github/copilot-sdk";
import { check, MODEL, mockProvider, mockRequests } from "./lib/harness.ts";

const remember = defineTool("note", { description: "Take a note", handler: () => "noted" });
const baseDirectory = `${process.env.HOME}/copilot-data`;

const first = new CopilotClient({ useLoggedInUser: false, baseDirectory });
const s1 = await first.createSession({
  model: MODEL,
  provider: mockProvider(),
  onPermissionRequest: approveAll,
  tools: [remember],
});
const id = s1.sessionId;
await s1.sendAndWait({ prompt: "My favourite colour is teal.\nmock-reply: Got it." });
await s1.disconnect();
await first.stop();

const second = new CopilotClient({ useLoggedInUser: false, baseDirectory });
// createSession and resumeSession start the client on demand; listSessions does not.
const early = await second.listSessions().then(
  () => "listed",
  (e: Error) => e.message,
);
check(early === "Client not connected", `listSessions before start() throws (got ${JSON.stringify(early)})`);
await second.start();
const listed = await second.listSessions();
check(
  listed.some((m) => m.sessionId === id),
  "listSessions on a new client finds the stopped session",
);
const s2 = await second.resumeSession(id, { model: MODEL, provider: mockProvider(), onPermissionRequest: approveAll });
check(s2.sessionId === id, "resumeSession returns the same session id");
await s2.sendAndWait({ prompt: "What is my favourite colour?\nmock-reply: Teal." });
const last = mockRequests().at(-1);
const history = JSON.stringify(last?.body.messages);
check(
  history.includes("My favourite colour is teal.") && history.includes("Got it."),
  "the resumed turn carries the first turn's messages",
);
check(!last?.tools?.includes("note"), "the custom tool is gone after a resume without tools");
const events = await s2.getEvents();
check(events.filter((e) => e.type === "user.message").length === 2, "getEvents() returns both user messages");
await s2.disconnect();
await second.stop();
