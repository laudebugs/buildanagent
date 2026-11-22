/**
 * `builtinTools()`: the harness's own tools, bound to one provisioned sandbox and one egress proxy. Nothing here
 * touches the host: files go through the sandbox's file calls, commands through its `exec()`, and the web through the
 * proxy, so the module stays portable and the backend decides what each call can reach.
 */
import type { Sandbox, SandboxPolicy } from "../../sandbox/types.js";
import type { RegisteredTool } from "../types.js";
import { bashTool } from "./bash.js";
import { type FetchProxy, fetchTool } from "./fetch.js";
import { editTool, readTool, writeTool } from "./files.js";
import { boundsOf } from "./paths.js";
import { globTool, grepTool } from "./search.js";

/** The options of `builtinTools()`. */
export interface BuiltinToolsOptions {
  /** The workspace root the sandbox was provisioned with. A relative path in a tool call resolves against it. */
  readonly root: string;
  /**
   * The policy the sandbox was provisioned with. `read`, `grep` and `glob` check every path against its read and write
   * roots, and `write` and `edit` against its write roots, before they call the sandbox.
   */
  readonly policy: SandboxPolicy;
  /**
   * The whole environment of each command `bash`, `grep` and `glob` run. Defaults to a `PATH` of the usual system
   * folders and a UTF-8 `LANG`, and nothing else. On Node, pass the result of `spawnEnv()`.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Returns the full text the write cap saved at `path` for this session, or `undefined` when `path` names no spill
   * file. `read` asks it before the sandbox, so the model can read a cut result's full text. Give it a reader bound to
   * one session, such as `(path) => spill.read(key, path)` for `fileSpillStore()`, so one session can't read another's.
   */
  readonly spills?: (path: string) => string | undefined | Promise<string | undefined>;
}

const DEFAULT_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: "/usr/local/bin:/usr/bin:/bin",
  LANG: "C.UTF-8",
});

function builtin(
  definition: RegisteredTool["definition"],
  outputTrust: RegisteredTool["outputTrust"] = "trusted",
): RegisteredTool {
  return {
    canonicalName: definition.name,
    name: definition.name,
    source: "builtin",
    pattern: "in_process",
    exposure: "direct",
    outputTrust,
    approvalReuse: "both",
    remoteAgent: false,
    definition,
  };
}

/**
 * The built-in tools for one sandbox: `read`, `write`, `edit`, `bash`, `grep`, `glob` and, when `proxy` is given,
 * `fetch`. Register each with `registry.register(tool)`. `read`, `grep`, `glob` and `fetch` are first-party and
 * read-only, so their calls in one step run together; `write` and `edit` wait for the calls before them, and `bash`
 * makes its whole step run one call at a time. `fetch`'s output is `untrusted`, because a web page may carry
 * instructions, and the rest is `trusted`. Throws a `HarnessError`, code `invalid_tool_options`, when `root` or a
 * policy root is not an absolute path.
 */
export function builtinTools(
  sandbox: Sandbox,
  proxy: FetchProxy | undefined,
  options: BuiltinToolsOptions,
): RegisteredTool[] {
  const bounds = boundsOf(options.root, options.policy);
  const env = options.env ?? DEFAULT_ENV;
  const files = { sandbox, bounds, ...(options.spills === undefined ? {} : { spills: options.spills }) };
  const search = { ...files, env };
  const tools = [
    builtin(readTool(files)),
    builtin(writeTool(files)),
    builtin(editTool(files)),
    builtin(bashTool(sandbox, env)),
    builtin(grepTool(search)),
    builtin(globTool(search)),
  ];
  if (proxy !== undefined) tools.push(builtin(fetchTool(proxy), "untrusted"));
  return tools;
}
