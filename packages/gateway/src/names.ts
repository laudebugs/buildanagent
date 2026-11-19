/**
 * Tool names: the canonical rule every tool name meets, each wire protocol's own rule, and a reversible map from
 * canonical names to wire names. `names.md` beside this file holds the per-provider table and its sources.
 */
import { GatewayError } from "./errors.js";

/**
 * The canonical tool-name rule: 1 to 64 ASCII letters, digits, underscores or hyphens. It is the strictest
 * intersection of the first providers' rules, so a canonical name reaches either of them unchanged.
 */
export const CANONICAL_TOOL_NAME: RegExp = Object.freeze(/^[A-Za-z0-9_-]{1,64}$/);

/** True when `name` meets the canonical tool-name rule. */
export function isCanonicalName(name: string): boolean {
  return CANONICAL_TOOL_NAME.test(name);
}

/**
 * Throws a `GatewayError` with code `invalid_tool_name` unless `name` meets the canonical rule, 1 to 64 characters
 * from `A-Z`, `a-z`, `0-9`, `_` and `-`. Namespaced names such as `mcp__<server>__<tool>` follow the same rule.
 */
export function assertCanonicalName(name: string): void {
  if (isCanonicalName(name)) return;
  const shown = name.length > 80 ? `${JSON.stringify(name.slice(0, 80))}…` : JSON.stringify(name);
  throw new GatewayError(
    "invalid_tool_name",
    `tool name ${shown} (${name.length} characters) must be 1 to 64 characters from A-Z, a-z, 0-9, _ and -`,
  );
}

/** One wire protocol's rule for tool names, copied from the provider's API reference. */
export interface ToolNameRule {
  /** The wire protocol the rule belongs to, such as `"anthropic-messages"`. */
  readonly api: string;
  /** The allowed characters, as the body of a regular-expression character class, such as `"A-Za-z0-9_-"`. */
  readonly characters: string;
  /** The longest name the protocol accepts, in characters. */
  readonly maxLength: number;
  /** The API reference page the rule was copied from. */
  readonly source: string;
  /** The date the rule was checked against `source`, as `YYYY-MM-DD`. */
  readonly checkedOn: string;
}

// Each rule is copied from the provider's own reference, as of November 2026; names.md records the exact wording.
/** The tool-name rules of the two first wire protocols, Anthropic Messages and OpenAI Chat Completions. Frozen. */
export const TOOL_NAME_RULES: {
  readonly anthropicMessages: ToolNameRule;
  readonly openaiChat: ToolNameRule;
} = Object.freeze({
  // Messages API reference, Tool object: `pattern: ^[a-zA-Z0-9_-]{1,128}$`.
  anthropicMessages: Object.freeze({
    api: "anthropic-messages",
    characters: "A-Za-z0-9_-",
    maxLength: 128,
    source: "https://platform.claude.com/docs/en/api/messages/create",
    checkedOn: "2026-11-19",
  }),
  // FunctionDefinition.name: "Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64".
  // OpenAI's TypeScript SDK at v7.49.0 carries the same words in src/resources/shared.ts.
  openaiChat: Object.freeze({
    api: "openai-chat",
    characters: "A-Za-z0-9_-",
    maxLength: 64,
    source: "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create",
    checkedOn: "2026-11-19",
  }),
});

/**
 * A run's map between canonical tool names and one protocol's wire names. `sanitize()` gives the wire name for a
 * tool, and `restore()` turns a wire name the model sent back into the tool's name.
 *
 * No two wire names are equal or differ only in case, because neither first provider says whether tool names are
 * case-sensitive. Of the names passed to `createToolNameMap()` up front, one that meets the rule keeps itself
 * unless it differs only in case from a name that sorts before it. Their wire names depend only on the set of
 * names, not on its order or on the order of `sanitize()` calls. A name that `sanitize()` first sees later keeps
 * itself if it meets the rule and no issued wire name matches it, ignoring case. Otherwise it gets a salted hash
 * suffix: a hash of the name and an attempt counter. Every name keeps its first wire name for the life of the map,
 * because that wire name may already have been sent.
 */
export interface ToolNameMap {
  /**
   * The wire name for `name`. A name that meets the rule comes back unchanged unless an issued wire name matches it,
   * ignoring case. Any other name has its disallowed characters replaced by `_`, is cut to fit, and ends in `_` and
   * an 8-digit hex hash. The map first hashes the name alone. If that wire name is taken, it salts the hash with an
   * attempt counter, counting up until the wire name is free, so two names never share a wire name. One map always
   * gives one name the same wire name.
   */
  sanitize(name: string): string;
  /**
   * The name that the map turned into `wireName`, or `undefined` when the map never issued `wireName`. A tool name
   * the model invented therefore never resolves to a tool, even when it equals a tool's name before sanitising.
   */
  restore(wireName: string): string | undefined;
}

const HASH_SUFFIX_LENGTH = 9; // "_" and 8 hex digits
const HASH_ALPHABET = "_0123456789abcdef";

/**
 * FNV-1a over UTF-16 code units, as 8 hex digits: synchronous and portable, so sanitising needs neither Web Crypto
 * nor a Promise. Internal to the gateway; adapters also use it to fingerprint a conversation.
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isLower = (c: string): boolean => c >= "a" && c <= "z";
const isUpper = (c: string): boolean => c >= "A" && c <= "Z";

// A stray "-" silently makes a range, as "9-_" would in "a-z0-9-_", so "-" may only start or end the characters
// or join two digits, two lowercase letters or two uppercase letters.
function checkDashes(rule: ToolNameRule): void {
  const chars = rule.characters;
  for (let i = 0; i < chars.length; ) {
    const from = chars.charAt(i);
    if (chars.charAt(i + 1) === "-" && i + 2 < chars.length && from !== "-") {
      const to = chars.charAt(i + 2);
      const sameKind =
        (isDigit(from) && isDigit(to)) || (isLower(from) && isLower(to)) || (isUpper(from) && isUpper(to));
      if (!sameKind) {
        throw new GatewayError(
          "invalid_options",
          `tool-name rule ${rule.api}: range ${from}-${to} must join two digits or two letters of the same case`,
        );
      }
      i += 3;
    } else if (from === "-" && i !== 0 && i !== chars.length - 1) {
      throw new GatewayError(
        "invalid_options",
        `tool-name rule ${rule.api}: a - outside a range must be the first or last character`,
      );
    } else {
      i += 1;
    }
  }
}

function checkRule(rule: ToolNameRule): { valid: RegExp; invalid: RegExp } {
  if (!Number.isInteger(rule.maxLength) || rule.maxLength <= HASH_SUFFIX_LENGTH) {
    throw new GatewayError("invalid_options", `tool-name rule ${rule.api}: maxLength must be an integer above 9`);
  }
  // The characters are pasted into a character class, where a leading ^ negates it and a bracket or backslash
  // changes where it ends or what it means, so only plain characters and ranges are accepted.
  if (rule.characters.startsWith("^") || /[[\\\]]/.test(rule.characters)) {
    throw new GatewayError(
      "invalid_options",
      `tool-name rule ${rule.api}: characters must not start with ^ or contain [, ] or a backslash`,
    );
  }
  checkDashes(rule);
  let valid: RegExp;
  let invalid: RegExp;
  let allowed: RegExp;
  try {
    valid = new RegExp(`^[${rule.characters}]{1,${rule.maxLength}}$`);
    invalid = new RegExp(`[^${rule.characters}]`, "g");
    allowed = new RegExp(`^[${rule.characters}]+$`);
  } catch (cause) {
    throw new GatewayError("invalid_options", `tool-name rule ${rule.api}: characters is not a character class`, {
      cause,
    });
  }
  // Every character of a hash suffix must be allowed, whatever the length limit.
  if (!allowed.test(HASH_ALPHABET)) {
    throw new GatewayError("invalid_options", `tool-name rule ${rule.api}: characters must allow _, 0-9 and a-f`);
  }
  return { valid, invalid };
}

// Sorting by UTF-16 code units gives one order for a set of names on every runtime.
function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Creates the map between canonical names and the wire names of the protocol that `rule` describes. Pass the run's
 * tool names as `names`, so their wire names do not depend on the order the tools are registered or sanitised in.
 * Keep one map for a whole run, so every request sends the same wire names and the prompt cache stays valid.
 *
 * Throws a `GatewayError` with code `invalid_options` when the rule is too short to hold a hash suffix, its
 * characters are not a plain character-class body, or they exclude `_` or a hex digit. In `characters`, a `-` must
 * be the first or last character or join two digits, two lowercase letters or two uppercase letters.
 */
export function createToolNameMap(rule: ToolNameRule, names: Iterable<string> = []): ToolNameMap {
  const { valid, invalid } = checkRule(rule);
  const toWire = new Map<string, string>();
  const fromWire = new Map<string, string>();
  // Issued wire names, lowercased, so no two wire names differ only in case.
  const issuedFolded = new Set<string>();
  const isTaken = (wire: string): boolean => issuedFolded.has(wire.toLowerCase());

  function hashed(name: string, attempt: number): string {
    const hash = fnv1a(attempt === 0 ? name : `${name}\u0000${attempt}`);
    return `${name.replace(invalid, "_").slice(0, rule.maxLength - HASH_SUFFIX_LENGTH)}_${hash}`;
  }

  function assign(name: string, wire: string): string {
    toWire.set(name, wire);
    fromWire.set(wire, name);
    issuedFolded.add(wire.toLowerCase());
    return wire;
  }

  function sanitize(name: string): string {
    const known = toWire.get(name);
    if (known !== undefined) return known;
    const meetsRule = valid.test(name);
    if (meetsRule && !isTaken(name)) return assign(name, name);
    // A name that meets the rule but whose string, ignoring case, was already issued starts salted: the earlier
    // wire name may already have been sent, so it must not move.
    let attempt = meetsRule ? 1 : 0;
    let wire = hashed(name, attempt);
    // A taken wire name belongs to another tool, so salt the hash until it is free.
    while (isTaken(wire)) wire = hashed(name, ++attempt);
    return assign(name, wire);
  }

  // Names that meet the rule claim themselves first, so a hashed name that collides with one is the one salted. Of
  // names that differ only in case, the first in sorted order claims itself and the others are salted.
  const unique = [...new Set(names)].sort(byCodeUnits);
  for (const name of unique) if (valid.test(name) && !isTaken(name)) assign(name, name);
  for (const name of unique) sanitize(name);

  return {
    sanitize,
    restore(wireName) {
      return fromWire.get(wireName);
    },
  };
}
