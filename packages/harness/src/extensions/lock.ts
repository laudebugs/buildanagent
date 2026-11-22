/**
 * Content-hash pins for project extensions. An extension is a folder; its hash covers every file in it, in sorted
 * order, each by its path and its own SHA-256, so a changed, added, removed or renamed file changes the hash. The lock
 * file, `extensions.lock.json`, holds one hash per extension folder. Node-only: it reads and writes files.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HarnessError } from "../errors.js";

const LOCK_VERSION = 1;

/** Every file under `dir`, as paths relative to it with `/` separators, in sorted order. */
async function filesUnder(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(dir, prefix), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesUnder(dir, relative)));
    else if (entry.isFile()) found.push(relative);
  }
  return found;
}

/** The hash of an extension folder: `sha256:` and the digest over each file's path and content digest, in sorted order. */
export async function hashExtensionDir(dir: string): Promise<string> {
  const total = createHash("sha256");
  for (const file of await filesUnder(dir)) {
    const content = createHash("sha256")
      .update(await readFile(join(dir, file)))
      .digest("hex");
    total.update(`${file}\0${content}\n`);
  }
  return `sha256:${total.digest("hex")}`;
}

/** The pins in a lock file, by extension folder name, or `undefined` when there is no lock file. */
export async function readLock(file: string): Promise<ReadonlyMap<string, string> | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = JSON.parse(text) as { version?: unknown; extensions?: Record<string, unknown> };
  if (parsed.version !== LOCK_VERSION || typeof parsed.extensions !== "object" || parsed.extensions === null) {
    throw new HarnessError("invalid_extension", `the lock file ${file} is not an extensions.lock.json of version 1`);
  }
  const pins = new Map<string, string>();
  for (const [name, hash] of Object.entries(parsed.extensions)) {
    if (typeof hash !== "string")
      throw new HarnessError("invalid_extension", `the lock file pins "${name}" to no hash`);
    pins.set(name, hash);
  }
  return pins;
}

/** Writes the lock file for these pins, replacing the old one in one step. */
export async function writeLock(file: string, pins: ReadonlyMap<string, string>): Promise<void> {
  const body = {
    version: LOCK_VERSION,
    extensions: Object.fromEntries([...pins].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  const temp = `${file}.${globalThis.crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`);
  await rename(temp, file);
}
