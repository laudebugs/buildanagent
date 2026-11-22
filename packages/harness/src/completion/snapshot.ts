/**
 * Snapshots of the workspace's text files, taken inside the sandbox with `git ls-files`, so a turn's changes can be
 * diffed against its start state without a second copy of the workspace.
 */
import type { Sandbox } from "../sandbox/types.js";
import type { WorkspaceSnapshot } from "./flags.js";

/** Takes a snapshot, or returns `undefined` when the workspace can't be listed, so no diff flags are raised. */
export type Snapshotter = (sandbox: Sandbox, options: SnapshotOptions) => Promise<WorkspaceSnapshot | undefined>;

/** What a snapshotter needs to run a command in the sandbox. */
export interface SnapshotOptions {
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  /**
   * The paths an earlier snapshot of the same workspace held. They are read first and always, so a file that a later
   * listing pushes past the cap, or that no longer appears in it, still has its text; new paths fill what is left of
   * `MAX_SNAPSHOT_FILES`.
   */
  readonly known?: ReadonlySet<string>;
  /** Paths an earlier snapshot skipped. They stay skipped and are not read again. */
  readonly skipped?: ReadonlySet<string>;
}

/** The largest file a snapshot keeps, in bytes. A bigger file is left out of both snapshots, so it is never flagged. */
export const MAX_SNAPSHOT_FILE_BYTES = 256 * 1024;
/** The most files a snapshot keeps. */
export const MAX_SNAPSHOT_FILES = 5000;

const DECODER = new TextDecoder("utf-8", { fatal: true });
const BATCH = 32;

/** The text of a file, `"gone"` for one no longer on disk, or `"skipped"` for one that is binary, not UTF-8 or too large. */
async function readText(sandbox: Sandbox, path: string): Promise<string | "gone" | "skipped"> {
  let bytes: Uint8Array;
  try {
    bytes = await sandbox.readFile(path);
  } catch {
    // A tracked file the turn deleted is listed by git but no longer on disk, so a failed read counts as gone.
    return "gone";
  }
  if (bytes.length > MAX_SNAPSHOT_FILE_BYTES || bytes.includes(0)) return "skipped";
  try {
    return DECODER.decode(bytes);
  } catch {
    return "skipped";
  }
}

/**
 * The default snapshotter: every file git tracks or would track (so untracked files that `.gitignore` leaves out stay
 * out), read as UTF-8 text up to `MAX_SNAPSHOT_FILE_BYTES` each and `MAX_SNAPSHOT_FILES` files. A file it leaves out
 * for its size, its encoding or the cap goes in `skipped`, and the diff ignores it. It returns `undefined` where `git`
 * is missing or the workspace is no repository.
 */
export const gitSnapshotter: Snapshotter = async (sandbox, options) => {
  const listed = await sandbox.exec(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    env: options.env,
    signal: options.signal,
  });
  if ("denied" in listed || listed.exitCode !== 0) return undefined;
  const skipped = new Set(options.skipped);
  const known = [...(options.known ?? [])].filter((path) => !skipped.has(path));
  const seen = new Set([...known, ...skipped]);
  const fresh = [...new Set(listed.stdout.split("\0").filter((path) => path !== ""))].filter((path) => !seen.has(path));
  const room = Math.max(0, MAX_SNAPSHOT_FILES - known.length);
  for (const path of fresh.slice(room)) skipped.add(path);
  const paths = [...known, ...fresh.slice(0, room)];
  const files = new Map<string, string>();
  for (let start = 0; start < paths.length; start += BATCH) {
    const batch = paths.slice(start, start + BATCH);
    const texts = await Promise.all(batch.map((path) => readText(sandbox, path)));
    for (const [index, text] of texts.entries()) {
      const path = batch[index] as string;
      if (text === "skipped") skipped.add(path);
      else if (text !== "gone") files.set(path, text);
    }
  }
  return { files, skipped };
};
