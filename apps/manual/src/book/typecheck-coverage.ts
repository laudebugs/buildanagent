import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";
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

/**
 * The manual's own `tsc`: `node_modules/.bin/tsc` in the `@buildanagent/manual` package, which pins `typescript` like
 * the repository root does. The walk up from this module stops at that package, so no `tsc` outside it ever runs; it
 * works from `src/book/` and from the pages' bundle in `dist/.prerender/chunks/`. Undefined when it is not installed.
 */
export function manualTsc(): string | undefined {
  for (let dir = dirname(fileURLToPath(import.meta.url)); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, "utf8")).name !== "@buildanagent/manual") continue;
    const bin = join(dir, "node_modules", ".bin", "tsc");
    return existsSync(bin) ? bin : undefined;
  }
  return undefined;
}

// Programs shared by every load in this process, each as the real paths of its files, so the two loads of one build
// (the config's and the pages') and repeated `check:book` loads run tsc once per config. The key is the config's real
// path and the real path and content of every config in its `extends` chain, so a different config, or any edit to
// the chain, lists the program again. An edit outside the chain can change a program too, as when an example stops
// importing a file; a running process then keeps the old answer until the chain changes, and a new build or
// `check:book` run sees the edit.
const programs = new Map<string, ReadonlySet<string>>();

/** A tsconfig's text without comments and trailing commas, enough to read its `extends`. */
function stripJsonComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * The config and every config it extends, in the order TypeScript reads them, as real paths. A relative `extends`
 * resolves from the config's directory, with `.json` added when it has no extension; a package `extends` resolves
 * through Node's module resolution, to the package's own path or its `tsconfig.json`. A config whose text cannot be
 * read as JSON still counts, by its content, without the configs it would extend.
 */
export function extendsChain(config: string, seen: Set<string> = new Set()): string[] {
  if (!existsSync(config)) return [];
  const real = realpathSync(config);
  if (seen.has(real)) return [];
  seen.add(real);
  let bases: string[] = [];
  try {
    const parsed = JSON.parse(stripJsonComments(readFileSync(real, "utf8"))) as { extends?: string | string[] };
    bases = [parsed.extends ?? []].flat();
  } catch {
    // tsc reports the broken config; the key still holds its content.
  }
  const require = createRequire(real);
  const resolved = bases.flatMap((base) => {
    if (base.startsWith(".") || isAbsolute(base)) {
      return [resolve(dirname(real), extname(base) === ".json" ? base : `${base}.json`)];
    }
    for (const candidate of [base, `${base}/tsconfig.json`]) {
      try {
        return [require.resolve(candidate)];
      } catch {
        // Try the next form; a package that resolves to neither is left out, and tsc reports it.
      }
    }
    return [];
  });
  return [real, ...resolved.flatMap((base) => extendsChain(base, seen))];
}

/** The key of a config's program: the real path and content of each config in its `extends` chain. */
function programKey(config: string): string {
  const hash = createHash("sha256");
  for (const file of extendsChain(config)) hash.update(`\0${file}\0`).update(readFileSync(file));
  return hash.digest("hex");
}

/**
 * Answers whether a workspace package's `typecheck` checks a file, by asking TypeScript itself: `tsc -p <config>
 * --listFilesOnly` prints every file the program holds, after `extends`, `files`, `include`, `exclude` and the files
 * that included files import. Loads share each program by the config's real path and its `extends` chain. A file
 * missing from a shared program makes this load list the config again, once, so a file added since then is found.
 */
export class TypecheckCoverage {
  readonly #repoRoot: string;
  readonly #workspace: readonly string[] | undefined;
  readonly #tsc: string | undefined;
  /** The configs this load has already listed, so a miss lists each one at most once per load. */
  readonly #listed = new Set<string>();
  readonly #errors = new Map<string, string>();

  /** `tsc` defaults to the manual's own; the tests pass another path to reach the failure messages. */
  constructor(repoRoot: string, workspace: readonly string[] | undefined, options: { readonly tsc?: string } = {}) {
    // resolve() drops a trailing separator, so the segment-wise comparison in #packageDir holds.
    this.#repoRoot = resolve(repoRoot);
    this.#workspace = workspace;
    this.#tsc = options.tsc ?? manualTsc();
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
      const covered = this.#covers(config, real);
      if (typeof covered === "string") errors.push(covered);
      else if (covered) return undefined;
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

  /** Whether `tsc -p config` holds the file, or why tsc could not list the program. */
  #covers(config: string, file: string): boolean | string {
    const shown = toPosix(relative(this.#repoRoot, config));
    if (!existsSync(config)) return `${shown} does not exist`;
    const known = this.#errors.get(config);
    if (known !== undefined) return known;
    const key = programKey(config);
    const cached = programs.get(key);
    if (cached !== undefined && (cached.has(file) || this.#listed.has(key))) return cached.has(file);
    this.#listed.add(key);
    const listed = this.#list(config, shown);
    if (typeof listed === "string") {
      this.#errors.set(config, listed);
      return listed;
    }
    const files = new Set(listed.map((line) => realpathSync(line)));
    programs.set(key, files);
    return files.has(file);
  }

  /** The files `tsc -p config --listFilesOnly` prints outside `node_modules`, or why tsc could not list them. */
  #list(config: string, shown: string): string[] | string {
    if (this.#tsc === undefined || !existsSync(this.#tsc)) {
      return `cannot run tsc to list ${shown}: apps/manual/node_modules/.bin/tsc is missing; run pnpm install`;
    }
    const home = mkdtempSync(join(tmpdir(), "book-tsc-"));
    try {
      // An allowlisted environment, never ...process.env (AGENTS.md); tsc reads no credentials.
      const result = spawnSync(this.#tsc, ["-p", config, "--listFilesOnly"], {
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
      return failed ? `tsc -p ${shown} --listFilesOnly failed: ${firstLine(result)}` : files;
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
}

function firstLine(result: { stdout?: string | null; stderr?: string | null; error?: Error }): string {
  const text = result.error?.message ?? `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  return text.split("\n").find((line) => line.trim() !== "") ?? "no output";
}
