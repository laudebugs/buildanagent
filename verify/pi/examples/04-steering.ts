import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Steering and follow-up messages while a run is streaming.
// Docs: sdk.md "Prompting", how-pi-works.md "Agent loop"
import { fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { check, fauxAssistantMessage, fauxText } from "./lib/faux.ts";

// A slow faux model, so the first answer is still streaming when we steer.
const faux = fauxProvider({ tokensPerSecond: 40 });
faux.setResponses([
  fauxAssistantMessage(fauxText("First answer, streaming slowly so the host can steer it mid-run.")),
  fauxAssistantMessage(fauxText("Answer to the steering message.")),
  fauxAssistantMessage(fauxText("Answer to the follow-up.")),
]);
const modelRuntime = await ModelRuntime.create({
  refreshOnCreate: false,
  authPath: join(mkdtempSync(join(tmpdir(), "pi-auth-")), "auth.json"),
  modelsPath: null,
});
modelRuntime.registerNativeProvider(faux.provider);
const { session } = await createAgentSession({
  modelRuntime,
  model: faux.getModel(),
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory(),
  tools: [],
});
try {
  const run = session.prompt("Start.");
  await new Promise((r) => setTimeout(r, 150));
  let rejected = false;
  await session.prompt("Ambiguous.").catch(() => {
    rejected = true;
  });
  check(rejected, "prompt() while streaming, without steer/followUp, rejects");
  check((await session.steer("Steer: be brief.")) === "queued", 'steer() returns "queued"');
  check((await session.followUp("Follow-up: and then?")) === "queued", 'followUp() returns "queued"');
  await run;
  await session.waitForIdle();
  const users = session.messages
    .filter((m) => m.role === "user")
    .map((m) => JSON.stringify(m.content).match(/(Start|Steer|Follow-up)/)?.[1]);
  check(
    JSON.stringify(users) === JSON.stringify(["Start", "Steer", "Follow-up"]),
    "user messages land in order: prompt, steer, follow-up",
  );
  check(faux.state.callCount === 3, "the steer and the follow-up each trigger one more model request");
} finally {
  session.dispose();
}
