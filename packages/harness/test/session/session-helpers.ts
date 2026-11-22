// Shared by the session tests: both stores with their pointer index, and a small log to branch.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type EntryInput,
  memoryIndex,
  memoryStore,
  type SessionIndex,
  type SessionKey,
  type SessionLock,
  type SessionStore,
} from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { afterAll } from "vitest";

export const KEY: SessionKey = { userId: "ada", sessionId: "s1" };

export interface Backend {
  readonly name: string;
  readonly store: SessionStore;
  readonly index: SessionIndex;
  readonly lock: SessionLock;
  /** The folder the files are in, for a test that reads them, or `undefined` for memory. */
  readonly dir: string | undefined;
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A lock for the memory backend: it holds a name and never expires. */
export function memoryLock(): SessionLock {
  const held = new Set<string>();
  return {
    async acquire(key) {
      const name = JSON.stringify([key.userId, key.sessionId]);
      if (held.has(name)) return "would_block";
      held.add(name);
      let live = true;
      return {
        token: name,
        held: () => live,
        async release() {
          live = false;
          held.delete(name);
        },
      };
    },
  };
}

export function memoryBackend(): Backend {
  return { name: "memory", store: memoryStore(), index: memoryIndex(), lock: memoryLock(), dir: undefined };
}

export function fileBackend(): Backend {
  const dir = mkdtempSync(join(tmpdir(), "harness-session-"));
  dirs.push(dir);
  return {
    name: "files",
    store: jsonlStore({ dir: join(dir, "sessions") }),
    index: fileIndex({ dir: join(dir, "pointers") }),
    lock: fileLock({ dir: join(dir, "locks") }),
    dir,
  };
}

export const BACKENDS: readonly [string, () => Backend][] = [
  ["the memory store", memoryBackend],
  ["the file store", fileBackend],
];

/** An id source that counts, so a test can name the entries and files a session makes. */
export function counter(prefix = "g"): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${n}`;
  };
}

export const NOW = () => new Date("2026-11-22T00:00:00.000Z");

export const header = (id = "h1"): EntryInput => ({
  id,
  parentId: null,
  timestamp: "2026-01-01T00:00:00.000Z",
  origin: "harness",
  type: "session_header",
  formatVersion: 1,
  harnessVersion: "0.1.0",
  sdkVersion: "0.1.0-alpha.24",
  defaultsHash: "d",
  capabilities: ["steering_v1"],
  ablationHash: "a",
});

export const record = (id: string, parentId: string): EntryInput => ({
  id,
  parentId,
  timestamp: "2026-01-01T00:00:01.000Z",
  origin: "harness",
  type: "product_record",
  name: "test.record",
  data: { id },
});

/** A log of `h1 <- r1 <- r2 <- r3`, written under `key`. */
export async function seed(backend: Backend, key: SessionKey = KEY): Promise<void> {
  await backend.store.append(key, [header(), record("r1", "h1"), record("r2", "r1"), record("r3", "r2")]);
}
