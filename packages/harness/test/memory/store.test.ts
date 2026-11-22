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
