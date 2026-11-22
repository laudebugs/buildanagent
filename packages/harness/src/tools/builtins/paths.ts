/**
 * The path check every file tool makes before it calls the sandbox. It works on the path's text: it joins a relative
 * path to the workspace root, removes `.` and `..`, and refuses a path outside the roots. It can't see a symlink,
 * because the sandbox interface has no call that resolves one, so the sandbox's own check of the real path stays the
 * second line, and its denial becomes the tool's error result. The tool hands the sandbox the path it checked, never the
 * model's text, so the two checks see the same path.
 */
import { HarnessError } from "../../errors.js";
import { normalizePath } from "../../permissions/match.js";
import type { SandboxPolicy } from "../../sandbox/types.js";

/** What a file tool may touch: the workspace root and the policy's roots, each absolute and without `.` or `..`. */
export interface Bounds {
  readonly root: string;
  readonly read: readonly string[];
  readonly write: readonly string[];
}

/** A path inside the roots, or the sentence that tells the model why it is refused. */
export type Checked = { readonly path: string } | { readonly refused: string };

const within = (path: string, root: string): boolean => root === "/" || path === root || path.startsWith(`${root}/`);

function absolute(path: unknown, what: string): string {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new HarnessError("invalid_tool_options", `${what} must be an absolute path, not ${JSON.stringify(path)}`);
  }
  return normalizePath(path);
}

/** The bounds of a workspace, checked once, so a relative root can't make every path resolve somewhere unexpected. */
export function boundsOf(root: string, policy: SandboxPolicy): Bounds {
  if (!Array.isArray(policy?.readRoots) || !Array.isArray(policy.writeRoots)) {
    throw new HarnessError(
      "invalid_tool_options",
      "the built-in tools need the sandbox policy's readRoots and writeRoots",
    );
  }
  const write = policy.writeRoots.map((path) => absolute(path, "a write root"));
  // The write roots are readable too, as the sandbox policy says.
  const read = [...policy.readRoots.map((path) => absolute(path, "a read root")), ...write];
  return { root: absolute(root, "the workspace root"), read, write };
}

/** The absolute form of `path` against the root, or a refusal when it is outside the roots for `access`. */
export function checkPath(bounds: Bounds, path: string, access: "read" | "write"): Checked {
  if (path === "" || path.includes("\u0000")) {
    return { refused: `The path ${JSON.stringify(path)} is not a usable path.` };
  }
  const resolved = normalizePath(path.startsWith("/") ? path : `${bounds.root}/${path}`);
  const roots = access === "write" ? bounds.write : bounds.read;
  if (roots.some((root) => within(resolved, root))) return { path: resolved };
  const where = roots.length === 0 ? "no folder" : roots.join(", ");
  return { refused: `The path ${path} is outside the folders this tool may ${access}: ${where}.` };
}

/** The tool input's path, from `path` or `file_path`; both may be given only when they agree. */
export function pathInput(input: {
  readonly path?: string;
  readonly file_path?: string;
}): string | { refused: string } {
  const { path, file_path: filePath } = input;
  if (path !== undefined && filePath !== undefined && path !== filePath) {
    return { refused: "Pass the file as `path` or as `file_path`, not two different paths." };
  }
  const chosen = filePath ?? path;
  return chosen === undefined ? { refused: "Pass the file to use as `path`." } : chosen;
}
