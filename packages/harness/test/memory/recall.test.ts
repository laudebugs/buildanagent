// Recall and forgetting: a record written in one session leads the next session's first request through the index, a
// read never renews a record, expiry reads only the injected clock, low-trust writes expire first, and with the
// extension left out no memory tool or index reaches the model.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_MAX_LINES, parseRecord } from "@buildanagent/harness/memory";
import { openSession, runTurn } from "@buildanagent/harness/session";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { memoryBackend } from "../session/memory-backend.js";
import { DAY_MS, filesAt, harnessFor, project, results, type Setup, testClock, textOf, turn } from "./helpers.js";

const BUILD = {
  command: "create",
  path: ".agents/memory/build.md",
  subject: "How to build",
  fact: "Run pnpm build from the repository root; the SDK needs the gateway's dist first.",
  source: "AGENTS.md:12",
  type: "project",
};

function setupOf(root = project(), clock = testClock()): Setup & { advance: (days: number) => void } {
  mkdirSync(join(root, ".agents/memory"), { recursive: true });
  const backend = memoryBackend();
  return {
    root,
    files: filesAt(root).files,
    clock: clock.now,
    advance: clock.advance,
    store: backend.store,
    index: backend.index,
    lock: backend.lock,
  };
}

const key = (sessionId: string) => ({ userId: "ada", sessionId });
const view = (path: string) => ({ name: "memory", input: { command: "view", path } });
const recordAt = (root: string, name: string) => {
  const path = join(root, ".agents/memory", name);
  return existsSync(path) ? parseRecord(readFileSync(path, "utf8")) : undefined;
};

/** The first message of the first request the model was sent in a new session. */
async function firstMessage(setup: Setup, sessionId: string): Promise<string> {
  const { model } = await turn(setup, key(sessionId), []);
  return textOf(model.calls[0]?.context.messages[0]);
}

describe("the index", () => {
  test("a record stored in one session leads the next session's first request with its index line", async () => {
    const setup = setupOf();
    const first = await turn(setup, key("s1"), [{ name: "memory", input: BUILD }]);
    assert.equal(results(first.model).get("c1")?.isError, false);
    const text = await firstMessage(setup, "s2");
    assert.ok(text.includes("- How to build (project, trusted): .agents/memory/build.md"), text);
    assert.ok(text.includes("<untrusted-project-context"), "the index is labelled untrusted, as the context files are");
    assert.ok(text.endsWith("Go."), "the user's input follows the index");
    assert.ok(!text.includes(BUILD.fact), "the index holds the subject, never the fact");
  });

  test("an index over 200 records stops at 200 lines and says how many it left out", async () => {
    const setup = setupOf();
    for (let at = 0; at < 250; at += 1) {
      const name = `r${String(at).padStart(3, "0")}.md`;
      writeFileSync(join(setup.root, ".agents/memory", name), record(`Record ${at}`), { flag: "w" });
    }
    const text = await firstMessage(setup, "s1");
    const index = text
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("- Record ") ||
          line.startsWith("Memory index") ||
          line.includes("left out, because the index stops"),
      );
    // The heading, 198 records and the note that names the other 52.
    assert.equal(index.length, MEMORY_INDEX_MAX_LINES);
    assert.ok(index.at(-1)?.includes("52 more records are left out"), String(index.at(-1)));
  });

  test("an index over 25 KiB stops at 25 KiB and says how many it left out", async () => {
    const setup = setupOf();
    for (let at = 0; at < 150; at += 1) {
      writeFileSync(join(setup.root, ".agents/memory", `r${at}.md`), record(`Record ${at} ${"x".repeat(190)}`));
    }
    const text = await firstMessage(setup, "s1");
    const start = text.indexOf("Memory index:");
    const end = text.indexOf("\n</untrusted-project-context", start);
    const index = text.slice(start, end);
    assert.ok(Buffer.byteLength(index) <= MEMORY_INDEX_MAX_BYTES, `${Buffer.byteLength(index)} bytes`);
    assert.ok(Buffer.byteLength(index) > MEMORY_INDEX_MAX_BYTES - 300, "the cap, not the line count, cut it");
    assert.match(index.split("\n").at(-1) ?? "", /^\[\d+ more records are left out/);
  });
});

/** A trusted project record's file, validated at the test clock's start. */
function record(subject: string): string {
  const at = "2026-11-22T09:00:00.000Z";
  return `---\nsubject: ${JSON.stringify(subject)}\nsource: "AGENTS.md:1"\ntype: "project"\ncreated: "${at}"\nvalidated: "${at}"\nexpires: "2027-02-20T09:00:00.000Z"\ntrust: "trusted"\n---\nA fact about ${subject} that is long enough.\n`;
}

describe("expiry reads only the injected clock", () => {
  test("91 days after its last validation a project fact is gone from view and the index, and a read between does not renew it", async () => {
    const setup = setupOf();
    await turn(setup, key("s1"), [{ name: "memory", input: BUILD }]);
    const validated = recordAt(setup.root, "build.md")?.validated;
    setup.advance(45);
    const middle = await turn(setup, key("s2"), [view(".agents/memory/build.md"), view(".agents/memory")]);
    assert.ok(results(middle.model).get("c1")?.text.includes(BUILD.fact));
    assert.equal(recordAt(setup.root, "build.md")?.validated, validated, "a view leaves validated where it was");
    setup.advance(46);
    const late = await turn(setup, key("s3"), [view(".agents/memory/build.md"), view(".agents/memory/")]);
    const late1 = results(late.model).get("c1");
    assert.equal(late1?.isError, true);
    assert.ok(late1?.text.includes("expired"));
    assert.ok(results(late.model).get("c2")?.text.includes("holds no records"));
    assert.ok(!textOf(late.model.calls[0]?.context.messages[0]).includes("How to build"), "the index leaves it out");
  });

  test("a str_replace whose old_str equals new_str renews a record, after which it outlives its first expiry", async () => {
    const setup = setupOf();
    await turn(setup, key("s1"), [{ name: "memory", input: BUILD }]);
    setup.advance(80);
    const same = "pnpm build";
    const renewed = await turn(setup, key("s2"), [
      { name: "memory", input: { command: "str_replace", path: BUILD.path, old_str: same, new_str: same } },
    ]);
    assert.ok(results(renewed.model).get("c1")?.text.startsWith("Renewed"));
    setup.advance(20);
    const later = await turn(setup, key("s3"), [view(BUILD.path)]);
    assert.equal(results(later.model).get("c1")?.isError, false, "100 days after creation, 20 after renewal");
  });

  test("a task record expires when its session ends, and a preference holds after a year", async () => {
    const setup = { ...setupOf(), sessionId: "s1" };
    const task = { ...BUILD, path: ".agents/memory/task.md", subject: "Current step", type: "task" };
    const pref = { ...BUILD, path: ".agents/memory/pref.md", subject: "Answer style", type: "preference" };
    const { memory } = await turn(setup, key("s1"), [
      { name: "memory", input: task },
      { name: "memory", input: pref },
    ]);
    assert.equal(recordAt(setup.root, "task.md")?.session, "s1");
    await memory?.endSession();
    setup.advance(365);
    const text = await firstMessage({ ...setup, sessionId: "s2" }, "s2");
    assert.ok(!text.includes("Current step") && text.includes("Answer style"));
  });
});

describe("trust", () => {
  test("a write after an untrusted tool result is low trust, and expires before a trusted record of its type", async () => {
    const setup = setupOf();
    const low = await turn(setup, key("s1"), [
      { name: "web", input: {} },
      { name: "memory", input: { ...BUILD, path: ".agents/memory/low.md", subject: "From the page" } },
    ]);
    assert.ok(results(low.model).get("c2")?.text.includes("low trust"));
    await turn(setup, key("s2"), [{ name: "memory", input: { ...BUILD, path: ".agents/memory/high.md" } }]);
    const lowRecord = recordAt(setup.root, "low.md");
    const highRecord = recordAt(setup.root, "high.md");
    assert.equal(lowRecord?.trust, "low");
    assert.equal(highRecord?.trust, "trusted");
    assert.ok(Date.parse(lowRecord?.expires ?? "") < Date.parse(highRecord?.expires ?? ""));
    setup.advance(31);
    const text = await firstMessage(setup, "s3");
    assert.ok(!text.includes("From the page") && text.includes("How to build (project, trusted)"));
  });

  test("an untrusted call in the same step as a memory write still makes the write low trust", async () => {
    const setup = setupOf();
    const model = new ScriptedModel([
      {
        usage: {},
        content: [
          { type: "tool_call", callId: "m1", name: "memory", input: BUILD },
          { type: "tool_call", callId: "w1", name: "web", input: {} },
        ],
      },
      { usage: {}, content: [{ type: "text", text: "Done." }] },
    ]);
    const { harness } = await harnessFor(setup, model);
    const session = await openSession({ store: setup.store, index: setup.index, lock: setup.lock, key: key("s1") });
    await runTurn(session, harness, { input: "Go." });
    assert.equal(recordAt(setup.root, "build.md")?.trust, "low");
  });

  test("viewing a low-trust record makes the session's later writes low trust", async () => {
    const setup = setupOf();
    await turn(setup, key("s1"), [
      { name: "web", input: {} },
      { name: "memory", input: { ...BUILD, path: ".agents/memory/low.md" } },
    ]);
    await turn(setup, key("s2"), [view(".agents/memory/low.md"), { name: "memory", input: BUILD }]);
    assert.equal(recordAt(setup.root, "build.md")?.trust, "low");
  });

  test("a renewal or a change in a trusted session keeps a low-trust record low trust", async () => {
    const setup = setupOf();
    await turn(setup, key("s1"), [
      { name: "web", input: {} },
      { name: "memory", input: { ...BUILD, path: ".agents/memory/low.md" } },
    ]);
    const before = recordAt(setup.root, "low.md");
    assert.equal(before?.trust, "low");
    setup.advance(10);
    const fact = BUILD.fact;
    const renewed = await turn(setup, key("s2"), [
      {
        name: "memory",
        input: { command: "str_replace", path: ".agents/memory/low.md", old_str: fact, new_str: fact },
      },
      {
        name: "memory",
        input: { command: "str_replace", path: ".agents/memory/low.md", old_str: "pnpm", new_str: "pnpm" },
      },
    ]);
    assert.ok(results(renewed.model).get("c1")?.text.startsWith("Renewed"));
    const after = recordAt(setup.root, "low.md");
    assert.equal(after?.trust, "low");
    assert.equal(
      Date.parse(after?.expires ?? ""),
      Date.parse(after?.validated ?? "") + 30 * DAY_MS,
      "a renewal gives the low-trust period, not the trusted one",
    );
  });

  test("a write that holds a credential, or a secret the host named, is refused and stored nowhere", async () => {
    const setup = { ...setupOf(), secrets: ["hunter2-database-password"] };
    const shaped = { ...BUILD, fact: "The token is ghp_abcdefghijklmnopqrstuvwxyz0123456789." };
    const named = { ...BUILD, path: ".agents/memory/db.md", source: "the user said hunter2-database-password" };
    const run = await turn(setup, key("s1"), [
      { name: "memory", input: shaped },
      { name: "memory", input: named },
    ]);
    for (const id of ["c1", "c2"]) assert.ok(results(run.model).get(id)?.text.includes("credential"), id);
    assert.equal(recordAt(setup.root, "build.md"), undefined);
  });
});

describe("removability", () => {
  test("with the extension left out, no memory tool and no index reach the model", async () => {
    const setup = { ...setupOf(), memory: false };
    const withMemory = setupOf(setup.root);
    await turn(withMemory, key("s1"), [{ name: "memory", input: BUILD }]);
    const { model, result } = await turn(setup, key("s2"), [view(".agents/memory")]);
    const request = model.calls[0]?.context;
    assert.ok(!request?.tools.some((tool) => tool.name === "memory"));
    assert.ok(!JSON.stringify(request?.messages).includes("Memory index"));
    assert.equal(results(model).get("c1")?.isError, true, "a call to the absent tool fails");
    assert.ok(result);
  });
});
