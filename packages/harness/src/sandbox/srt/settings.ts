/**
 * The `srt` settings file for a sandbox policy. It is a pure function of the policy, so a test can read the file a
 * backend would write without starting `srt`. `srt` is a pre-1.0 beta whose settings format may change (as of
 * November 2026), so this is the one place that knows the format.
 */
import type { SandboxPolicy } from "../types.js";

/** A path that `srt` must read as written. Without `literal`, `srt` reads a spelling such as `*.ts` as a pattern. */
export interface SrtPathEntry {
  readonly path: string;
  readonly literal: true;
}

/** The settings `srt` reads from its `--settings` file. */
export interface SrtSettings {
  readonly network: {
    readonly allowedDomains: readonly string[];
    readonly deniedDomains: readonly string[];
    readonly parentProxy?: { readonly http?: string; readonly https?: string };
  };
  readonly filesystem: {
    readonly denyRead: readonly SrtPathEntry[];
    readonly allowRead: readonly SrtPathEntry[];
    readonly allowWrite: readonly SrtPathEntry[];
    readonly denyWrite: readonly SrtPathEntry[];
  };
}

/** What the settings are built from, beyond the policy. Every path is absolute with its symlinks resolved. */
export interface SrtSettingsInput {
  readonly policy: SandboxPolicy;
  /** The system folders every program needs to start, which the policy does not list. */
  readonly systemReadRoots: readonly string[];
  /** The folders `srt` itself needs to read, such as its own helper and its private socket folder. */
  readonly helperReadRoots: readonly string[];
  /** Folders to keep read-only inside a write root, such as the session's own log folder. */
  readonly denyWrite: readonly string[];
  readonly parentProxy?: { readonly http?: string; readonly https?: string };
}

const literal = (path: string): SrtPathEntry => ({ path, literal: true });

/** Removes repeats, keeping the first of each. */
const unique = (paths: readonly string[]): string[] => [...new Set(paths)];

/**
 * Denies every read and then allows the policy's read and write roots, the system folders and the helper folders back.
 * Writes are allowed only under the write roots, and `denyWrite` takes precedence over them. The network allows only the
 * policy's hosts. Each path is `literal`, so a folder named `*` is never read as a pattern.
 */
export function srtSettings(input: SrtSettingsInput): SrtSettings {
  const { policy } = input;
  const readable = unique([
    ...policy.readRoots,
    ...policy.writeRoots,
    ...input.systemReadRoots,
    ...input.helperReadRoots,
  ]);
  return {
    network: {
      allowedDomains: [...policy.network.allow],
      deniedDomains: [...policy.network.deny],
      ...(input.parentProxy === undefined ? {} : { parentProxy: input.parentProxy }),
    },
    filesystem: {
      denyRead: [literal("/")],
      allowRead: readable.map(literal),
      allowWrite: unique(policy.writeRoots).map(literal),
      denyWrite: unique(input.denyWrite).map(literal),
    },
  };
}
