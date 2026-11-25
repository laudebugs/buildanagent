/**
 * How the E2B backend turns a command into the string E2B runs. E2B starts every command as `/bin/bash -l -c <string>`
 * with the template's environment, so the string first unsets every exported variable it wasn't given, then `exec`s
 * the program with each argument in single quotes. The values of the given variables travel in the request's `envs`,
 * never in the string, so no value appears on a command line. It is portable.
 */
import { HarnessError } from "../../errors.js";

// The loop variable of the prelude, which the prelude unsets before the program starts.
const LOOP_VARIABLE = "__harness_name";
// A variable name `bash` can hold, which is also safe to put unquoted in a `case` pattern.
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Quotes one word for `bash`: the word in single quotes, with each `'` closed, escaped and reopened. */
export function quoteWord(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The string that runs `command` with only the variables named in `keep`. It throws `invalid_sandbox_options` for a
 * name that isn't a variable name and for a NUL in an argument, which no command line can carry.
 */
export function commandString(command: readonly string[], keep: readonly string[]): string {
  for (const name of keep) {
    if (!VARIABLE_NAME.test(name) || name === LOOP_VARIABLE) {
      throw new HarnessError("invalid_sandbox_options", `${JSON.stringify(name)} is not a variable name`);
    }
  }
  if (command.some((word) => word.includes("\0"))) {
    throw new HarnessError("invalid_sandbox_options", "a sandbox command can't hold a NUL character");
  }
  // An empty `case` pattern would match nothing, so a name no variable can have stands in for an empty list.
  const pattern = keep.length > 0 ? keep.join("|") : "_";
  const prelude =
    `for ${LOOP_VARIABLE} in $(compgen -e); do case "$${LOOP_VARIABLE}" in ${pattern}) ;; ` +
    `*) unset "$${LOOP_VARIABLE}" 2>/dev/null ;; esac; done; unset ${LOOP_VARIABLE}`;
  return `${prelude}; exec ${command.map(quoteWord).join(" ")}`;
}

/** The string that kills the process group a command leads, which ends what it started when E2B made it a leader. */
export function killGroupString(pid: number): string {
  return `kill -KILL -- -${Math.trunc(pid)} 2>/dev/null; true`;
}
