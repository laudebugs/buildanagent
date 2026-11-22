/**
 * `@buildanagent/cli`, the buildanagent command line, which runs the harness in a terminal. `runCli()` runs one
 * command line against the terminal a `CliIo` describes, which is what the `buildanagent` binary does with the
 * process's own streams.
 */
export { HELP, runCli } from "./cli.js";
export { CliError, type CliErrorCode, isCliError } from "./errors.js";
export type { HostRules } from "./host.js";
export { type CliIo, type CliStreams, linesOf } from "./io.js";
export type { CliOptions } from "./options.js";

/** The package name, `@buildanagent/cli`. */
export const PACKAGE_NAME = "@buildanagent/cli";
