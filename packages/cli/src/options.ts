/**
 * What `runCli()` takes, and what each command gets from it: the terminal, the flags, and the settings of the host
 * it builds.
 */
import type { Model } from "@buildanagent/gateway";
import type { ToolRegistration } from "@buildanagent/harness/tools";
import type { Flags } from "./args.js";
import type { HostOptions, HostRules } from "./host.js";
import type { CliIo } from "./io.js";

/** The options of `runCli()`. */
export interface CliOptions {
  /** The terminal: standard streams, environment and working folder. */
  readonly io: CliIo;
  /** The model turns use. It replaces `--model`, so a program can pass a model it built itself. */
  readonly model?: Model;
  /** Tools to register besides the harness's own. */
  readonly tools?: readonly ToolRegistration[];
  /** Permission rules added to the harness's default ask rules. */
  readonly rules?: HostRules;
  /** The `fetch` that `--otlp-endpoint` sends spans with. Default the global one. */
  readonly fetch?: typeof globalThis.fetch;
}

/** What a command runs with. */
export interface CommandContext {
  readonly io: CliIo;
  readonly flags: Flags;
  readonly options: CliOptions;
  /** The host settings every command shares; a command adds the model, `interactive` and `signing`. */
  readonly hostOptions: Omit<HostOptions, "model" | "interactive" | "signing">;
}
