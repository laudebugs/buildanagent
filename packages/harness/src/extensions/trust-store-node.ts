/** A trust store in memory that keeps each folder as its real path. Node-only, because it resolves links on the spot. */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { TrustStore } from "./types.js";

/** The real path of `path` as it is now, made absolute, or the absolute path when it does not exist. */
function realPathNow(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * A trust store in memory, for tests and for a host that decides trust itself, that resolves each folder to its real
 * path when the store is built and when `trust()` adds it. A host that trusts `/tmp/proj`, where `/tmp` links to
 * `/private/tmp` as on macOS, gets that project trusted. A link pointed at another folder after it was added does not
 * carry the trust with it, because the store holds the folder the link named then. A lookup compares the path it is
 * given as written, which is the real path the loaders pass. `memoryTrustStore()` is the portable store, which
 * compares every path as written.
 */
export function realPathTrustStore(trusted: readonly string[] = []): TrustStore {
  const roots = new Set(trusted.map(realPathNow));
  return {
    async isTrusted(projectRoot) {
      return roots.has(projectRoot);
    },
    async trust(projectRoot) {
      roots.add(realPathNow(projectRoot));
    },
  };
}
