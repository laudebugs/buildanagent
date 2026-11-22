/**
 * The `srt` settings file for a sandbox policy. It is a pure function of the policy, so a test can read the file a
 * backend would write without starting `srt`. `srt` is a pre-1.0 beta whose settings format may change (as of
 * November 2026), so this is the one place that knows the format.
 */
import { SandboxPolicyMismatchError } from "../errors.js";
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

/** How a settings file's real paths map back to the spelling of the request, for `srtPolicyFromSettings()`. */
export interface SrtPolicyNames {
  /** For each real read root, the request's spellings that resolved to it. */
  readonly read: ReadonlyMap<string, readonly string[]>;
  /** For each real write root, the request's spellings that resolved to it. */
  readonly write: ReadonlyMap<string, readonly string[]>;
  /** The readable folders the backend adds itself: the system's, `srt`'s own and the caller's extra read roots. */
  readonly implicitReads: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The strings of a list, or a mismatch naming `field` when it is anything else. */
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new SandboxPolicyMismatchError(field);
  }
  return value;
}

/** The paths of a list of literal entries. An entry `srt` would read as a pattern is a mismatch naming `field`. */
function literalPaths(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new SandboxPolicyMismatchError(field);
  return value.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.path !== "string" || entry.literal !== true) {
      throw new SandboxPolicyMismatchError(field);
    }
    return entry.path;
  });
}

/**
 * The policy a settings file applies, in the spelling of the request. A write root maps back through `names.write`,
 * and a readable folder through `names.read`. A folder the backend adds itself, and a write root, which is readable
 * anyway, are left out, so any other folder in the file shows up as a read root the request didn't ask for. A file
 * that doesn't deny every read first reads back as the read root `/`. A file that isn't in the shape `srtSettings()`
 * writes throws `SandboxPolicyMismatchError`.
 */
export function srtPolicyFromSettings(settings: unknown, names: SrtPolicyNames): SandboxPolicy {
  const network = isRecord(settings) && isRecord(settings.network) ? settings.network : undefined;
  const filesystem = isRecord(settings) && isRecord(settings.filesystem) ? settings.filesystem : undefined;
  if (network === undefined || filesystem === undefined) throw new SandboxPolicyMismatchError("settings");
  const writeReal = literalPaths(filesystem.allowWrite, "writeRoots");
  const denyRead = literalPaths(filesystem.denyRead, "readRoots");
  const allowRead = literalPaths(filesystem.allowRead, "readRoots");
  const implied = new Set([...writeReal, ...names.implicitReads]);
  const readRoots =
    denyRead.length === 1 && denyRead[0] === "/"
      ? allowRead.flatMap((path) => names.read.get(path) ?? (implied.has(path) ? [] : [path]))
      : ["/"];
  return {
    readRoots,
    writeRoots: writeReal.flatMap((path) => names.write.get(path) ?? [path]),
    network: {
      allow: strings(network.allowedDomains, "network.allow"),
      deny: strings(network.deniedDomains, "network.deny"),
    },
  };
}
