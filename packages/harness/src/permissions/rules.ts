/** Rule matching: whether a rule covers a call, for a rule that restricts (deny, ask) and one that permits (allow). */
import {
  commandOf,
  globToRegExp,
  nameMatches,
  type ParsedCommand,
  pathsOf,
  startsWithWords,
  strippedWords,
} from "./match.js";
import type { Rule } from "./types.js";

/** What the rules read from one call. */
export interface Target {
  /** The tool's canonical name and its alias. */
  readonly names: readonly string[];
  readonly paths: readonly string[];
  readonly command: ParsedCommand | undefined;
}

export function targetOf(names: readonly string[], input: unknown): Target {
  return { names, paths: pathsOf(input), command: commandOf(input) };
}

export function toolMatches(tool: string | RegExp, names: readonly string[]): boolean {
  if (typeof tool === "string") return names.some((name) => nameMatches(tool, name));
  return names.some((name) => {
    tool.lastIndex = 0;
    return tool.test(name);
  });
}

/** True for a rule with no `paths` and no `commandPrefix`, which covers every call to its tool. */
export function isUnconditional(rule: Rule): boolean {
  return rule.paths === undefined && rule.commandPrefix === undefined;
}

// A deny or ask rule matches a relative glob below any directory, and an allow rule only from the workspace root.
const pathHits = (rule: Rule, path: string, anywhere: boolean): boolean =>
  (rule.paths ?? []).some((glob) => globToRegExp(glob, anywhere).test(path));

/** A deny or ask rule matches when the tool matches and any path and any command part it names is in the call. */
export function restricts(rule: Rule, target: Target): boolean {
  if (!toolMatches(rule.tool, target.names)) return false;
  if (rule.paths !== undefined && !target.paths.some((path) => pathHits(rule, path, true))) return false;
  const prefix = rule.commandPrefix;
  if (prefix === undefined) return true;
  return (target.command?.parts ?? []).some(
    (words) => startsWithWords(words, prefix) || startsWithWords(strippedWords(words), prefix),
  );
}

/** Whether `rule` could allow this part of a call: its tool, its paths (all of the call's) and its command prefix. */
function permitsPart(rule: Rule, target: Target, words: readonly string[] | undefined): boolean {
  if (!toolMatches(rule.tool, target.names)) return false;
  if (
    rule.paths !== undefined &&
    !(target.paths.length > 0 && target.paths.every((path) => pathHits(rule, path, false)))
  ) {
    return false;
  }
  if (rule.commandPrefix === undefined) return true;
  return words !== undefined && startsWithWords(words, rule.commandPrefix);
}

/**
 * The index of the allow rule that allows the whole call, or `undefined`. A rule with no command prefix allows the call
 * when its tool and paths match. Otherwise every command part must start with the prefix of some rule, and a command
 * that hides commands in a substitution is never allowed, because its parts can't all be read.
 */
export function permits(rules: readonly Rule[], target: Target): number | undefined {
  const whole = rules.findIndex((rule) => rule.commandPrefix === undefined && permitsPart(rule, target, undefined));
  if (whole >= 0) return whole;
  const command = target.command;
  if (command === undefined || command.opaque || command.parts.length === 0) return undefined;
  const used = command.parts.map((words) => rules.findIndex((rule) => permitsPart(rule, target, words)));
  return used.every((index) => index >= 0) ? used[0] : undefined;
}
