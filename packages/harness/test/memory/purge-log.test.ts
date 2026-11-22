// The targeted purge over a log written by hand: it reports the spill files and the entries it could not scrub, and it
// matches a mark by its run where the log shows the run, so a provider that reuses call ids blanks only the marked call.
import assert from "node:assert/strict";
import {
  type EntryInput,
  memoryIndex,
  memoryStore,
  PURGED_TEXT,
  type PurgeMark,
  purgeSession,
  type SessionKey,
} from "@buildanagent/harness/session";
import { describe, test } from "vitest";
import { header, memoryLock } from "../session/session-helpers.js";

const FACT = "The staging database is reset every Friday at 18:00 UTC.";
const MODEL = { api: "test", provider: "test", id: "m" };
const key = (sessionId: string): SessionKey => ({ userId: "ada", sessionId });

/** The entries of one entry body after another, each the child of the one before. */
function chain(bodies: readonly Record<string, unknown>[]): EntryInput[] {
  const entries: EntryInput[] = [header()];
  bodies.forEach((body, at) => {
    entries.push({
      id: `e${at + 1}`,
      parentId: entries[at]?.id ?? null,
      timestamp: "2026-01-01T00:00:01.000Z",
      origin: "harness",
      ...body,
    } as EntryInput);
  });
  return entries;
}

const call = (callId: string, input: unknown = { command: "create", fact: FACT }) => ({
  type: "message_block",
  messageId: `m-${callId}`,
  role: "assistant",
  index: 0,
  block: { type: "tool_call", callId, name: "memory", input },
});
const result = (callId: string, extra: Record<string, unknown> = {}) => ({
  type: "tool_result",
  callId,
  tool: "memory",
  content: [{ type: "text", text: `Created: ${FACT}` }],
  isError: false,
  trust: "untrusted",
  ...extra,
});
const start = (runId: string) => ({ type: "turn_start", runId, mode: "run", system: "You help." });
const end = (runId: string) => ({ type: "turn_end", runId, stopReason: "completed", steps: 1 });
const said = (messageId: string, text: string) => ({
  type: "message_block",
  messageId,
  role: "assistant",
  index: 0,
  block: { type: "text", text },
});

function backend() {
  return { store: memoryStore(), index: memoryIndex(), lock: memoryLock() };
}

async function textOf(log: ReturnType<typeof backend>, sessionId: string): Promise<string> {
  const pointer = (await log.index.get(key(sessionId))) ?? sessionId;
  const found: unknown[] = [];
  for await (const entry of log.store.load(key(pointer))) found.push(entry);
  return JSON.stringify(found);
}

describe("the targeted purge reports what it left", () => {
  test("it returns the spill file of a purged result, and the summary and the assistant's text after the call", async () => {
    const log = backend();
    await log.store.append(
      key("s1"),
      chain([
        said("m0", "Before the call, nothing of the fact."),
        start("r1"),
        call("call_1"),
        result("call_1", { spill: { path: "/spill/ada/s1/r1.0.call_1.txt", bytes: 90_000 } }),
        said("m2", `Noted: ${FACT}`),
        end("r1"),
        {
          type: "compaction",
          layer: "summarize",
          summary: `The user said ${FACT}`,
          firstKeptEntryId: "e5",
          tokensBefore: 10,
          tokensAfter: 5,
          model: MODEL,
          promptVersion: "1",
          usageEntryId: "e5",
        },
      ]),
    );
    const marks: PurgeMark[] = [{ runId: "r1", callId: "call_1", tool: "memory" }];
    const purged = await purgeSession({ ...log, key: key("s1"), marks });
    assert.ok(purged.purged);
    assert.deepEqual(purged.spills, ["/spill/ada/s1/r1.0.call_1.txt"]);
    assert.deepEqual(purged.residual, { compactions: ["e7"], assistantBlocks: ["e5"] });
    const text = await textOf(log, "s1");
    assert.ok(text.includes(PURGED_TEXT));
    assert.ok(!text.includes("r1.0.call_1.txt"), "the result loses its spill reference");
  });
});

describe("a mark matches by its run where the log shows it", () => {
  test("two sessions that reuse a call id: a mark from one run leaves the other session's call alone", async () => {
    const log = backend();
    for (const [sessionId, runId] of [
      ["s1", "r1"],
      ["s2", "r2"],
    ] as const) {
      await log.store.append(key(sessionId), chain([start(runId), call("call_1"), result("call_1"), end(runId)]));
    }
    const marks: PurgeMark[] = [{ runId: "r1", callId: "call_1", tool: "memory" }];
    assert.deepEqual(await purgeSession({ ...log, key: key("s2"), marks }), { purged: false });
    assert.ok((await textOf(log, "s2")).includes(FACT), "the other run's call keeps its content");
    const own = await purgeSession({ ...log, key: key("s1"), marks });
    assert.ok(own.purged && own.entries === 2);
    assert.ok(!(await textOf(log, "s1")).includes(FACT));
  });

  test("a call resumed in a later run is purged whole by a mark from either run", async () => {
    const log = backend();
    await log.store.append(
      key("s1"),
      chain([start("r1"), call("call_1"), end("r1"), start("r2"), result("call_1"), end("r2")]),
    );
    const marks: PurgeMark[] = [{ runId: "r2", callId: "call_1", tool: "memory" }];
    const purged = await purgeSession({ ...log, key: key("s1"), marks });
    assert.ok(purged.purged && purged.entries === 2, "the call's input and its result both lose their content");
    assert.ok(!(await textOf(log, "s1")).includes(FACT));
  });

  test("a call no open run covers matches by its id and tool alone", async () => {
    const log = backend();
    await log.store.append(key("s1"), chain([call("call_1"), result("call_1")]));
    const marks: PurgeMark[] = [{ runId: "another-run", callId: "call_1", tool: "memory" }];
    const purged = await purgeSession({ ...log, key: key("s1"), marks });
    assert.ok(purged.purged && purged.entries === 2);
  });
});
