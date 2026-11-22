/**
 * Loading the extensions a project supplies. A project's extensions live in `.agents/extensions/<folder>/`, each with an
 * `index.mjs` or `index.js` whose default export is an `Extension`, or a function returning one. They load only when the
 * project is trusted and the run is not headless, and only when every folder's hash matches the lock file. Trust gates
 * loading, not execution: an extension that loads runs with the harness's own permissions. Node-only.
 */
import { access, readdir } from "node:fs/promises";
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

async function importExtension(dir: string): Promise<Extension> {
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(await entryFile(dir)).href)) as { default?: unknown };
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
 * Loads the extensions in a project, or skips them with a notice. A trusted project's folder whose hash differs from the
 * lock file, or that the lock file does not list, is refused with `extension_hash_mismatch`; with no lock file the
 * extensions load and a notice says they are unpinned.
 */
export async function loadProjectExtensions(root: string, options: LoadOptions): Promise<ProjectExtensions> {
  const base = resolve(root);
  const result: ProjectExtensions = { extensions: [], records: [], notices: [] };
  const { dir, lock } = places(base, options);
  const names = await folders(dir);
  if (names.length === 0) return result;
  const reason = await skipReason(base, options);
  if (reason !== undefined) {
    result.notices.push(reason);
    return result;
  }
  const pins = await readLock(lock);
  if (pins === undefined) result.notices.push(`the extensions of ${base} are not pinned: there is no ${lock}`);
  for (const name of names) {
    const hash = await hashExtensionDir(join(dir, name));
    const pinned = pins?.get(name);
    if (pins !== undefined && pinned !== hash) {
      const why = pinned === undefined ? "the lock file does not list it" : "its files changed since they were pinned";
      throw new HarnessError("extension_hash_mismatch", `the extension "${name}" is refused: ${why}`);
    }
    const extension = await importExtension(join(dir, name));
    result.extensions.push(extension);
    result.records.push({ name: extension.name, tier: "in_process", contentHash: hash });
  }
  return result;
}

/** Writes the lock file for every extension folder as it is now. A person runs it, which is what pins the code. */
export async function pinProjectExtensions(
  root: string,
  options: Pick<LoadOptions, "lockFile" | "extensionsDir"> = {},
): Promise<ReadonlyMap<string, string>> {
  const { dir, lock } = places(resolve(root), options);
  const pins = new Map<string, string>();
  for (const name of await folders(dir)) pins.set(name, await hashExtensionDir(join(dir, name)));
  await writeLock(lock, pins);
  return pins;
}
