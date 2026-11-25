/**
 * The checks every backend runs on a command and its options before it starts anything. It is portable, so a hosted
 * backend that imports no Node module can share it with the local ones.
 */
import { HarnessError } from "../errors.js";
import type { ExecOptions } from "./types.js";

// The longest delay a timer takes: a larger one fires at once.
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Throws unless the options are usable. */
export function checkOptions(options: ExecOptions): void {
  const { maxOutputBytes, timeoutMs } = options;
  if (maxOutputBytes !== undefined && !(Number.isInteger(maxOutputBytes) && maxOutputBytes >= 0)) {
    throw new HarnessError("invalid_sandbox_options", "maxOutputBytes must be a non-negative whole number");
  }
  if (timeoutMs !== undefined && !(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMER_MS)) {
    throw new HarnessError("invalid_sandbox_options", `timeoutMs must be a number from 1 to ${MAX_TIMER_MS}`);
  }
}

/** Throws unless the command is a non-empty list of strings. */
export function checkCommand(command: readonly string[]): void {
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string")) {
    throw new HarnessError("invalid_sandbox_options", "a sandbox command is a non-empty list of strings");
  }
}
