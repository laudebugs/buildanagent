/**
 * Loading the extensions a project supplies. A project's extensions live in `.agents/extensions/<folder>/`, each with an
 * `index.mjs` or `index.js` whose default export is an `Extension`, or a function returning one. They load only when the
 * project is trusted and the run is not headless, and only when every folder's hash matches the lock file. Trust gates
 * loading, not execution: an extension that loads runs with the harness's own permissions. Node-only.
 */
import { access, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HarnessError } from "../errors.js";
import { hashExtensionDir, readLock, writeLock } from "./lock.js";
import type { Extension, ExtensionLoadedRecord, TrustStore } from "./types.js";

/** What `loadProjectExtensions()` needs to decide. */
export interface LoadOptions {
  readonly trust: TrustStore;
  /** True for a run nobody can answer: project extensions are skipped unless `loadInHeadless` is set. */
  readonly headless: boolean;
  /** Lets a headless run load the extensions of a project the trust store already trusts. Default false. */
  readonly loadInHeadless?: boolean;
  /** The lock file. Default `<root>/.agents/extensions.lock.json`. */
  readonly lockFile?: string;
  /** The folder that holds the extensions. Default `<root>/.agents/extensions`. */
  readonly extensionsDir?: string;
}

/** The extensions a project supplied, what to record about them, and why any were skipped. */
export interface ProjectExtensions {
  readonly extensions: Extension[];
  readonly records: ExtensionLoadedRecord[];
  /** One line for each reason the load was skipped or left unpinned, for the caller to show. */
  readonly notices: string[];
}

/** The path with symlinks resolved, so a symlinked root and its target are one project to the trust store. */
export async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(resolve(path));
  } catch {
    return resolve(path);
  }
}

const places = (root: string, options: Pick<LoadOptions, "lockFile" | "extensionsDir">) => ({
  dir: options.extensionsDir ?? join(root, ".agents", "extensions"),
  lock: options.lockFile ?? join(root, ".agents", "extensions.lock.json"),
});

/** The extension folders under `dir`, by name; none when the folder does not exist. */
async function folders(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
}

async function entryFile(dir: string): Promise<string> {
  for (const name of ["index.mjs", "index.js"]) {
    try {
      await access(join(dir, name));
      return join(dir, name);
    } catch {
      // try the next name
    }
  }
  throw new HarnessError("invalid_extension", `the extension folder ${dir} has no index.mjs or index.js`);
}

// The hash each folder had when this process first imported it. Node caches modules for the life of the process, so a
// folder that changed since then would run its old code while the log recorded the new hash.
const importedHashes = new Map<string, string>();

async function importExtension(dir: string, hash: string): Promise<Extension> {
  const before = importedHashes.get(dir);
  if (before !== undefined && before !== hash) {
    throw new HarnessError(
      "extension_hash_mismatch",
      `the extension in ${dir} changed after this process loaded it; restart the process to load the new files`,
    );
  }
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(await entryFile(dir)).href)) as { default?: unknown };
  importedHashes.set(dir, hash);
  const made = typeof loaded.default === "function" ? await (loaded.default as () => unknown)() : loaded.default;
  const extension = made as Partial<Extension> | undefined;
  if (typeof extension?.name !== "string" || typeof extension.version !== "string") {
    throw new HarnessError("invalid_extension", `the extension in ${dir} does not export a name and a version`);
  }
  return extension as Extension;
}

/** Why a project's extensions are not loaded, or `undefined` when they may be. */
async function skipReason(root: string, options: LoadOptions): Promise<string | undefined> {
  if (options.headless && options.loadInHeadless !== true) {
    return `the project extensions of ${root} are skipped: this run is headless`;
  }
  if (!(await options.trust.isTrusted(root)))
    return `the project extensions of ${root} are skipped: the project is not trusted`;
  return undefined;
}

/**
 * Loads the extensions in a project, or skips them with a notice. Every folder is hashed and checked against the lock
 * file before any is imported, so a refusal runs none of the project's code. A folder whose hash differs from the lock
 * file, that the lock file does not list, or that the lock file lists and the project no longer holds is refused with
 * `extension_hash_mismatch`; with no lock file the extensions load and a notice says they are unpinned.
 *
 * The pin covers the files inside each extension folder, and nothing an extension imports from outside it, such as a
 * relative path that leaves the folder or a package from the project's `node_modules`. The lock file sits inside the
 * project it pins, so anyone who can edit the project can pin their own changes: the pin catches a change nobody
 * meant, not an attacker who holds the project.
 */
export async function loadProjectExtensions(root: string, options: LoadOptions): Promise<ProjectExtensions> {
  const base = await canonicalPath(root);
  const result: ProjectExtensions = { extensions: [], records: [], notices: [] };
  const { dir, lock } = places(base, options);
  const names = await folders(dir);
  const pins = await readLock(lock);
  if (names.length === 0 && (pins === undefined || pins.size === 0)) return result;
  const reason = await skipReason(base, options);
  if (reason !== undefined) {
    result.notices.push(reason);
    return result;
  }
  if (pins === undefined) result.notices.push(`the extensions of ${base} are not pinned: there is no ${lock}`);
  const hashes = await checkedHashes(dir, names, pins);
  for (const name of names) {
    const hash = hashes.get(name) as string;
    const extension = await importExtension(join(dir, name), hash);
    result.extensions.push(extension);
    result.records.push({ name: extension.name, tier: "in_process", contentHash: hash });
  }
  return result;
}

/** The hash of every folder, after checking each against the pins: none of the project's code has run yet. */
async function checkedHashes(
  dir: string,
  names: readonly string[],
  pins: ReadonlyMap<string, string> | undefined,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const name of names) hashes.set(name, await hashExtensionDir(join(dir, name)));
  if (pins === undefined) return hashes;
  for (const name of pins.keys()) {
    if (!hashes.has(name)) {
      throw new HarnessError(
        "extension_hash_mismatch",
        `the extension "${name}" is pinned but the project no longer holds it`,
      );
    }
  }
  for (const [name, hash] of hashes) {
    const pinned = pins.get(name);
    if (pinned === hash) continue;
    const why = pinned === undefined ? "the lock file does not list it" : "its files changed since they were pinned";
    throw new HarnessError("extension_hash_mismatch", `the extension "${name}" is refused: ${why}`);
  }
  return hashes;
}

/** Writes the lock file for every extension folder as it is now. A person runs it, which is what pins the code. */
export async function pinProjectExtensions(
  root: string,
  options: Pick<LoadOptions, "lockFile" | "extensionsDir"> = {},
): Promise<ReadonlyMap<string, string>> {
  const { dir, lock } = places(await canonicalPath(root), options);
  const pins = new Map<string, string>();
  for (const name of await folders(dir)) pins.set(name, await hashExtensionDir(join(dir, name)));
  await writeLock(lock, pins);
  return pins;
}
