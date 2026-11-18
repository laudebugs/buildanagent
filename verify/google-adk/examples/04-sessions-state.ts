// Sessions and state on InMemorySessionService: unprefixed keys are per session, `user:` keys are shared by
// a user's sessions, `app:` keys by every user of the app, and `temp:` keys are dropped after the
// invocation. Tools write state through their Context, appendEvent applies an event's stateDelta, and a
// Session object fetched from the service is a copy, so mutating it changes nothing.
// Docs: docs/sessions/state.md (prefixes at lines 40-80, appendEvent at lines 490-535, the warning at 656).
import type { Context } from "@google/adk";
import { createEvent, createEventActions, FunctionTool, InMemoryRunner, LlmAgent } from "@google/adk";
import { z } from "zod";
import { afterTool, callTool, check, ScriptedLlm, say, turn } from "./lib/check.ts";

const remember = new FunctionTool({
  name: "remember",
  description: "Remember a note.",
  parameters: z.object({ note: z.string() }),
  execute: ({ note }, ctx?: Context) => {
    const state = ctx?.state;
    state?.set("last_note", note);
    state?.set("user:notes", [...(state.get<string[]>("user:notes") ?? []), note]);
    state?.set("app:total", (state.get<number>("app:total") ?? 0) + 1);
    state?.set("temp:scratch", "only for this invocation");
    return { saved: true, sawTemp: state?.get("temp:scratch") };
  },
});
const model = new ScriptedLlm((req) => (afterTool(req) ? say("noted") : callTool("remember", { note: "hi" })));
const agent = new LlmAgent({ name: "notes", model, instruction: "Take notes.", tools: [remember] });
const runner = new InMemoryRunner({ agent, appName: "notes" });
const svc = runner.sessionService;
const get = (userId: string, sessionId: string) => svc.getSession({ appName: "notes", userId, sessionId });

const s1 = await svc.createSession({ appName: "notes", userId: "alice" });
const first = await turn(runner, s1.id, "note this", "alice");
const after1 = await get("alice", s1.id);
check(after1?.state.last_note === "hi", "a tool's context.state.set persists as session state");
check(after1 && !("temp:scratch" in after1.state), "temp: keys are not persisted after the invocation");
check(JSON.stringify(first).includes("only for this invocation"), "temp: keys are readable within the invocation");

const s2 = await svc.createSession({ appName: "notes", userId: "alice" });
await turn(runner, s2.id, "note this", "alice");
const after2 = await get("alice", s2.id);
check(
  after2?.state.last_note === "hi" && JSON.stringify(after2?.state["user:notes"]) === '["hi","hi"]',
  "user: keys are shared across a user's sessions",
);

const s3 = await svc.createSession({ appName: "notes", userId: "bob" });
const bob = await get("bob", s3.id);
check(
  bob?.state["app:total"] === 2 && bob?.state["user:notes"] === undefined,
  "app: keys are shared by every user; user: keys are not",
);
check(bob?.state.last_note === undefined, "unprefixed keys belong to one session");

// appendEvent with a stateDelta is the documented way to change state outside an agent run.
const s4 = await svc.createSession({ appName: "notes", userId: "carol", state: { task_status: "idle" } });
await svc.appendEvent({
  session: s4,
  event: createEvent({
    invocationId: "inv_manual",
    author: "system",
    actions: createEventActions({ stateDelta: { task_status: "active", "temp:validation_needed": true } }),
  }),
});
const after4 = await get("carol", s4.id);
check(after4?.state.task_status === "active", "appendEvent applies the event's stateDelta");
check(after4 && !("temp:validation_needed" in after4.state), "appendEvent drops temp: keys, as the docs' example says");

// Mutating a fetched Session does not write through.
const fetched = await get("carol", s4.id);
if (fetched) fetched.state.task_status = "hacked";
check(
  (await get("carol", s4.id))?.state.task_status === "active",
  "mutating a fetched Session's state does not change the stored session",
);

// Event history and listing.
check((after1?.events.length ?? 0) >= 4, "the session keeps every event of the run (user, call, response, answer)");
const listed = await svc.listSessions({ appName: "notes", userId: "alice" });
check(listed.sessions.length === 2, "listSessions returns a user's sessions");
