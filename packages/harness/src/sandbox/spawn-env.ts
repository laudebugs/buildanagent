/**
 * `spawnEnv()`: the cleared environment every process the harness spawns gets, so an inherited credential can never
 * reach a child (AGENTS.md, "Running third-party code"; ADR 0036). It is Node-only, because it reads the parent's
 * environment and makes a temp folder, so it loads Node's modules by `process.getBuiltinModule()` when it is called,
 * not by an import, and the sandbox entry still loads on a runtime without them.
 */
import { HarnessError } from "../errors.js";

// Where a child finds its programs when the parent has no PATH, which only a parent started without a shell lacks.
const DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin";
const DEFAULT_LANG = "C.UTF-8";
// The variables every child gets, by `spawnEnv()` itself. A caller names no other source for them.
const RESERVED = ["PATH", "HOME", "TMPDIR", "LANG"];
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A name that says it holds a credential. These reach a child only through `extra`, where the caller writes the value
// in code, such as a dummy key for a proxy, and never by being copied from the parent.
const CREDENTIAL_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;

function refuse(message: string): HarnessError {
  return new HarnessError("invalid_spawn_env", `spawnEnv: ${message}`);
}

function checkName(name: string): void {
  if (!NAME.test(name)) throw refuse(`${JSON.stringify(name)} is not a valid variable name`);
}

function checkValue(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw refuse(`the value of ${name} must be a string without a NUL character`);
  }
}

/**
 * The environment for a spawned process: `PATH`, a fresh temp `HOME`, `TMPDIR` and `LANG`, plus the parent variables
 * named in `allow` that are set, plus every `extra`. Nothing else is copied. `HOME` is a new folder under the temp
 * directory on each call, which the caller removes when the process is done, so a tool that writes dotfiles never
 * touches the real home.
 *
 * `allow` takes plain names, such as `DOCKER_HOST`. It refuses a reserved name (`PATH`, `HOME`, `TMPDIR`, `LANG`), which
 * is always set already, and a name that looks like a credential, such as `ANTHROPIC_API_KEY`, which can reach a
 * child only as an explicit `extra`. `extra` overrides everything and holds the values the caller writes itself.
 *
 * Throws a `HarnessError`, code `invalid_spawn_env`, for a name that isn't a variable name or a value that isn't a
 * string without a NUL character.
 */
export function spawnEnv(
  allow: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  for (const name of allow) {
    checkName(name);
    if (RESERVED.includes(name)) throw refuse(`${name} is always set, so it can't be allowed`);
    if (CREDENTIAL_NAME.test(name)) {
      throw refuse(
        `${name} looks like a credential, so it can't be copied from the parent; pass it in \`extra\` if the child needs it`,
      );
    }
  }
  for (const [name, value] of Object.entries(extra)) {
    checkName(name);
    checkValue(name, value);
  }
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? DEFAULT_PATH,
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), "buildanagent-home-")),
    TMPDIR: os.tmpdir(),
    LANG: process.env.LANG ?? DEFAULT_LANG,
  };
  for (const name of allow) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}
