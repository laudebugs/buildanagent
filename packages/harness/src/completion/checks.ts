/**
 * Which commands check a finished task: the project's own list in `.agents/harness.json`, or else the ones the harness
 * finds. A configured list replaces discovery, so a project can name a different set, or an empty one to run nothing.
 */
import { HarnessError } from "../errors.js";
import type { Sandbox } from "../sandbox/types.js";

/** Where a project lists its checks, relative to the workspace root. */
export const HARNESS_CONFIG_PATH = ".agents/harness.json";

/** The `package.json` scripts discovery runs, in the order it runs them. */
export const DISCOVERED_SCRIPTS: readonly string[] = ["typecheck", "test", "check"];

/** The checks to run, and whether the project named them or the harness found them. */
export interface ResolvedChecks {
  readonly source: "configured" | "discovered";
  /** Each check as an executable and its arguments, run with no shell. */
  readonly commands: readonly (readonly string[])[];
}

// `test:` or `all test:`, but not a variable assignment such as `test := x` or `test ::= x`.
const MAKE_TEST_TARGET = /^(?:[\w.-]+[ \t]+)*test[ \t]*:(?!=|:=)/m;

const DECODER = new TextDecoder();

/** Reads a file as text, or returns `undefined` when it does not exist. Any other failure is thrown. */
async function readText(sandbox: Sandbox, path: string): Promise<string | undefined> {
  try {
    return DECODER.decode(await sandbox.readFile(path));
  } catch (error) {
    if (error instanceof HarnessError && error.code === "sandbox_not_found") return undefined;
    throw error;
  }
}

function invalid(message: string): HarnessError {
  return new HarnessError("invalid_completion_config", `${HARNESS_CONFIG_PATH}: ${message}`);
}

/** One configured check: a string split on spaces, or a list that is the executable and its arguments. */
function commandOf(entry: unknown, index: number): string[] {
  if (typeof entry === "string") {
    const words = entry.trim().split(/\s+/);
    if (words[0] === "") throw invalid(`completionChecks[${index}] is an empty string`);
    return words;
  }
  if (Array.isArray(entry) && entry.length > 0 && entry.every((word) => typeof word === "string" && word !== "")) {
    return [...(entry as string[])];
  }
  throw invalid(`completionChecks[${index}] must be a command string or a non-empty list of non-empty strings`);
}

/** The configured checks, or `undefined` when the file or the key is absent. */
async function configuredChecks(sandbox: Sandbox): Promise<string[][] | undefined> {
  const text = await readText(sandbox, HARNESS_CONFIG_PATH);
  if (text === undefined) return undefined;
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch (cause) {
    throw new HarnessError("invalid_completion_config", `${HARNESS_CONFIG_PATH} is not valid JSON`, { cause });
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) throw invalid("it must hold an object");
  const list = (config as Record<string, unknown>).completionChecks;
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw invalid("completionChecks must be a list");
  return list.map(commandOf);
}

async function packageRunner(sandbox: Sandbox): Promise<string> {
  if ((await readText(sandbox, "pnpm-lock.yaml")) !== undefined) return "pnpm";
  if ((await readText(sandbox, "yarn.lock")) !== undefined) return "yarn";
  return "npm";
}

/** The `scripts` object of a `package.json`, or `undefined` when the text is not JSON or holds no such object. */
function scriptsOf(text: string): Record<string, unknown> | undefined {
  try {
    const scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
    return typeof scripts === "object" && scripts !== null ? (scripts as Record<string, unknown>) : undefined;
  } catch {
    // A package.json that is not JSON has no scripts to run; the project's own tools will say what is wrong with it.
    return undefined;
  }
}

/** The scripts of a `package.json` that discovery looks for, or none when the file is missing or unreadable as JSON. */
async function discoveredScripts(sandbox: Sandbox): Promise<string[]> {
  const text = await readText(sandbox, "package.json");
  const scripts = text === undefined ? undefined : scriptsOf(text);
  if (scripts === undefined) return [];
  return DISCOVERED_SCRIPTS.filter((name) => typeof scripts[name] === "string");
}

/**
 * Finds what checks the task. `completionChecks` in `.agents/harness.json` wins: each entry is a command string, split
 * on spaces, or a list of an executable and its arguments, and neither goes through a shell. Without it, the harness
 * runs the `package.json` scripts `typecheck`, `test` and `check`, in that order, when they exist, with the runner the
 * lockfile names (`pnpm`, `yarn`, else `npm`), and a `Makefile` `test` target when no script matched.
 * Throws a `HarnessError` with code `invalid_completion_config` for a config file that can't be read as described.
 */
export async function resolveChecks(sandbox: Sandbox): Promise<ResolvedChecks> {
  const configured = await configuredChecks(sandbox);
  if (configured !== undefined) return { source: "configured", commands: configured };
  const scripts = await discoveredScripts(sandbox);
  if (scripts.length > 0) {
    const runner = await packageRunner(sandbox);
    return { source: "discovered", commands: scripts.map((name) => [runner, "run", name]) };
  }
  const makefile = await readText(sandbox, "Makefile");
  if (makefile !== undefined && MAKE_TEST_TARGET.test(makefile)) {
    return { source: "discovered", commands: [["make", "test"]] };
  }
  return { source: "discovered", commands: [] };
}

/**
 * The parts of the workspace that decide what a check does, as text: the config file, the bodies of the `package.json`
 * scripts discovery names and the resolved checks run (with their `pre` and `post` hooks), and the `Makefile` `test` rule. Each is `undefined` when absent.
 */
export interface CheckConfig {
  readonly harnessConfig: string | undefined;
  readonly scripts: ReadonlyMap<string, string | undefined>;
  readonly makeTestRule: string | undefined;
}

/** The `test` rule of a `Makefile`: its target line and the tab-indented recipe lines after it. */
function makeTestRule(makefile: string): string | undefined {
  const match = MAKE_TEST_TARGET.exec(makefile);
  if (match === null) return undefined;
  const lines = makefile.slice(match.index).split("\n");
  const end = lines.findIndex((line, index) => index > 0 && !line.startsWith("\t"));
  return lines.slice(0, end === -1 ? lines.length : end).join("\n");
}

const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun"]);

/**
 * The `package.json` scripts a set of commands runs through a package runner (`npm run e2e`, `pnpm lint`), each with its
 * `pre` and `post` hooks, because npm and yarn run those hooks too. Flags are skipped, and a command that is not a
 * package runner names none.
 */
export function scriptNamesOf(commands: readonly (readonly string[])[]): string[] {
  const names = new Set<string>();
  for (const [runner, ...rest] of commands) {
    if (runner === undefined || !PACKAGE_RUNNERS.has(runner)) continue;
    const words = rest.filter((word) => !word.startsWith("-"));
    const name = words[0] === "run" || words[0] === "run-script" ? words[1] : words[0];
    if (name !== undefined) for (const each of [name, `pre${name}`, `post${name}`]) names.add(each);
  }
  return [...names];
}

/**
 * Reads the check config. The scripts it tracks are the discovered ones plus `extra`, the scripts the resolved checks
 * run. Throws what the sandbox throws for a file it can't read, except a missing one.
 */
export async function readCheckConfig(sandbox: Sandbox, extra: readonly string[] = []): Promise<CheckConfig> {
  const harnessConfig = await readText(sandbox, HARNESS_CONFIG_PATH);
  const packageJson = await readText(sandbox, "package.json");
  const makefile = await readText(sandbox, "Makefile");
  const scripts = packageJson === undefined ? undefined : scriptsOf(packageJson);
  return {
    harnessConfig,
    scripts: new Map(
      [...new Set([...DISCOVERED_SCRIPTS, ...extra])].map((name) => {
        const body = scripts?.[name];
        return [name, typeof body === "string" ? body : undefined];
      }),
    ),
    makeTestRule: makefile === undefined ? undefined : makeTestRule(makefile),
  };
}

/**
 * One flag for each part of the check config that differs between `before` and `after`. The harness runs the checks it
 * resolved before the turn, but a package runner reads a script's body when it runs, and `make` reads the `Makefile`,
 * so an edit to either changes what a check does even though the command is the same.
 */
export function configChanges(before: CheckConfig, after: CheckConfig): string[] {
  const flags: string[] = [];
  if (before.harnessConfig !== after.harnessConfig) flags.push(`check config changed: ${HARNESS_CONFIG_PATH}`);
  for (const name of before.scripts.keys()) {
    if (before.scripts.get(name) !== after.scripts.get(name)) {
      flags.push(`check config changed: package.json script ${name}`);
    }
  }
  if (before.makeTestRule !== after.makeTestRule) flags.push("check config changed: Makefile test target");
  return flags;
}
