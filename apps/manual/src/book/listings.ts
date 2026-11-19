import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, matchesGlob, normalize, relative, sep } from "node:path";
import { z } from "astro/zod";
import { parse as parseYaml } from "yaml";
import type { ProblemList } from "./problems.js";
import { cutRegion, type SourceLine } from "./regions.js";

/** A `::listing` resolved against the repository: the lines it shows and what its caption says. */
export interface ListingSource {
  /** The listed file's path from the repository root, with forward slashes. */
  readonly path: string;
  readonly region: string | undefined;
  readonly lines: readonly SourceLine[];
  /** The harness directory the file belongs to, such as `verify/vercel-ai-sdk`. */
  readonly harness: string;
  /** The harness's main package at its pinned version, such as `ai@7.0.162`. */
  readonly pin: string;
  /** The Shiki language the file is highlighted as. */
  readonly lang: "typescript" | "tsx";
}

/** The attributes a `::listing` directive takes. */
export const LISTING_ATTRIBUTES = ["id", "file", "region"] as const;

/** One entry of `src/data/harnesses.json`: a harness directory and the package whose pin its listings show. */
const harnessSchema = z.tuple([
  z.string().regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)+$/, "a harness is a directory path such as verify/vercel-ai-sdk"),
  z.string().trim().min(1, "a harness needs its main package's name"),
]);

/** Everything resolving a listing needs: the repository, the harness table and the workspace's package globs. */
export interface ListingContext {
  readonly repoRoot: string;
  /** Harness directory, relative to the repository root, to its main package. */
  readonly harnesses: ReadonlyMap<string, string>;
  /** The harness table's file, as messages name it. */
  readonly harnessesName: string;
  /** The `packages` globs of `pnpm-workspace.yaml`, or undefined when the repository has no such file. */
  readonly workspace: readonly string[] | undefined;
}

/** The extensions TypeScript checks without `allowJs`, and the Shiki language for each. */
const LANGUAGES: Readonly<Record<string, ListingSource["lang"]>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
};

/** Reads the harness table and the workspace globs once per book load; problems name the harness table's file. */
export function listingContext(
  repoRoot: string,
  harnessesFile: string,
  harnessesName: string,
  problems: ProblemList,
): ListingContext {
  const harnesses = new Map<string, string>();
  try {
    const table: unknown = JSON.parse(readFileSync(harnessesFile, "utf8"));
    if (typeof table !== "object" || table === null || Array.isArray(table)) {
      problems.add(harnessesName, "the harness table is an object from each harness directory to its main package");
    } else {
      // Each entry is checked on its own, so one bad entry is one problem and the others still give their pins.
      for (const entry of Object.entries(table)) {
        const parsed = harnessSchema.safeParse(entry);
        if (parsed.success) harnesses.set(...parsed.data);
        else
          problems.add(harnessesName, `${entry[0]}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      }
    }
  } catch (error) {
    problems.add(
      harnessesName,
      `cannot read this file as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const workspaceFile = join(repoRoot, "pnpm-workspace.yaml");
  let workspace: string[] | undefined;
  if (existsSync(workspaceFile)) {
    const packages = (parseYaml(readFileSync(workspaceFile, "utf8")) as { packages?: unknown } | null)?.packages;
    workspace = Array.isArray(packages) ? packages.filter((glob): glob is string => typeof glob === "string") : [];
  }
  return { repoRoot, harnesses, harnessesName, workspace };
}

const toPosix = (path: string): string => path.split(sep).join("/");

/**
 * Resolves a `::listing{#id file="…" region="…"}` against the repository: the file must exist inside it, be
 * TypeScript that a workspace package's `typecheck` covers, belong to a harness with a pinned main package, and hold
 * the region. Returns the listing, or the message of the first rule it breaks.
 */
export function resolveListing(
  attributes: Readonly<Record<string, string | null | undefined>>,
  context: ListingContext,
): ListingSource | { readonly message: string } {
  const unknown = Object.keys(attributes).filter((key) => !(LISTING_ATTRIBUTES as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return {
      message: `::listing does not take ${unknown.map((key) => `"${key}"`).join(", ")}; it takes id, file and region`,
    };
  }
  const { file, region } = attributes;
  if (!file) return { message: '::listing needs the file it shows, written file="verify/<sdk>/examples/<name>.ts"' };
  const absolute = join(context.repoRoot, file);
  const path = toPosix(relative(context.repoRoot, absolute));
  if (isAbsolute(file) || path.startsWith("../") || path !== toPosix(normalize(file))) {
    return { message: `::listing file="${file}" must be a path from the repository root, without ./ or ..` };
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return { message: `${path} is not a file` };
  const lang = LANGUAGES[extname(path)];
  if (lang === undefined) return { message: `${path} is not TypeScript, so no typecheck checks it` };
  const unchecked = uncovered(absolute, context);
  if (unchecked !== undefined) return { message: unchecked };
  const pinned = pinOf(path, context);
  if ("message" in pinned) return pinned;
  const lines = cutRegion(readFileSync(absolute, "utf8"), region ?? undefined);
  if ("message" in lines) {
    return {
      message: lines.line === undefined ? `${path} ${lines.message}` : `${path}:${lines.line}: ${lines.message}`,
    };
  }
  return { path, region: region ?? undefined, lines, ...pinned, lang };
}

/** The harness the file sits in and its main package's exact pin, as `name@version`, or why there is none. */
function pinOf(
  path: string,
  context: ListingContext,
): { readonly harness: string; readonly pin: string } | { readonly message: string } {
  const harness = [...context.harnesses.keys()].find((dir) => path.startsWith(`${dir}/`));
  if (harness === undefined) {
    return { message: `${path} is in no harness that ${context.harnessesName} lists, so its listing has no pin` };
  }
  const name = context.harnesses.get(harness) ?? "";
  const manifest = join(context.repoRoot, harness, "package.json");
  const where = `${harness}/package.json`;
  if (!existsSync(manifest)) return { message: `${where} does not exist, so ${name} has no pin` };
  const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(manifest, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const version = dependencies[name] ?? devDependencies[name];
  if (version === undefined) {
    return { message: `${where} does not depend on ${name}, the main package ${context.harnessesName} names for it` };
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    return { message: `${where} pins ${name} as "${version}", not an exact version, so the caption cannot show it` };
  }
  return { harness, pin: `${name}@${version}` };
}

/**
 * Why no `typecheck` covers the file, or undefined when one does. The file's package is the nearest directory above
 * it with a `package.json`; that directory must match a `pnpm-workspace.yaml` glob, so `pnpm typecheck` runs its
 * script, and one `tsc -p <config>` in that script must include the file.
 */
function uncovered(file: string, context: ListingContext): string | undefined {
  const path = toPosix(relative(context.repoRoot, file));
  const outside = `${path} is outside every tsconfig.json that a workspace package's typecheck runs`;
  const pkg = packageDir(file, context.repoRoot);
  if (pkg === undefined) return `${outside}: no package.json above it`;
  const pkgPath = toPosix(relative(context.repoRoot, pkg));
  if (!context.workspace?.some((glob) => !glob.startsWith("!") && matchesGlob(pkgPath, glob))) {
    return `${outside}: ${pkgPath} is not a package of pnpm-workspace.yaml`;
  }
  const script = (JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as { scripts?: Record<string, string> })
    .scripts?.typecheck;
  const configs = script === undefined ? [] : tscProjects(script).map((project) => join(pkg, project));
  if (configs.length === 0) return `${outside}: ${pkgPath}/package.json has no typecheck script that runs tsc`;
  if (configs.some((config) => includes(config, file))) return undefined;
  return `${outside}: ${configs.map((config) => toPosix(relative(context.repoRoot, config))).join(", ")} does not include it`;
}

function packageDir(file: string, repoRoot: string): string | undefined {
  for (let dir = dirname(file); dir.startsWith(repoRoot); dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dir === repoRoot) break;
  }
  return undefined;
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

/** A tsconfig.json's text without its comments and trailing commas, which TypeScript allows and JSON does not. */
export function stripJsonComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end - 1;
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

/** The index just past the JSON string that starts at `start`. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}

interface TsConfig {
  readonly extends?: string | string[];
  readonly include?: string[];
  readonly exclude?: string[];
  readonly files?: string[];
}

function readConfig(config: string): TsConfig | undefined {
  if (!existsSync(config)) return undefined;
  return JSON.parse(stripJsonComments(readFileSync(config, "utf8"))) as TsConfig;
}

/**
 * The `files`, `include` and `exclude` that apply to a tsconfig, each with the directory its paths are relative to.
 * A config that sets none of the three takes them from the config it extends, as TypeScript does.
 */
function fileSettings(config: string, seen = new Set<string>()): { dir: string; settings: TsConfig } | undefined {
  const settings = readConfig(config);
  if (settings === undefined || seen.has(config)) return undefined;
  seen.add(config);
  if (settings.files || settings.include || settings.exclude) return { dir: dirname(config), settings };
  const bases = [settings.extends ?? []].flat();
  for (const base of bases.toReversed()) {
    if (!base.startsWith(".")) continue;
    const resolved = join(dirname(config), extname(base) === ".json" ? base : `${base}.json`);
    const found = fileSettings(resolved, seen);
    if (found !== undefined) return found;
  }
  return { dir: dirname(config), settings: {} };
}

/** A tsconfig `include` or `exclude` entry as a glob: a path without a wildcard or an extension is a directory. */
const asGlob = (pattern: string): string =>
  /[*?]/.test(pattern) || extname(pattern) !== "" ? pattern : `${pattern.replace(/\/$/, "")}/**/*`;

/** Whether the tsconfig at `config` type-checks `file`, by its `files`, `include` and `exclude`. */
function includes(config: string, file: string): boolean {
  const found = fileSettings(config);
  if (found === undefined) return false;
  const { dir, settings } = found;
  const path = toPosix(relative(dir, file));
  if (path.startsWith("../")) return false;
  if (settings.files?.some((entry) => toPosix(normalize(entry)) === path)) return true;
  const include = settings.include ?? (settings.files ? [] : ["**/*"]);
  const exclude = settings.exclude ?? ["node_modules", "bower_components", "jspm_packages"];
  const matches = (patterns: readonly string[]) =>
    patterns.some((pattern) => matchesGlob(path, asGlob(toPosix(normalize(pattern)))));
  return matches(include) && !matches(exclude);
}
