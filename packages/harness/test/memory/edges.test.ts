// The memory extension's edges: a refused folder never fails endSession(), a renewal keeps a task record's session,
// a mark no session held for 30 days leaves the purge list, other tools' results that hold a record are marked
// whatever their input names, and a delete in one session never blanks another session's call that reused its id.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { clearPurgeMarks, memoryExtension, parseRecord, readPurgeMarks } from "@buildanagent/harness/memory";
import { fileMemoryFiles } from "@buildanagent/harness/memory/node";
import { openSession, purgeSession, type SessionKey } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { describe, test } from "vitest";
import { memoryBackend } from "../session/memory-backend.js";
import { DAY_MS, project, results, type Setup, START, tempDir, testClock, turn } from "./helpers.js";

const FACT = "The staging database is reset every Friday at 18:00 UTC.";
const CREATE = {
  command: "create",
  path: ".agents/memory/staging.md",
  subject: "Staging resets",
  fact: FACT,
  source: "docs/ops.md:40",
  type: "project",
};
const key = (sessionId: string): SessionKey => ({ userId: "ada", sessionId });

function setupOf(clock = testClock()): Setup & { advance: (days: number) => void } {
  const root = project();
  mkdirSync(join(root, ".agents/memory"), { recursive: true });
  return { root, files: fileMemoryFiles(root), clock: clock.now, advance: clock.advance, ...memoryBackend() };
}

const recordAt = (root: string, name: string) => {
  const path = join(root, ".agents/memory", name);
  return existsSync(path) ? parseRecord(readFileSync(path, "utf8")) : undefined;
};

describe("endSession()", () => {
  test("a memory folder that is a link makes endSession() return, as the index does", async () => {
    const root = project();
    mkdirSync(join(root, ".agents"));
    symlinkSync(tempDir("harness-outside-"), join(root, ".agents/memory"));
    const memory = memoryExtension({ root, files: fileMemoryFiles(root), registry: createToolRegistry() });
    await memory.endSession();
  });
});

describe("a task record's session", () => {
  test("a renewal in another session keeps the session that wrote it, whose end still expires it", async () => {
    const setup = setupOf();
    const task = { ...CREATE, path: ".agents/memory/task.md", subject: "Current step", type: "task" };
    const first = await turn({ ...setup, sessionId: "s1" }, key("s1"), [{ name: "memory", input: task }]);
    const renew = { command: "str_replace", path: task.path, old_str: "Friday", new_str: "Friday" };
    const second = await turn({ ...setup, sessionId: "s2" }, key("s2"), [{ name: "memory", input: renew }]);
    assert.ok(results(second.model).get("c1")?.text.startsWith("Renewed"));
    assert.equal(recordAt(setup.root, "task.md")?.session, "s1");
    await first.memory?.endSession();
    assert.equal(recordAt(setup.root, "task.md")?.expires, setup.clock().toISOString(), "s1's end expired it");
  });
});

describe("marks that no session holds", () => {
  test("an unmatched mark leaves the purge list after 30 days, and an unmatched mark with no date is dated first", async () => {
    const setup = setupOf();
    await turn(setup, key("s1"), [{ name: "memory", input: CREATE }], { prefix: "a" });
    await turn(setup, key("s2"), [{ name: "memory", input: { command: "delete", path: CREATE.path } }], {
      prefix: "d",
    });
    const marks = await readPurgeMarks(setup.files);
    assert.equal(marks.length, 1);
    assert.equal(marks[0]?.at, new Date(START).toISOString(), "a mark is dated as it joins the purge list");
    const undated = { runId: "r0", callId: "old", tool: "memory" };
    await setup.files.write(".purge.json", JSON.stringify([...marks, undated]));
    const unmatched = await readPurgeMarks(setup.files);
    setup.advance(29);
    await clearPurgeMarks(setup.files, [], { unmatched, clock: setup.clock });
    const kept = await readPurgeMarks(setup.files);
    assert.equal(kept.length, 2, "29 days on, both stay");
    assert.equal(kept.find((mark) => mark.callId === "old")?.at, setup.clock().toISOString());
    setup.advance(1);
    await clearPurgeMarks(setup.files, [], { unmatched, clock: setup.clock });
    assert.deepEqual(
      (await readPurgeMarks(setup.files)).map((mark) => mark.callId),
      ["old"],
      "the dated mark went at 30 days, and the one dated by the first clear waits its own 30",
    );
    await clearPurgeMarks(setup.files, [], { clock: () => new Date(START + 400 * DAY_MS) });
    assert.equal((await readPurgeMarks(setup.files)).length, 1, "a mark no pass called unmatched never ages out");
  });
});

describe("the tracker", () => {
  test("a result that holds the fact is marked whatever the input names, and a wrapped fact still matches", async () => {
    const setup = setupOf();
    await turn(setup, key("s1"), [{ name: "memory", input: CREATE }], { prefix: "a" });
    const wrapped = FACT.replace("every Friday", "every\nFriday");
    await turn(
      setup,
      key("s2"),
      [
        { name: "web", input: {} },
        { name: "read", input: { path: "notes.txt" } },
        { name: "read", input: { path: "wrapped.txt" } },
        { name: "read", input: { path: "short.txt" } },
      ],
      {
        prefix: "b",
        // An untrusted tool whose input names nothing, returning the record's file as `cd .agents && cat memory/x.md` would.
        web: readFileSync(join(setup.root, CREATE.path), "utf8"),
        sandboxFiles: { "notes.txt": `copied: ${FACT}`, "wrapped.txt": wrapped, "short.txt": "Friday" },
      },
    );
    await turn(setup, key("s3"), [{ name: "memory", input: { command: "delete", path: CREATE.path } }], {
      prefix: "d",
    });
    const marked = (await readPurgeMarks(setup.files)).map((mark) => `${mark.tool} ${mark.callId}`).sort();
    assert.ok(marked.includes("web b1"), "a result that holds the record's file, whatever the input named");
    assert.ok(marked.includes("read b2"), "a file outside the memory folder that holds the fact");
    assert.ok(marked.includes("read b3"), "the fact wrapped across lines");
    assert.ok(!marked.includes("read b4"), "a short text is not taken for the fact");
  });
});

describe("a provider that reuses call ids", () => {
  test("a delete in one session leaves another session's call with the same id alone", async () => {
    const setup = setupOf();
    const other = {
      ...CREATE,
      path: ".agents/memory/other.md",
      subject: "Cache",
      fact: "The cache warms at 05:00 UTC daily.",
    };
    await turn(setup, key("s1"), [{ name: "memory", input: CREATE }], { prefix: "a" });
    await turn(setup, key("s2"), [{ name: "memory", input: other }], { prefix: "a" });
    await turn(setup, key("s3"), [{ name: "memory", input: { command: "delete", path: CREATE.path } }], {
      prefix: "d",
    });
    const marks = await readPurgeMarks(setup.files);
    assert.deepEqual(
      marks.map((mark) => mark.callId),
      ["a1"],
    );
    assert.deepEqual(await purgeSession({ ...setup, key: key("s2"), marks }), { purged: false });
    const s2 = await openSession({ store: setup.store, index: setup.index, key: key("s2") });
    assert.ok(JSON.stringify(await s2.path()).includes(other.fact), "the other session's record is still in its log");
    assert.ok((await purgeSession({ ...setup, key: key("s1"), marks })).purged);
  });
});
