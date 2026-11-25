/**
 * POSIX path handling for a sandbox whose files live in a remote Linux VM, so the host's own `node:path` can't be used:
 * it would apply Windows rules on a Windows host. It is pure and portable.
 */
import { HarnessError } from "../../errors.js";

/** Whether `path` is absolute and holds nothing a remote shell or API could read as more than a path. */
export function isUsablePath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !/[\0\n\r]/.test(path);
}

/** Throws `invalid_sandbox_options` unless every path is absolute and usable. The message names only `what`. */
export function checkAbsolute(paths: readonly unknown[], what: string): void {
  for (const path of paths) {
    if (!isUsablePath(path)) throw new HarnessError("invalid_sandbox_options", `${what} must be an absolute path`);
  }
}

/** `path` with `.`, `..` and repeated slashes resolved, without following links. `/..` stays `/`. */
export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** `path` resolved against `base` when it is relative, then normalized. */
export function resolveAgainst(base: string, path: string): string {
  return normalize(path.startsWith("/") ? path : `${base}/${path}`);
}

/** Whether `path` is `root` or lies under it. Both must be normalized. */
export function inside(root: string, path: string): boolean {
  return root === "/" || path === root || path.startsWith(`${root}/`);
}

/** `path` relative to `root`, with `/` between the parts, or `""` for the root itself. */
export function relativeTo(root: string, path: string): string {
  return path === root ? "" : path.slice(root === "/" ? 1 : root.length + 1);
}

/** The folder that holds `path`. */
export function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}
