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
// A name that says it holds a credential, matched by each `_`-separated segment so `GIT_AUTHOR_NAME` and
// `KEYBOARD_LAYOUT` pass and `GH_PAT` and `ANTHROPIC_API_KEY` don't. These reach a child only through `extra`, where the
// caller writes the value in code, such as a dummy key for a proxy, and never by being copied from the parent.
// A word that ends a part catches a joined one such as `GITHUBTOKEN`; a short word must be the whole part, so `PATH` and
// `PASSIVE` pass. `PASS` and `AUTH` refuse a name like `PASS_THROUGH`, which is the safe side: it passes as an `extra`.
const CREDENTIAL_ENDING = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$/;
const CREDENTIAL_WORD = /^(PASS|PGPASS|PAT|AUTH|AUTHORIZATION|COOKIE|DSN)$/;
// Names that hold a credential without a word that says so: a connection string or a proxy URL can carry a password.
const CREDENTIAL_NAMES = new Set([
  "DATABASE_URL",
  "REDIS_URL",
  "MONGODB_URI",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NPM_CONFIG__AUTH",
]);
// Names that make a program load the caller's code or change where it looks, which a copy from the parent must not do.
const LOADER_NAMES = new Set([
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "BASH_ENV",
  "ENV",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PERL5OPT",
  "RUBYOPT",
  "LD_AUDIT",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_COUNT",
]);

/**
 * Why a variable named by a config the host did not write may not be set in a child's environment, or `undefined` when
 * it may: a reserved name would replace the cleared `PATH`, `HOME`, `TMPDIR` or `LANG`, and a loader name such as
 * `NODE_OPTIONS` would make the child load other code. `extra` accepts both, because the host writes it; a project file
 * must not.
 */
export function protectedNameReason(name: string): string | undefined {
  if (!NAME.test(name)) return `${JSON.stringify(name)} is not a valid variable name`;
  if (RESERVED.includes(name.toUpperCase())) return `${name} is set by spawnEnv() itself`;
  if (LOADER_NAMES.has(name.toUpperCase())) return `${name} changes what a program loads`;
  return undefined;
}

function looksLikeCredential(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    CREDENTIAL_NAMES.has(upper) ||
    upper.split("_").some((part) => CREDENTIAL_ENDING.test(part) || CREDENTIAL_WORD.test(part))
  );
}

// The parent's PATH without an entry that isn't absolute, because "." or an empty entry would run a program from
// whatever folder a command starts in. It falls back to `DEFAULT_PATH` when nothing absolute is left.
function safePath(parentPath: string | undefined, path: typeof import("node:path")): string {
  const kept = (parentPath ?? "").split(path.delimiter).filter((entry) => path.isAbsolute(entry));
  return kept.length > 0 ? kept.join(path.delimiter) : DEFAULT_PATH;
}

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
 * `PATH` is the parent's with every entry that isn't absolute removed, and `TMPDIR` is the shared temp directory.
 * When `extra` sets `HOME`, no temp folder is made.
 *
 * `allow` takes plain names, such as `DOCKER_HOST`. It refuses a reserved name (`PATH`, `HOME`, `TMPDIR`, `LANG`), which
 * is always set already; a name that looks like a credential, because a `_`-separated part of it is `KEY`, `TOKEN`,
 * `SECRET`, `PASSWORD`, `PAT`, `AUTH` and the like, or because it is a connection string or a proxy URL such as
 * `DATABASE_URL`; and a name that makes a program load code, such as `NODE_OPTIONS` or `LD_PRELOAD`. A credential can
 * reach a child only as an explicit `extra`. The check goes by name, so it can't catch a credential under an
 * unremarkable name. `extra` overrides everything and holds the values the caller writes itself.
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
    if (LOADER_NAMES.has(name.toUpperCase())) {
      throw refuse(`${name} changes what a program loads, so it can't be copied from the parent; pass it in \`extra\``);
    }
    if (looksLikeCredential(name)) {
      throw refuse(
        `${name} looks like a credential, so it can't be copied from the parent; pass it in \`extra\` if the child needs it`,
      );
    }
  }
  for (const [name, value] of Object.entries(extra)) {
    checkName(name);
    checkValue(name, value);
  }
  // A caller's own HOME replaces ours, so making a folder for it would leave one behind that nothing removes.
  const home = "HOME" in extra ? extra.HOME : fs.mkdtempSync(path.join(os.tmpdir(), "buildanagent-home-"));
  const env: Record<string, string> = {
    PATH: safePath(process.env.PATH, path),
    HOME: home as string,
    TMPDIR: os.tmpdir(),
    LANG: process.env.LANG ?? DEFAULT_LANG,
  };
  for (const name of allow) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}
