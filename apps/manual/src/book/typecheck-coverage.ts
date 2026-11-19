import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, join, matchesGlob, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const toPosix = (path: string): string => path.split(sep).join("/");

/** Whether `path` is `dir` or lies inside it, comparing whole path segments. */
export const isInside = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}${sep}`);

/** The `packages` globs of the repository's `pnpm-workspace.yaml`, or undefined when it has none. */
export function readWorkspace(repoRoot: string): readonly string[] | undefined {
  const file = join(repoRoot, "pnpm-workspace.yaml");
  if (!existsSync(file)) return undefined;
  const packages = (parseYaml(readFileSync(file, "utf8")) as { packages?: unknown } | null)?.packages;
  return Array.isArray(packages) ? packages.filter((glob): glob is string => typeof glob === "string") : [];
}

/**
 * Whether a package directory, relative to the repository root, is a workspace package: some glob matches it and no
 * `!` glob excludes it, as pnpm reads `pnpm-workspace.yaml`.
 */
export function inWorkspace(dir: string, globs: readonly string[]): boolean {
  // pnpm reads `!./packages/legacy` as `!packages/legacy`, and `./packages/*` as `packages/*`.
  const plain = (glob: string) => glob.replace(/^\.\//, "");
  const excluded = globs.filter((glob) => glob.startsWith("!")).some((glob) => matchesGlob(dir, plain(glob.slice(1))));
  return !excluded && globs.some((glob) => !glob.startsWith("!") && matchesGlob(dir, plain(glob)));
}

/** The tsconfig files a `typecheck` script's `tsc` commands check: each `-p`/`--project`, else `tsconfig.json`. */
export function tscProjects(script: string): string[] {
  return script
    .split(/&&|\|\||;/)
    .map((command) => command.trim().split(/\s+/))
    .filter((words) => words[0] === "tsc")
    .map((words) => {
      const flag = words.findIndex((word) => word === "-p" || word === "--project");
      const project = flag === -1 ? "tsconfig.json" : (words[flag + 1] ?? "tsconfig.json");
      return extname(project) === ".json" ? project : join(project, "tsconfig.json");
    });
}

/** The workspace's own `tsc`, found by walking up from this module to the nearest `node_modules/.bin`. */
function tscBin(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const bin = join(dir, "node_modules", ".bin", "tsc");
    if (existsSync(bin)) return bin;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("cannot find node_modules/.bin/tsc above the book's code");
    dir = parent;
  }
}

/**
 * Answers whether a workspace package's `typecheck` checks a file, by asking TypeScript itself: `tsc -p <config>
 * --listFilesOnly` prints every file the program holds, after `extends`, `files`, `include`, `exclude` and the files
 * that included files import. Each config's list is read once per book load.
 */
export class TypecheckCoverage {
  readonly #repoRoot: string;
  readonly #workspace: readonly string[] | undefined;
  readonly #programs = new Map<string, ReadonlySet<string> | { readonly error: string }>();

  constructor(repoRoot: string, workspace: readonly string[] | undefined) {
    // resolve() drops a trailing separator, so the segment-wise comparison in #packageDir holds.
    this.#repoRoot = resolve(repoRoot);
    this.#workspace = workspace;
  }

  /**
   * Why no `typecheck` covers the file, or undefined when one does. The file's package is the nearest directory above
   * it with a `package.json`; it must be a workspace package, so `pnpm typecheck` runs its script, and one
   * `tsc -p <config>` in that script must hold the file in its program.
   */
  uncovered(file: string): string | undefined {
    const path = toPosix(relative(this.#repoRoot, file));
    const outside = `${path} is outside every tsconfig.json that a workspace package's typecheck runs`;
    const pkg = this.#packageDir(file);
    if (pkg === undefined) return `${outside}: no package.json above it`;
    const pkgPath = toPosix(relative(this.#repoRoot, pkg));
    if (this.#workspace === undefined || !inWorkspace(pkgPath, this.#workspace)) {
      return `${outside}: ${pkgPath} is not a package of pnpm-workspace.yaml`;
    }
    const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = manifest.scripts;
    const configs = scripts?.typecheck === undefined ? [] : tscProjects(scripts.typecheck).map((p) => join(pkg, p));
    if (configs.length === 0) return `${outside}: ${pkgPath}/package.json has no typecheck script that runs tsc`;
    const real = realpathSync(file);
    const errors: string[] = [];
    for (const config of configs) {
      const program = this.#program(config);
      if ("error" in program) errors.push(program.error);
      else if (program.has(real)) return undefined;
    }
    const named = configs.map((config) => toPosix(relative(this.#repoRoot, config))).join(", ");
    return `${outside}: ${errors.length > 0 ? errors.join("; ") : `${named} does not include it`}`;
  }

  #packageDir(file: string): string | undefined {
    for (let dir = dirname(file); isInside(dir, this.#repoRoot); dir = dirname(dir)) {
      if (existsSync(join(dir, "package.json"))) return dir;
      if (dir === this.#repoRoot) break;
    }
    return undefined;
  }

  /** The real paths of the files `tsc -p config` checks, read once, or why tsc could not list them. */
  #program(config: string): ReadonlySet<string> | { readonly error: string } {
    const known = this.#programs.get(config);
    if (known !== undefined) return known;
    const shown = toPosix(relative(this.#repoRoot, config));
    let program: ReadonlySet<string> | { readonly error: string };
    if (!existsSync(config)) {
      program = { error: `${shown} does not exist` };
    } else {
      const home = mkdtempSync(join(tmpdir(), "book-tsc-"));
      try {
        // An allowlisted environment, never ...process.env (AGENTS.md); tsc reads no credentials.
        const result = spawnSync(tscBin(), ["-p", config, "--listFilesOnly"], {
          cwd: dirname(config),
          encoding: "utf8",
          env: {
            PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
            HOME: home,
            TMPDIR: tmpdir(),
            LANG: "C.UTF-8",
          },
        });
        const files = (result.stdout ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "" && !line.includes(`${sep}node_modules${sep}`) && existsSync(line));
        // A config whose include matches nothing makes tsc report TS18003 and list no files: an empty program.
        const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
        const failed = result.error !== undefined || (files.length === 0 && /error TS(?!18003)/.test(output));
        program = failed
          ? { error: `tsc -p ${shown} --listFilesOnly failed: ${firstLine(result)}` }
          : new Set(files.map((line) => realpathSync(line)));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
    this.#programs.set(config, program);
    return program;
  }
}

function firstLine(result: { stdout?: string | null; stderr?: string | null; error?: Error }): string {
  const text = result.error?.message ?? `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  return text.split("\n").find((line) => line.trim() !== "") ?? "no output";
}
