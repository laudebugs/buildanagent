// The purge list's bookkeeping: a clear and a delete over the same file store never lose each other's marks.
import assert from "node:assert/strict";
import { clearPurgeMarks, type MemoryFiles, readPurgeMarks } from "@buildanagent/harness/memory";
import { fileMemoryFiles } from "@buildanagent/harness/memory/node";
import { describe, test } from "vitest";
import { RecordStore } from "../../src/memory/store.js";
import { project } from "./helpers.js";

/** Files in memory whose next read of `gated` waits until `release()` runs. */
function gatedFiles(gated: string) {
  const texts = new Map<string, string>();
  let release: () => void = () => undefined;
  let armed = false;
  const files: MemoryFiles = {
    list: async () => [...texts.keys()],
    async read(name) {
      const text = texts.get(name);
      if (armed && name === gated) {
        armed = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return text;
    },
    write: async (name, text) => {
      texts.set(name, text);
    },
    remove: async (name) => {
      texts.delete(name);
    },
    rename: async (from, to) => {
      texts.set(to, texts.get(from) as string);
      texts.delete(from);
    },
  };
  return {
    files,
    arm: () => {
      armed = true;
    },
    release: () => release(),
  };
}

const mark = (callId: string) => ({ runId: "r", callId, tool: "memory" });

describe("the purge list", () => {
  test("a clear that reads the list while a delete adds to it keeps the delete's mark", async () => {
    const { files, arm, release } = gatedFiles(".purge.json");
    const store = new RecordStore(files);
    await store.exclusive(() => store.forget("a.md", [mark("a"), mark("b")]));
    arm();
    const clearing = clearPurgeMarks(files, [mark("a")]);
    const deleting = store.exclusive(() => store.forget("c.md", [mark("c")]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await Promise.all([clearing, deleting]);
    assert.deepEqual((await readPurgeMarks(files)).map((held) => held.callId).sort(), ["b", "c"]);
  });

  test("fileMemoryFiles() gives one object per root, so a clear waits for the extension's calls", () => {
    const root = project();
    assert.equal(fileMemoryFiles(root), fileMemoryFiles(root));
  });
});

describe("the calls file stays bounded", () => {
  const record = '---\nsubject: "S"\n---\nA fact.\n';
  const callsOf = async (files: MemoryFiles) => JSON.parse((await files.read(".calls.json")) ?? "{}");

  test("a record keeps its newest 100 calls, and the older ones go to the purge list, so a delete still finds all", async () => {
    const { files } = gatedFiles("");
    const store = new RecordStore(files);
    await files.write("a.md", record);
    for (let at = 1; at <= 150; at += 1) await store.touched(["a.md"], mark(`v${at}`));
    const kept = (await callsOf(files))["a.md"] as { callId: string }[];
    assert.equal(kept.length, 100);
    assert.equal(kept[0]?.callId, "v51");
    assert.equal((await readPurgeMarks(files)).length, 50);
    await store.forget("a.md");
    assert.equal((await readPurgeMarks(files)).length, 150);
  });

  test("the calls of a record whose file another tool removed go to the purge list", async () => {
    const { files } = gatedFiles("");
    const store = new RecordStore(files);
    await files.write("gone.md", record);
    await files.write("here.md", record);
    await store.touched(["gone.md"], mark("g"));
    await files.remove("gone.md");
    await store.touched(["here.md"], mark("h"));
    assert.deepEqual(Object.keys(await callsOf(files)), ["here.md"]);
    assert.deepEqual(
      (await readPurgeMarks(files)).map((held) => held.callId),
      ["g"],
    );
  });

  test("past 2 MiB each record keeps fewer of its newest calls, and none is lost", async () => {
    const { files } = gatedFiles("");
    const store = new RecordStore(files);
    const long = "x".repeat(20_000);
    for (let file = 0; file < 2; file += 1) {
      await files.write(`r${file}.md`, record);
      for (let at = 0; at < 60; at += 1) await store.touched([`r${file}.md`], mark(`${long}${file}-${at}`));
    }
    const text = (await files.read(".calls.json")) as string;
    assert.ok(new TextEncoder().encode(text).length <= 2 * 1024 * 1024);
    const kept = Object.values(JSON.parse(text) as Record<string, unknown[]>).reduce(
      (sum, marks) => sum + marks.length,
      0,
    );
    assert.ok(kept < 120, "some calls left the file");
    assert.equal(kept + (await readPurgeMarks(files)).length, 120);
  });

  test("a calls file it can't read is set aside, and memory keeps working", async () => {
    const { files } = gatedFiles("");
    const store = new RecordStore(files);
    await files.write("a.md", record);
    await files.write(".calls.json", "not json");
    await store.touched(["a.md"], mark("a"));
    assert.equal(await files.read(".calls-unread.json"), "not json");
    assert.deepEqual(Object.keys(await callsOf(files)), ["a.md"]);
  });
});
