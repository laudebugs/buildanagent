// A delete reaches the log: the calls that wrote or returned a record go to the purge list, a targeted purge rewrites
// each session that holds them so no session file keeps the fact, every rewritten session still rebuilds, and the
// retention purge reads the same list.
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { clearPurgeMarks, readPurgeMarks } from "@buildanagent/harness/memory";
import { fileMemoryFiles } from "@buildanagent/harness/memory/node";
import { listSessions, openSession, PURGED_TEXT, purgeSession, type SessionKey } from "@buildanagent/harness/session";
import { pruneSessions } from "@buildanagent/harness/session/jsonl";
import { describe, test } from "vitest";
import { counter, fileBackend } from "../session/session-helpers.js";
import { project, results, type Setup, testClock, turn } from "./helpers.js";

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

function setupOf() {
  const root = project();
  mkdirSync(join(root, ".agents/memory"), { recursive: true });
  const backend = fileBackend();
  const setup: Setup = { root, files: fileMemoryFiles(root), clock: testClock().now, ...backend };
  return { setup, dir: backend.dir as string };
}

/** Every file under `dir`, recursively, with its text. */
function filesUnder(dir: string): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push({ path, text: readFileSync(path, "utf8") });
  }
  return found;
}

/** Writes the record in s1, reads it with the memory tool and with `read` in s2, and deletes it in s3. */
async function writeReadDelete(setup: Setup) {
  await turn(setup, key("s1"), [{ name: "memory", input: CREATE }], { prefix: "a" });
  const read = await turn(
    setup,
    key("s2"),
    [
      { name: "memory", input: { command: "view", path: CREATE.path } },
      { name: "read", input: { path: CREATE.path } },
    ],
    {
      prefix: "b",
      // The fake sandbox keeps its files in memory, so it is given the record's file for the built-in read to find.
      sandboxFiles: { [CREATE.path]: readFileSync(join(setup.root, CREATE.path), "utf8") },
    },
  );
  const deleted = await turn(setup, key("s3"), [{ name: "memory", input: { command: "delete", path: CREATE.path } }], {
    prefix: "d",
  });
  return { read, deleted };
}

describe("a delete reaches the log", () => {
  test("after a delete and a targeted purge, no session file holds the fact, and each rewritten session rebuilds", async () => {
    const { setup, dir } = setupOf();
    const { read, deleted } = await writeReadDelete(setup);
    assert.ok(results(read.model).get("b1")?.text.includes(FACT));
    assert.ok(results(read.model).get("b2")?.text.includes(FACT), "the built-in read returned the record's file");
    assert.ok(results(deleted.model).get("d1")?.text.startsWith("Deleted"));
    const sessions = join(dir, "sessions");
    assert.ok(
      filesUnder(sessions).some((file) => file.text.includes(FACT)),
      "the log holds the fact before the purge",
    );

    const marks = await readPurgeMarks(setup.files);
    assert.deepEqual(marks.map((mark) => `${mark.tool} ${mark.callId}`).sort(), ["memory a1", "memory b1", "read b2"]);
    const purged: string[] = [];
    for (const id of ["s1", "s2", "s3"]) {
      const result = await purgeSession({ ...setup, key: key(id), marks, newId: counter(id) });
      if (result.purged) purged.push(id);
    }
    assert.deepEqual(purged, ["s1", "s2"], "the session that only deleted held nothing to purge");
    for (const file of filesUnder(sessions)) assert.ok(!file.text.includes(FACT), file.path);
    const listed: string[] = [];
    for await (const summary of listSessions(setup.store, "ada")) listed.push(summary.sessionId);
    assert.deepEqual(listed.sort(), ["s1", "s2", "s3"], "a purged session is still listed by its id");
    for (const id of ["s1", "s2", "s3"]) {
      const session = await openSession({ store: setup.store, index: setup.index, key: key(id) });
      const context = await session.toContext();
      assert.ok(context.messages.length > 0, id);
      assert.ok(!JSON.stringify(context).includes(FACT), id);
    }
    const again = await purgeSession({ ...setup, key: key("s1"), marks });
    assert.equal(again.purged, false, "a purged session has nothing left to purge");
    await clearPurgeMarks(setup.files, marks);
    assert.deepEqual(await readPurgeMarks(setup.files), []);
  });

  test("a purged entry keeps its base fields and reads the purge text where the content was", async () => {
    const { setup } = setupOf();
    await writeReadDelete(setup);
    const marks = await readPurgeMarks(setup.files);
    const before: unknown[] = [];
    for await (const entry of setup.store.load(key("s2"))) before.push(entry);
    await purgeSession({ ...setup, key: key("s2"), marks });
    const session = await openSession({ store: setup.store, index: setup.index, key: key("s2") });
    const after = await session.path();
    const result = after.find((entry) => entry.type === "tool_result" && entry.callId === "b1");
    assert.equal(
      result?.type === "tool_result" && result.content[0]?.type === "text" && result.content[0].text,
      PURGED_TEXT,
    );
    const base = (entry: unknown) => {
      const { id, parentId, timestamp, type, origin } = entry as Record<string, unknown>;
      return { id, parentId, timestamp, type, origin };
    };
    const ids = new Set(after.map((entry) => entry.id));
    assert.deepEqual(
      after.map(base),
      (before as never[]).filter((entry) => ids.has((entry as { id: string }).id)).map(base),
    );
  });

  test("a fork that continues a purged file is purged first, which copies the shared part, and a revert's chain is rewritten whole", async () => {
    const { setup, dir } = setupOf();
    await turn(setup, key("s1"), [{ name: "memory", input: CREATE }], { prefix: "a" });
    const s1 = await openSession({ ...setup, key: key("s1"), newId: counter("f") });
    const end = (await s1.path()).at(-1)?.id as string;
    const fork = await s1.fork(end);
    await fork.close();
    await s1.revert(end);
    await s1.close();
    await turn(setup, key("s1"), [], { prefix: "r" });
    await turn(setup, key("s3"), [{ name: "memory", input: { command: "delete", path: CREATE.path } }], {
      prefix: "d",
    });
    const marks = await readPurgeMarks(setup.files);
    await assert.rejects(
      purgeSession({ ...setup, key: key("s1"), marks }),
      (error) => isHarnessError(error) && error.code === "session_conflict" && error.message.includes("f1"),
    );
    const forked = await purgeSession({ ...setup, key: key("f1"), marks });
    assert.ok(forked.purged);
    const own = await purgeSession({ ...setup, key: key("s1"), marks });
    assert.ok(own.purged && own.files.length === 2, "the first file and the revert's file are both rewritten");
    for (const file of filesUnder(join(dir, "sessions"))) assert.ok(!file.text.includes(FACT), file.path);
    for (const id of ["s1", "f1"]) {
      const session = await openSession({ store: setup.store, index: setup.index, key: key(id) });
      assert.ok((await session.toContext()).messages.length > 0, id);
    }
  });

  test("the retention purge reports the marks it removed with their sessions, and an archive the sessions that still hold them", async () => {
    const { setup, dir } = setupOf();
    await writeReadDelete(setup);
    const marks = await readPurgeMarks(setup.files);
    const later = () => new Date(Date.now() + 400 * 86_400_000);
    const archived = await pruneSessions({
      dir: join(dir, "sessions"),
      userId: "ada",
      retention: { days: 30, action: "archive" },
      now: later,
      marks,
    });
    assert.deepEqual(archived.markedArchives?.sort(), ["s1", "s2"]);
    const purged = await pruneSessions({
      dir: join(dir, "sessions"),
      userId: "ada",
      retention: { days: 30, action: "purge" },
      now: later,
      marks,
    });
    assert.deepEqual(purged.purged.sort(), ["s1", "s2", "s3"]);
    assert.deepEqual(purged.purgedMarks?.map((mark) => mark.callId).sort(), ["a1", "b1", "b2"]);
    const without = await pruneSessions({
      dir: join(dir, "sessions"),
      userId: "ada",
      retention: { days: 30, action: "purge" },
      now: later,
    });
    assert.equal(without.purgedMarks, undefined, "without marks the result is as it was");
  });
});
