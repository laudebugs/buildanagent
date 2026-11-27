// A session's log must not depend on how long its store takes to append. The capstone's three cases run on the JSONL
// files, on the in-memory store and on an in-memory store that waits before every append, and each case must write the
// same entries on all three: the same ids, parents, times and contents.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryStore, type SessionStore } from "@buildanagent/harness/session";
import type { SessionEntry } from "@buildanagent/protocol";
import { afterAll, describe, test } from "vitest";
import { CASES, type CaseName, entriesOf, filesAt, recordCase, scrubbing } from "../capstone/triage-fixture.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "entry-order-"));
  dirs.push(dir);
  return dir;
}

/** A store that waits `ms` on the real timer before each append, so the store is slower than everything around it. */
function slow(store: SessionStore, ms: number): SessionStore {
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "append") return typeof value === "function" ? value.bind(target) : value;
      return (async (...args: Parameters<SessionStore["append"]>) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return target.append(...args);
      }) satisfies SessionStore["append"];
    },
  });
}

async function logOn(name: CaseName, store?: SessionStore): Promise<SessionEntry[]> {
  const files = filesAt(tempDir());
  const run = store === undefined ? files : { ...files, store: scrubbing(store) };
  await recordCase(run, CASES[name]);
  return entriesOf(run);
}

describe("a session's entries do not depend on its store's speed", () => {
  for (const name of Object.keys(CASES) as CaseName[]) {
    test(`the ${name} case writes the same log on the JSONL, in-memory and slow stores`, async () => {
      const onFiles = await logOn(name);
      assert.deepEqual(await logOn(name, memoryStore()), onFiles, `${name}: in-memory`);
      assert.deepEqual(await logOn(name, slow(memoryStore(), 5)), onFiles, `${name}: slow`);
    });
  }
});
