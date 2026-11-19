import assert from "node:assert/strict";
import {
  assertCanonicalName,
  CANONICAL_TOOL_NAME,
  createToolNameMap,
  isCanonicalName,
  isGatewayError,
  TOOL_NAME_RULES,
  type ToolNameRule,
} from "@buildanagent/gateway";
import { test } from "vitest";

// Tool names from the eight triage capstones in verify/*/examples, plus the Claude SDK's MCP-namespaced forms.
const CAPSTONE_NAMES = [
  "lookup_customer",
  "escalate",
  "escalate_to_human",
  "issueRefund",
  "lookupCustomer",
  "lookupOrder",
  "submit_triage",
  "triage",
  "mcp__support__lookup_customer",
  "mcp__support__escalate",
];

const CANONICAL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

// mulberry32: a seeded generator, so the generated names are the same on every run.
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateNames(count: number, alphabet: string, maxLength: number, seed: number): string[] {
  const random = seeded(seed);
  const names = new Set<string>();
  while (names.size < count) {
    const length = 1 + Math.floor(random() * maxLength);
    let name = "";
    for (let i = 0; i < length; i++) name += alphabet[Math.floor(random() * alphabet.length)] ?? "_";
    names.add(name);
  }
  return [...names];
}

function rejectsName(name: string): void {
  assert.throws(
    () => assertCanonicalName(name),
    (error) => isGatewayError(error) && error.code === "invalid_tool_name",
  );
}

const tightRule: ToolNameRule = {
  api: "test-tight",
  characters: "a-z0-9_",
  maxLength: 16,
  source: "https://example.test/tool-names",
  checkedOn: "2026-11-19",
};

test("assertCanonicalName accepts the capstone names and a 64-character name", () => {
  for (const name of [...CAPSTONE_NAMES, "a".repeat(64), "A-z_9"]) assertCanonicalName(name);
});

test("assertCanonicalName rejects a 65-character name and a name with a space", () => {
  rejectsName("a".repeat(65));
  rejectsName("lookup customer");
});

test("assertCanonicalName rejects an empty name, a dot, a slash and non-ASCII letters", () => {
  for (const name of ["", "mcp.server.tool", "github/list_prs", "café", "tool\n"]) rejectsName(name);
});

test("the canonical rule is the strictest intersection of the two first providers' rules", () => {
  const rules = Object.values(TOOL_NAME_RULES);
  assert.equal(rules.length, 2);
  for (const rule of rules) {
    assert.equal(rule.characters, "A-Za-z0-9_-");
    assert.match(rule.source, /^https:\/\//);
    assert.match(rule.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
  }
  const shortest = Math.min(...rules.map((rule) => rule.maxLength));
  assert.equal(shortest, 64);
  assert.equal(CANONICAL_TOOL_NAME.source, `^[A-Za-z0-9_-]{1,${shortest}}$`);
});

test("restore(sanitize(n)) === n holds for 1,000 generated canonical names on each first protocol", () => {
  const names = generateNames(1000, CANONICAL_CHARS, 64, 7);
  for (const rule of Object.values(TOOL_NAME_RULES)) {
    const map = createToolNameMap(rule);
    for (const name of names) {
      assert.ok(isCanonicalName(name));
      const wire = map.sanitize(name);
      assert.equal(wire, name, "a canonical name reaches a first provider unchanged");
      assert.equal(map.restore(wire), name);
    }
  }
});

test("restore(sanitize(n)) === n holds for 1,000 canonical names under a stricter rule that truncates", () => {
  const names = generateNames(1000, CANONICAL_CHARS, 64, 11);
  const map = createToolNameMap(tightRule);
  const wires = new Set<string>();
  for (const name of names) {
    const wire = map.sanitize(name);
    assert.match(wire, /^[a-z0-9_]{1,16}$/);
    assert.equal(map.restore(wire), name);
    wires.add(wire);
  }
  assert.equal(wires.size, names.length, "no two names share a wire name");
});

test("a name the rule rejects is cut to fit and ends in a hash of the whole name", () => {
  const map = createToolNameMap(TOOL_NAME_RULES.openaiChat);
  const long = `mcp__${"github".repeat(10)}__list_pull_requests`;
  const wire = map.sanitize(long);
  assert.equal(wire.length, 64);
  assert.match(wire, /^mcp__github[A-Za-z0-9_-]*_[0-9a-f]{8}$/);
  assert.equal(map.restore(wire), long);
  assert.equal(map.sanitize(long), wire, "the same name always gets the same wire name");

  const dotted = map.sanitize("mcp__my.server__tool");
  assert.match(dotted, /^mcp__my_server__tool_[0-9a-f]{8}$/);
  assert.equal(map.restore(dotted), "mcp__my.server__tool");
});

test("two names that sanitise alike keep distinct wire names", () => {
  const map = createToolNameMap(TOOL_NAME_RULES.anthropicMessages);
  const a = map.sanitize("search.web");
  const b = map.sanitize("search/web");
  assert.notEqual(a, b);
  assert.equal(map.restore(a), "search.web");
  assert.equal(map.restore(b), "search/web");
});

test("a name that equals another tool's wire name gets its own wire name", () => {
  const map = createToolNameMap(TOOL_NAME_RULES.anthropicMessages);
  const taken = map.sanitize("search.web");
  const clash = map.sanitize(taken);
  assert.notEqual(clash, taken);
  assert.equal(map.restore(taken), "search.web");
  assert.equal(map.restore(clash), taken);
});

test("restore returns a wire name the map never produced unchanged", () => {
  const map = createToolNameMap(TOOL_NAME_RULES.anthropicMessages);
  map.sanitize("lookup_customer");
  assert.equal(map.restore("invented_tool"), "invented_tool");
});

test("two maps built from one rule give the same wire names in the same order", () => {
  const names = ["a.b", "lookup_customer", `x${"y".repeat(80)}`];
  const first = createToolNameMap(tightRule);
  const second = createToolNameMap(tightRule);
  assert.deepEqual(names.map(first.sanitize), names.map(second.sanitize));
});

test("createToolNameMap rejects a rule that cannot hold the hash suffix", () => {
  const bad: ToolNameRule[] = [
    { ...tightRule, maxLength: 9 },
    { ...tightRule, maxLength: 12.5 },
    { ...tightRule, characters: "A-Z" },
    { ...tightRule, characters: "z-a" },
  ];
  for (const rule of bad) {
    assert.throws(
      () => createToolNameMap(rule),
      (error) => isGatewayError(error) && error.code === "invalid_options",
    );
  }
});
