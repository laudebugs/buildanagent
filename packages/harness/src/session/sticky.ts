/**
 * Sticky allowances and grouped approvals: what a person's `allow` may cover beyond the one call. A sticky allowance
 * covers the same call again for a run or a session, matched by the tool and the call's input hash or, for a shell tool,
 * by a command prefix. It never covers a command run through a shell, an interpreter or a wrapper, which would let any
 * script through. It never covers anything that holds a secret, or a tool whose `approvalReuse` says each call needs a
 * person. A prefix covers only a simple command, with no operator that starts a second one. A group is the requests of
 * one step that share a tool and an input, answered once.
 */

import type { SessionEntry } from "@buildanagent/protocol";
import { canonicalInputHash } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import type { ApprovalReuse, ToolRegistry } from "../tools/types.js";

/** The command prefixes no sticky allowance may cover: each runs whatever text follows it. */
export const INTERPRETER_PREFIXES: readonly (readonly string[])[] = [
  ["bash", "-c"],
  ["sh", "-c"],
  ["sh", "-lc"],
  ["zsh", "-c"],
  ["node", "-e"],
  ["python", "-c"],
  ["bun", "run"],
  ["npx"],
  ["uvx"],
];

// Programs that run other code, whatever their flags: shells, interpreters, package runners, and wrappers that start a
// program named in their arguments. A sticky allowance never covers a command whose first word is one of them, by any
// path, so `/bin/sh -c`, `env bash -c` and `python3 -c` are refused with the listed prefixes.
const RUNS_OTHER_CODE = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
  "node",
  "deno",
  "bun",
  "python",
  "python2",
  "python3",
  "perl",
  "ruby",
  "php",
  "lua",
  "osascript",
  "npx",
  "pnpx",
  "bunx",
  "uvx",
  "pipx",
  "npm",
  "pnpm",
  "yarn",
  "env",
  "sudo",
  "doas",
  "xargs",
  "nice",
  "nohup",
  "timeout",
  "command",
  "exec",
  "time",
  "stdbuf",
  "ionice",
  "watch",
  "eval",
  "source",
  ".",
  "find",
  "awk",
  "gawk",
  "make",
  "busybox",
  "setsid",
  "su",
  "ssh",
  "script",
  "unshare",
  "chroot",
]);

const wordsOf = (command: string): string[] =>
  command
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");

/** The program a command starts with, without its folder: `/bin/sh` is `sh`. */
const programOf = (word: string | undefined): string => (word ?? "").split("/").at(-1) ?? "";

// The text that starts a second command or hides one: a list or pipe operator, a redirection, a substitution, a
// subshell, an expansion or a line break. A prefix allowance covers a command with none of them.
const SHELL_SYNTAX = /[;&|<>`$()\n\r"'\\*?[\]{}!#]/;

/** Whether the command is a single simple command, so a prefix says what it runs. */
export const isSimpleCommand = (command: string): boolean => !SHELL_SYNTAX.test(command);

/** A shell command with its spaces normalised outside quotes, so two spellings of one command hash alike. */
export const normalisedCommand = (command: string): string =>
  /["']/.test(command) ? command.trim() : wordsOf(command).join(" ");

const commandOf = (input: unknown): string | undefined =>
  typeof input === "object" && input !== null && typeof (input as { command?: unknown }).command === "string"
    ? (input as { command: string }).command
    : undefined;

const startsWith = (words: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length <= words.length && prefix.every((word, index) => words[index] === word);

/**
 * Returns the listed interpreter prefix that `words` begin with or are the start of, or the first word's program when it
 * runs other code. Returns `undefined` otherwise.
 */
function runsOtherCode(words: readonly string[]): string | undefined {
  if (words.length === 0) return undefined;
  const first = words[0] as string;
  // A leading assignment, quote, escape or glob can hide the program, so it is refused instead of read.
  if (/[="'\\*?[\]{}$`!~]/.test(first)) return first;
  if (programOf(first) === "git" && words.some((word) => word === "-c" || word.startsWith("--config-env")))
    return "git -c";
  const listed = INTERPRETER_PREFIXES.find((prefix) => startsWith(words, prefix) || startsWith(prefix, words));
  if (listed !== undefined) return listed.join(" ");
  const program = programOf(words[0]);
  return RUNS_OTHER_CODE.has(program) ? program : undefined;
}

/** What a sticky or grouped answer on a tool needs the tool to allow. */
const allows = (reuse: ApprovalReuse, kind: "sticky" | "group"): boolean => reuse === "both" || reuse === kind;

/** Throws `approval_reuse_refused` unless the tool's `approvalReuse` lets one answer cover more than one call. */
export function checkReuse(tool: string, reuse: ApprovalReuse, kind: "sticky" | "group"): void {
  if (!allows(reuse, kind)) {
    throw new HarnessError(
      "approval_reuse_refused",
      `the tool "${tool}" sets approvalReuse "${reuse}", which forbids a ${kind} answer: each call needs a person`,
    );
  }
}

const refused = (why: string) => new HarnessError("sticky_refused", why);

/** Every string inside a value, so a secret is found as it is and not as JSON escapes it. */
function stringsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, found);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) stringsIn(item, found);
  return found;
}

/** Throws `sticky_refused` unless the command prefix is a non-empty start of a simple command a person approved. */
function checkPrefix(command: string | undefined, commandPrefix: readonly string[]): void {
  if (commandPrefix.length === 0 || commandPrefix.some((word) => word === "")) {
    throw refused("a command prefix needs at least one word");
  }
  if (command === undefined || !isSimpleCommand(command)) {
    throw refused("a command prefix covers only a simple command: no operator, redirection or substitution");
  }
  if (!startsWith(wordsOf(command), commandPrefix)) {
    throw refused("the command prefix is not the start of the command a person approved");
  }
}

/**
 * Throws `sticky_refused` when an allowance on this call would cover code run through a shell, an interpreter or a
 * wrapper, a prefix that is empty or that doesn't start the approved command, a command prefix on a call with no
 * simple command, or a secret. `secrets` are the values the host's credential store knows.
 */
export function checkSticky(
  input: unknown,
  commandPrefix: readonly string[] | undefined,
  secrets: readonly string[],
): void {
  const command = commandOf(input);
  for (const words of [command === undefined ? [] : wordsOf(command), commandPrefix ?? []]) {
    const found = runsOtherCode(words);
    if (found !== undefined) throw refused(`a sticky allowance may not cover "${found}", which runs other code`);
  }
  if (commandPrefix !== undefined) checkPrefix(command, commandPrefix);
  const texts = [...stringsIn(input), ...(commandPrefix ?? []), JSON.stringify(input) ?? ""];
  if (secrets.some((secret) => secret !== "" && texts.some((text) => text.includes(secret)))) {
    throw refused("a sticky allowance may not cover a call that holds a secret the credential store knows");
  }
}

/** The id a request's group shares: the tool and the whole input, with a shell command's spaces normalised. */
export async function groupIdOf(tool: string, input: unknown, inputHash: string): Promise<string> {
  const command = commandOf(input);
  const key =
    command === undefined
      ? inputHash
      : await canonicalInputHash({ ...(input as object), command: normalisedCommand(command) });
  return `grp-${(await canonicalInputHash({ tool, key })).slice(0, 16)}`;
}

/** What `findSticky()` needs to know about the call: its tool, input and the policy version that asks about it. */
export interface StickyCall {
  readonly tool: string;
  readonly input: unknown;
  readonly policyVersion?: string | undefined;
}

/** Whether an allowance matches the call's input: the same hash, or a prefix of a simple command. */
function matchesInput(
  allowance: { inputHash?: string; commandPrefix?: string[] },
  hash: string,
  command: string | undefined,
): boolean {
  if (allowance.inputHash === hash) return true;
  if (allowance.commandPrefix === undefined || command === undefined) return false;
  return isSimpleCommand(command) && startsWith(wordsOf(command), allowance.commandPrefix);
}

/** Whether a sticky entry's allowance covers a call under the policy version that asks about it now. */
function covers(
  entry: SessionEntry,
  name: string,
  hash: string,
  command: string | undefined,
  version?: string,
): boolean {
  if (entry.type !== "approval_resolved" || entry.quorum !== undefined) return false;
  if (entry.allowance === undefined || entry.allowance.tool !== name) return false;
  if (entry.allowance.policyVersion !== undefined && entry.allowance.policyVersion !== version) return false;
  return matchesInput(entry.allowance, hash, command);
}

/**
 * The id of the sticky `approval_resolved` entry that covers this call, if one does. A `run` allowance counts from the
 * latest turn that started a run, so its resumes share it; a `session` allowance counts from the start of this
 * session's own file, so a fork never inherits its parent's. An allowance given under another policy version is
 * ignored, because the policy that asked is no longer the one a person approved under.
 */
export async function findSticky(
  path: readonly SessionEntry[],
  call: StickyCall,
  registry: ToolRegistry,
): Promise<string | undefined> {
  const tool = registry.get(call.tool);
  if (tool !== undefined && !allows(tool.approvalReuse, "sticky")) return undefined;
  const fileStart = path.findLastIndex((entry) => entry.type === "session_header");
  const runStart = Math.max(
    fileStart,
    path.findLastIndex((entry) => entry.type === "turn_start" && entry.mode === "run"),
  );
  const hash = await canonicalInputHash(call.input);
  const command = typeof call.input === "object" && call.input !== null ? commandOf(call.input) : undefined;
  const name = tool?.canonicalName ?? call.tool;
  const live = path.filter(
    (entry, index) => entry.type === "approval_resolved" && index >= (entry.sticky === "run" ? runStart : fileStart),
  );
  return live.findLast(
    (entry) =>
      entry.type === "approval_resolved" &&
      entry.sticky !== undefined &&
      covers(entry, name, hash, command, call.policyVersion),
  )?.id;
}
