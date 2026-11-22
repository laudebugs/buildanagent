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

/** The scripts of a `package.json` that discovery looks for, or none when the file is missing or unreadable as JSON. */
async function discoveredScripts(sandbox: Sandbox): Promise<string[]> {
  const text = await readText(sandbox, "package.json");
  if (text === undefined) return [];
  try {
    const scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
    if (typeof scripts !== "object" || scripts === null) return [];
    return DISCOVERED_SCRIPTS.filter((name) => typeof (scripts as Record<string, unknown>)[name] === "string");
  } catch {
    // A package.json that is not JSON has no scripts to run; the project's own tools will say what is wrong with it.
    return [];
  }
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
  if (makefile !== undefined && /^test\s*:/m.test(makefile)) {
    return { source: "discovered", commands: [["make", "test"]] };
  }
  return { source: "discovered", commands: [] };
}
