/**
 * Sticky allowances and grouped approvals: what a person's `allow` may cover beyond the one call. A sticky allowance
 * covers the same call again for a run or a session, matched by the tool and the call's input hash or, for a shell tool,
 * by a command prefix. It is refused for an interpreter prefix, which would let any script through, for anything that
 * holds a secret, and for a tool whose `approvalReuse` says each call needs a person. A group is the requests of one
 * step that share a tool and an input, answered once.
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

const wordsOf = (command: string): string[] =>
  command
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");

/** A shell command with its whitespace normalised, so two spellings of one command hash alike. */
export const normalisedCommand = (command: string): string => wordsOf(command).join(" ");

const commandOf = (input: unknown): string | undefined =>
  typeof input === "object" && input !== null && typeof (input as { command?: unknown }).command === "string"
    ? (input as { command: string }).command
    : undefined;

const startsWith = (words: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length <= words.length && prefix.every((word, index) => words[index] === word);

/** The interpreter prefix `words` begin with, or that `words` is the start of, since `bash` alone covers `bash -c`. */
function interpreterOf(words: readonly string[]): readonly string[] | undefined {
  if (words.length === 0) return undefined;
  return INTERPRETER_PREFIXES.find((prefix) => startsWith(words, prefix) || startsWith(prefix, words));
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

/**
 * Throws `sticky_refused` when an allowance on this call would cover an interpreter prefix or hold a secret. `secrets`
 * are the values the host's credential store knows; any of them inside the call's input or the prefix refuses it.
 */
export function checkSticky(
  input: unknown,
  commandPrefix: readonly string[] | undefined,
  secrets: readonly string[],
): void {
  const command = commandOf(input);
  for (const words of [command === undefined ? [] : wordsOf(command), commandPrefix ?? []]) {
    const found = interpreterOf(words);
    if (found !== undefined) {
      throw new HarnessError(
        "sticky_refused",
        `a sticky allowance may not cover the interpreter prefix "${found.join(" ")}"`,
      );
    }
  }
  if (commandPrefix !== undefined && command !== undefined && !startsWith(wordsOf(command), commandPrefix)) {
    throw new HarnessError("sticky_refused", "the command prefix is not the start of the command a person approved");
  }
  const text = `${JSON.stringify(input) ?? ""}\n${(commandPrefix ?? []).join(" ")}`;
  if (secrets.some((secret) => secret !== "" && text.includes(secret))) {
    throw new HarnessError(
      "sticky_refused",
      "a sticky allowance may not cover a call that holds a secret the credential store knows",
    );
  }
}

/** The id a request's group shares: the tool and the input hash, or for a shell command the normalised command. */
export async function groupIdOf(tool: string, input: unknown, inputHash: string): Promise<string> {
  const command = commandOf(input);
  const key = command === undefined ? inputHash : await canonicalInputHash({ command: normalisedCommand(command) });
  return `grp-${(await canonicalInputHash({ tool, key })).slice(0, 16)}`;
}

/** Whether a sticky entry's allowance covers a call, by the input hash or by a command prefix. */
function covers(entry: SessionEntry, name: string, hash: string, words: readonly string[]): boolean {
  if (entry.type !== "approval_resolved" || entry.allowance === undefined || entry.allowance.tool !== name)
    return false;
  const { inputHash, commandPrefix } = entry.allowance;
  return inputHash === hash || (commandPrefix !== undefined && startsWith(words, commandPrefix));
}

/**
 * The id of the sticky `approval_resolved` entry that covers this call, if one does. A `run` allowance counts from the
 * latest turn that started a run, so its resumes share it; a `session` allowance counts from the start of this
 * session's own file, so a fork never inherits its parent's.
 */
export async function findSticky(
  path: readonly SessionEntry[],
  call: { tool: string; input: unknown },
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
  const command = commandOf(call.input);
  const words = command === undefined ? [] : wordsOf(command);
  const name = tool?.canonicalName ?? call.tool;
  const live = path.filter(
    (entry, index) => entry.type === "approval_resolved" && index >= (entry.sticky === "run" ? runStart : fileStart),
  );
  return live.findLast(
    (entry) => entry.type === "approval_resolved" && entry.sticky !== undefined && covers(entry, name, hash, words),
  )?.id;
}
