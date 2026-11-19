import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Shared setup for the verified Pi examples: an in-memory session wired to the faux model.
import {
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  type CreateAgentSessionOptions,
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { live, liveSteps } from "./live.ts";
import { recordedSteps } from "./transcript.ts";

export { fauxAssistantMessage, fauxText, fauxToolCall };

/** Create a session whose model replies with the scripted steps, in order. */
export async function fauxSession(steps: FauxResponseStep[], options: Partial<CreateAgentSessionOptions> = {}) {
  const faux = fauxProvider();
  // recordedSteps() returns the steps unchanged unless the runner preloaded the transcript recorder. A live run
  // (scripts/live/) answers each step from a real provider instead of the script.
  faux.setResponses(recordedSteps(live ? liveSteps(live) : steps));
  // authPath and modelsPath default to files under ~/.pi/agent; keep both out of the run.
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
    ...options,
  });
  return { session, faux };
}

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}
