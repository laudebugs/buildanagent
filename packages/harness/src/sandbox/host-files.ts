/**
 * The file calls that backends with a bind-mounted workspace share. A backend that confines commands with a kernel
 * feature still reads and writes the workspace's files from the host, and this checks every path first: by its real
 * path, so a symlink that leads out of a root is refused, and again on the opened file through `/proc`, so a path swapped
 * for a link in between is caught. A hostile process could still win that race, which is why no backend that uses this
 * claims a `hostile_process` stop. It is Node-only and Linux-only, because it reads `/proc`.
 */
import { HarnessError, isHarnessError } from "../errors.js";
import { SandboxDeniedError } from "./errors.js";
import type { NodeModules } from "./process.js";
import type { ExecOptions, ExecResult, SandboxDenial } from "./types.js";

// The `PATH` a backend's tools run with when the host has none.
export const DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin";

// The most bytes a file call reads or writes, because the whole file is held in memory.
const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Whether `path` is inside `root`, or is `root`. Both are absolute, with symlinks resolved. */
export function inside(modules: NodeModules, root: string, path: string): boolean {
  const relative = modules.path.relative(root, path);
  const climbs = relative === ".." || relative.startsWith(`..${modules.path.sep}`);
  return relative === "" || (!climbs && !modules.path.isAbsolute(relative));
}

/** The real path of `path`, or `path` itself when it doesn't exist. */
export async function realOrSelf(modules: NodeModules, path: string): Promise<string> {
  return modules.fs.realpath(path).catch(() => path);
}

/**
 * The real path of `path`, which may not exist: the real path of its deepest folder that does, then the rest as written.
 * A symlink on the way is followed, so a link that points out of a root shows as outside it.
 */
export async function realPathOfMissing(modules: NodeModules, path: string): Promise<string> {
  const rest: string[] = [];
  let at = path;
  for (;;) {
    try {
      return modules.path.join(await modules.fs.realpath(at), ...rest);
    } catch {
      const parent = modules.path.dirname(at);
      if (parent === at) return path;
      rest.unshift(modules.path.basename(at));
      at = parent;
    }
  }
}

/** The paths that exist, without repeats. */
export async function existing(modules: NodeModules, paths: readonly string[]): Promise<string[]> {
  const present = await Promise.all(
    paths.map((path) =>
      modules.fs.access(path).then(
        () => path,
        () => undefined,
      ),
    ),
  );
  return [...new Set(present.filter((path): path is string => path !== undefined))];
}

/**
 * The absolute folders of `path`, or a default when there are none. A relative folder would be searched from the
 * workspace, where the agent can write, so `srt` could start a program the agent planted.
 */
export function absolutePath(modules: NodeModules, path: string | undefined): string {
  const folders = (path ?? "").split(modules.path.delimiter).filter((folder) => modules.path.isAbsolute(folder));
  return folders.length === 0 ? DEFAULT_PATH : folders.join(modules.path.delimiter);
}

/** The first folder of `hostPath` that holds an executable called `name`, or `undefined`. */
export async function findOnPath(modules: NodeModules, hostPath: string, name: string): Promise<string | undefined> {
  const folders = hostPath.split(modules.path.delimiter).filter((folder) => folder !== "");
  for (const folder of folders) {
    const candidate = modules.path.join(folder, name);
    try {
      await modules.fs.access(candidate, modules.fs.constants.X_OK);
      return candidate;
    } catch {
      // Not in this folder.
    }
  }
  return undefined;
}

/** Throws unless every path is absolute and is not `/`. */
export function checkPaths(modules: NodeModules, paths: readonly string[], what: string): void {
  for (const path of paths) {
    if (!modules.path.isAbsolute(path) || modules.path.resolve(path) === "/") {
      throw new HarnessError(
        "invalid_sandbox_options",
        `${what} must be an absolute path other than /, not ${JSON.stringify(path)}`,
      );
    }
  }
}

/** The workspace manifest's root as a real path, or an error when it isn't an existing absolute folder. */
export async function workspaceRoot(modules: NodeModules, root: string): Promise<string> {
  if (!modules.path.isAbsolute(root)) {
    throw new HarnessError("invalid_sandbox_options", "a workspace manifest's root must be an absolute path");
  }
  const stats = await modules.fs.stat(root).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new HarnessError("invalid_sandbox_options", "a workspace manifest's root must be an existing folder");
  }
  return modules.fs.realpath(root);
}

/** The real roots a sandbox enforces on file calls. */
export interface RealRoots {
  readonly read: readonly string[];
  readonly write: readonly string[];
  readonly denyWrite: readonly string[];
}

/** The working directory as a real path inside `root`, or the denial for one outside it. */
export async function workingDirectory(
  modules: NodeModules,
  root: string,
  options: ExecOptions,
): Promise<{ cwd: string } | Extract<ExecResult, { denied: SandboxDenial }>> {
  const wanted = modules.path.resolve(root, options.cwd ?? ".");
  const cwd = await realPathOfMissing(modules, wanted);
  if (!inside(modules, root, cwd)) {
    return {
      denied: { kind: "filesystem_read", target: wanted, reason: "the working directory is outside the workspace" },
    };
  }
  const stats = await modules.fs.stat(cwd).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new HarnessError("invalid_sandbox_options", `the working directory ${cwd} is not an existing folder`);
  }
  return { cwd };
}

// What a backend that bind-mounts the workspace keeps read-only inside it, which the file calls keep read-only too: the
// shell start-up files, the editor and agent settings, and a repository's hooks and config.
const PROTECTED_PATHS =
  /^(\.bash_profile|\.bashrc|\.zshrc|\.zprofile|\.profile|\.gitconfig|\.gitmodules|\.ripgreprc|\.mcp\.json|\.vscode|\.idea|\.claude)(\/|$)|(^|\/)\.git\/(hooks|config)(\/|$)/;

/** The paths at the top of a write root that a backend can mount read-only when they exist. */
export const PROTECTED_TOP_LEVEL: readonly string[] = [
  ".bash_profile",
  ".bashrc",
  ".zshrc",
  ".zprofile",
  ".profile",
  ".gitconfig",
  ".gitmodules",
  ".ripgreprc",
  ".mcp.json",
  ".vscode",
  ".idea",
  ".claude",
  ".git/hooks",
  ".git/config",
];

/** Whether `relative`, a path under a write root with `/` between the parts, is one the file calls keep read-only. */
export const isProtectedPath = (relative: string): boolean => PROTECTED_PATHS.test(relative);

/** Reads and writes workspace files from the host, inside the roots. */
export class HostFiles {
  private readonly modules: NodeModules;
  private readonly root: string;
  private readonly roots: RealRoots;
  private readonly protectedPath: ((relative: string) => boolean) | undefined;

  /**
   * `protectedPath` tells whether a path, relative to its write root with `/` between the parts, is one the backend
   * keeps read-only besides the `denyWrite` folders.
   */
  constructor(modules: NodeModules, root: string, roots: RealRoots, protectedPath?: (relative: string) => boolean) {
    this.modules = modules;
    this.root = root;
    this.roots = roots;
    this.protectedPath = protectedPath;
  }

  /** The real path of `path` against the workspace, or a denial when it is outside every one of `roots`. */
  private async contain(
    path: string,
    roots: readonly string[],
    kind: SandboxDenial["kind"],
    rule: string,
  ): Promise<string> {
    const { modules } = this;
    const real = await realPathOfMissing(modules, modules.path.resolve(this.root, path));
    if (roots.some((root) => inside(modules, root, real))) return real;
    throw new SandboxDeniedError({ kind, target: path, reason: rule });
  }

  /** Throws a denial when `real` is a path that stays read-only: a `denyWrite` folder or one the backend protects. */
  private refuseProtected(real: string, path: string): void {
    const { modules, roots } = this;
    const inDenied = roots.denyWrite.some((folder) => inside(modules, folder, real));
    const owner = roots.write.find((root) => inside(modules, root, real));
    const relative = owner === undefined ? "" : modules.path.relative(owner, real).split(modules.path.sep).join("/");
    if (inDenied || this.protectedPath?.(relative) === true) {
      throw new SandboxDeniedError({
        kind: "filesystem_write",
        target: path,
        reason: "the path is one the sandbox keeps read-only",
      });
    }
  }

  /** The real path of the file that `handle` opened, or a denial unless it is inside one of `roots`. */
  private async checkOpened(
    handle: import("node:fs/promises").FileHandle,
    roots: readonly string[],
    kind: SandboxDenial["kind"],
    path: string,
  ): Promise<string> {
    const { modules } = this;
    const opened = await modules.fs.realpath(`/proc/self/fd/${handle.fd}`).catch(() => undefined);
    if (opened === undefined || !roots.some((root) => inside(modules, root, opened))) {
      throw new SandboxDeniedError({ kind, target: path, reason: "the file opened is outside the roots" });
    }
    return opened;
  }

  /** The error for a file call that the OS failed: a denial when it refused, a missing file, or an I/O error. */
  private fileFailure(error: unknown, kind: SandboxDenial["kind"], path: string): unknown {
    if (isHarnessError(error)) return error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return new HarnessError("sandbox_not_found", `no such file: ${path}`, { cause: error });
    if (code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ELOOP") {
      return new SandboxDeniedError({ kind, target: path, reason: "the OS refused it" });
    }
    return new HarnessError("sandbox_io_failed", `the file call on ${path} failed: ${code ?? String(error)}`, {
      cause: error,
    });
  }

  async readFile(path: string): Promise<Uint8Array> {
    const { modules, roots } = this;
    const readable = [...roots.read, ...roots.write];
    const target = await this.contain(path, readable, "filesystem_read", "the path is outside the read roots");
    const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = modules.fs.constants;
    try {
      // Opened without blocking, so a pipe the agent made can't hold the call: only a regular file is read.
      const handle = await modules.fs.open(target, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
      try {
        await this.checkOpened(handle, readable, "filesystem_read", path);
        const stats = await handle.stat();
        if (!stats.isFile()) {
          throw new HarnessError("sandbox_io_failed", `the path ${target} is not a regular file`);
        }
        if (stats.size > MAX_FILE_BYTES) {
          throw new HarnessError("sandbox_io_failed", `the file ${target} is larger than ${MAX_FILE_BYTES} bytes`);
        }
        const bytes = new Uint8Array(stats.size);
        const { bytesRead } = await handle.read(bytes, 0, stats.size, 0);
        return bytes.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw this.fileFailure(error, "filesystem_read", path);
    }
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    if (data.length > MAX_FILE_BYTES) {
      throw new HarnessError("sandbox_io_failed", `a file larger than ${MAX_FILE_BYTES} bytes can't be written`);
    }
    const { modules, roots } = this;
    const rule = "the path is outside the write roots";
    const target = await this.contain(path, roots.write, "filesystem_write", rule);
    this.refuseProtected(target, path);
    const { O_WRONLY, O_CREAT, O_NOFOLLOW, O_NONBLOCK } = modules.fs.constants;
    try {
      await modules.fs.mkdir(modules.path.dirname(target), { recursive: true });
      // Opened without O_TRUNC, so a file that turns out to be outside the roots is not emptied before the check.
      const handle = await modules.fs.open(target, O_WRONLY | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0o666);
      try {
        this.refuseProtected(await this.checkOpened(handle, roots.write, "filesystem_write", path), path);
        if (!(await handle.stat()).isFile()) {
          throw new HarnessError("sandbox_io_failed", `the path ${target} is not a regular file`);
        }
        await handle.truncate(0);
        await handle.writeFile(data);
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw this.fileFailure(error, "filesystem_write", path);
    }
  }
}
