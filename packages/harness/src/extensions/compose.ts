/** Composing extensions: their hooks become one set of interceptors and one list of observers, and their tools register. */
import { composeInterceptors, type Interceptors, type Observer } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import type { ToolRegistry } from "../tools/types.js";
import type { Extension, ExtensionLoadedRecord, TrustStore } from "./types.js";

/** An extension that is not usable: no name, or the name is taken. */
function checkNames(extensions: readonly Extension[]): void {
  const seen = new Set<string>();
  for (const extension of extensions) {
    if (extension.name.trim() === "" || extension.version.trim() === "") {
      throw new HarnessError("invalid_extension", "an extension needs a name and a version");
    }
    if (seen.has(extension.name)) {
      throw new HarnessError("invalid_extension", `two extensions are named "${extension.name}"`);
    }
    seen.add(extension.name);
  }
}

/**
 * Joins the extensions' interceptors, in the order given, by the SDK's composition rules, and their observers. A
 * hook that throws fails the moment it belongs to, as `composeInterceptors()` says, so one extension's gate that fails
 * closed fails the whole turn's gate closed.
 */
export function composeExtensions(extensions: readonly Extension[]): {
  readonly interceptors: Interceptors;
  readonly observers: readonly Observer[];
} {
  checkNames(extensions);
  // Only the extensions that have interceptors join: an empty set counts as fail-closed and would undo the others'
  // `continue`, and with none at all the result is empty, so a host that joins it with its own keeps its own setting.
  const sets = extensions.flatMap((extension) =>
    extension.interceptors === undefined ? [] : [extension.interceptors],
  );
  return {
    interceptors: sets.length === 0 ? {} : composeInterceptors(...sets),
    observers: extensions.flatMap((extension) => extension.observers ?? []),
  };
}

/** Registers every extension's tools in `registry` with source `extension`. A duplicate name is the registry's error. */
export function registerExtensionTools(registry: ToolRegistry, extensions: readonly Extension[]): void {
  checkNames(extensions);
  // Every tool is checked before the first is registered, so a bad one leaves the registry as it was.
  const names = new Set<string>();
  for (const tool of extensions.flatMap((extension) => extension.tools ?? [])) {
    if (typeof tool.name !== "string" || typeof tool.definition !== "object" || tool.definition === null) {
      throw new HarnessError("invalid_extension", "an extension tool needs a name and a definition");
    }
    if (names.has(tool.name) || (registry.get(tool.name) !== undefined && tool.override !== true)) {
      throw new HarnessError(
        "duplicate_tool",
        `the extension tool "${tool.name}" has the name of a tool that is already registered`,
      );
    }
    names.add(tool.name);
  }
  for (const extension of extensions) {
    for (const tool of extension.tools ?? []) registry.register({ ...tool, source: "extension" });
  }
}

/** The digest of `data`, as `sha256:` and hex. A string is hashed as its UTF-8 bytes. */
export async function sha256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The records for extensions written in code: their hash covers the name and version, since there are no files. */
export async function recordsOf(extensions: readonly Extension[]): Promise<ExtensionLoadedRecord[]> {
  return Promise.all(
    extensions.map(async (extension) => ({
      name: extension.name,
      tier: "in_process" as const,
      contentHash: await sha256(`${extension.name}@${extension.version}`),
    })),
  );
}

/**
 * The real path of `path` as it is now, made absolute, or `path` itself on a runtime without Node's file system. It is
 * synchronous so that `memoryTrustStore()` resolves its folders when it is built, before a link among them can be
 * pointed elsewhere.
 */
function realPathNow(path: string): string {
  // biome-ignore lint/style/noRestrictedGlobals: the store must resolve links when it is built, which needs a synchronous call into Node's file system where there is one; on any other runtime it compares paths as written.
  const node = typeof process === "undefined" ? undefined : process;
  if (typeof node?.getBuiltinModule !== "function") return path;
  const { realpathSync } = node.getBuiltinModule("node:fs");
  const absolute = node.getBuiltinModule("node:path").resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * A trust store in memory, for tests and for a host that decides trust itself. Each folder is kept as its real path,
 * resolved when the store is built or when `trust()` is called, and a lookup compares the real path of the folder it
 * is asked about. A host that trusts `/tmp/proj`, where `/tmp` links to `/private/tmp`, gets that project trusted, and a
 * link that is pointed at another folder after the store was built does not carry the trust with it. On a runtime
 * without Node's file system the paths are compared as written.
 */
export function memoryTrustStore(trusted: readonly string[] = []): TrustStore {
  const roots = new Set(trusted.map(realPathNow));
  return {
    async isTrusted(projectRoot) {
      return roots.has(realPathNow(projectRoot));
    },
    async trust(projectRoot) {
      roots.add(realPathNow(projectRoot));
    },
  };
}
