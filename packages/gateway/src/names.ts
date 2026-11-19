/**
 * Tool names: the canonical rule every tool name meets, each wire protocol's own rule, and a reversible map from
 * canonical names to wire names. `names.md` beside this file holds the per-provider table and its sources.
 */
import { GatewayError } from "./errors.ts";

/**
 * The canonical tool-name rule: 1 to 64 ASCII letters, digits, underscores or hyphens. It is the strictest
 * intersection of the first providers' rules, so a canonical name reaches either of them unchanged.
 */
export const CANONICAL_TOOL_NAME: RegExp = /^[A-Za-z0-9_-]{1,64}$/;

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
/** The tool-name rules of the two first wire protocols, Anthropic Messages and OpenAI Chat Completions. */
export const TOOL_NAME_RULES: {
  readonly anthropicMessages: ToolNameRule;
  readonly openaiChat: ToolNameRule;
} = {
  // Messages API reference, Tool object: `pattern: ^[a-zA-Z0-9_-]{1,128}$`.
  anthropicMessages: {
    api: "anthropic-messages",
    characters: "A-Za-z0-9_-",
    maxLength: 128,
    source: "https://platform.claude.com/docs/en/api/messages/create",
    checkedOn: "2026-11-19",
  },
  // FunctionDefinition.name: "Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64".
  // The API reference host was unreachable from the build environment, so the rule comes from the doc comment in
  // OpenAI's official TypeScript SDK, which is generated from the same API specification.
  openaiChat: {
    api: "openai-chat",
    characters: "A-Za-z0-9_-",
    maxLength: 64,
    source: "https://github.com/openai/openai-node/blob/v7.49.0/src/resources/shared.ts",
    checkedOn: "2026-11-19",
  },
};

/**
 * A run's map between canonical tool names and one protocol's wire names. `sanitize()` gives the wire name for a
 * tool, and `restore()` turns a wire name the model sent back into the tool's name.
 *
 * A name that already meets the rule always keeps itself as its wire name. The wire names of the names passed to
 * `createToolNameMap()` depend only on that set of names, not on their order or on the order of `sanitize()` calls.
 * A name first seen by `sanitize()` gets its wire name when it is first seen, and keeps it for the life of the map.
 */
export interface ToolNameMap {
  /**
   * The wire name for `name`. A name that already meets the rule comes back unchanged. Any other name has its
   * disallowed characters replaced by `_`, is cut to fit, and ends in `_` and an 8-digit hex hash of the name, so
   * two names never share a wire name. One map always gives one name the same wire name.
   *
   * Throws a `GatewayError` with code `invalid_tool_name` when `name` meets the rule but an earlier `sanitize()` call
   * already gave its wire name to another tool. Passing every tool name to `createToolNameMap()` avoids this.
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

// FNV-1a over UTF-16 code units: synchronous and portable, so sanitising needs neither Web Crypto nor a Promise.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
 * characters are not a plain character-class body, or they exclude `_` or a hex digit.
 */
export function createToolNameMap(rule: ToolNameRule, names: Iterable<string> = []): ToolNameMap {
  const { valid, invalid } = checkRule(rule);
  const toWire = new Map<string, string>();
  const fromWire = new Map<string, string>();

  function hashed(name: string, attempt: number): string {
    const hash = fnv1a(attempt === 0 ? name : `${name}\u0000${attempt}`);
    return `${name.replace(invalid, "_").slice(0, rule.maxLength - HASH_SUFFIX_LENGTH)}_${hash}`;
  }

  function assign(name: string, wire: string): string {
    toWire.set(name, wire);
    fromWire.set(wire, name);
    return wire;
  }

  function sanitize(name: string): string {
    const known = toWire.get(name);
    if (known !== undefined) return known;
    if (valid.test(name)) {
      const holder = fromWire.get(name);
      if (holder !== undefined) {
        throw new GatewayError(
          "invalid_tool_name",
          `tool name ${JSON.stringify(name)} is already the wire name of ${JSON.stringify(holder)}; ` +
            "pass every tool name to createToolNameMap() so names that meet the rule keep themselves",
        );
      }
      return assign(name, name);
    }
    let attempt = 0;
    let wire = hashed(name, attempt);
    // A taken wire name belongs to another tool, so salt the hash until it is free.
    while (fromWire.has(wire)) wire = hashed(name, ++attempt);
    return assign(name, wire);
  }

  // Names that meet the rule claim themselves first, so a hashed name that collides with one is the one salted.
  const unique = [...new Set(names)].sort(byCodeUnits);
  for (const name of unique) if (valid.test(name)) assign(name, name);
  for (const name of unique) sanitize(name);

  return {
    sanitize,
    restore(wireName) {
      return fromWire.get(wireName);
    },
  };
}
