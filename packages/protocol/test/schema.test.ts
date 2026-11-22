// The JSON Schema of the entry union: the committed file is what the generator writes now, every fixture validates
// against it, the changes a reader must reject do not, and each entry's schema lists its fixtures' fields. `pnpm typecheck` also
// compares the types (schema-check/types.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SESSION_ENTRY_TYPES } from "@buildanagent/protocol";
import { Validator } from "@cfworker/json-schema";
import { test } from "vitest";
import { buildSessionEntrySchema } from "../scripts/session-entry-schema.js";
import { FIXTURES } from "./fixtures.js";

const committed = readFileSync(new URL("../schema/session-entry.schema.json", import.meta.url), "utf8");
const validator = new Validator(JSON.parse(committed), "2020-12");

/** The keys a schema branch lists for one entry type. */
function schemaKeys(type: string): string[] {
  const branches = (JSON.parse(committed) as { oneOf: { properties: Record<string, { const?: string }> }[] }).oneOf;
  const branch = branches.find((candidate) => candidate.properties.type?.const === type);
  assert.ok(branch, `the schema has a branch for ${type}`);
  return Object.keys(branch.properties).sort();
}

test("the committed schema is what the generator writes now", () => {
  assert.equal(
    committed,
    `${JSON.stringify(buildSessionEntrySchema(), null, 2)}\n`,
    "run `pnpm --filter @buildanagent/protocol schema`",
  );
});

test("each entry type's schema lists the fields its fixtures use, optional ones included", () => {
  for (const type of SESSION_ENTRY_TYPES) {
    const used = new Set(FIXTURES.filter((entry) => entry.type === type).flatMap((entry) => Object.keys(entry)));
    assert.deepEqual(schemaKeys(type), [...used].sort(), type);
  }
});

test("every fixture validates against the committed schema", () => {
  for (const entry of FIXTURES) {
    const result = validator.validate(entry);
    assert.equal(result.valid, true, `${entry.type}: ${JSON.stringify(result.errors)}`);
  }
});

test("a field the type lacks, a missing field and a value out of range fail validation", () => {
  const permission = FIXTURES.find((entry) => entry.type === "permission_decision");
  const turnEnd = FIXTURES.find((entry) => entry.type === "turn_end");
  assert.ok(permission && turnEnd);
  const { policyVersion: _removed, ...incomplete } = permission;
  const invalid: unknown[] = [
    { ...permission, extra: true },
    incomplete,
    { ...permission, decision: "maybe" },
    { ...turnEnd, stopReason: "finished" },
    { ...turnEnd, seq: -1 },
    { ...FIXTURES[0], formatVersion: 2 },
  ];
  for (const input of invalid) assert.equal(validator.validate(input).valid, false, JSON.stringify(input));
});

test("product_record and permission_decision entries validate, and a session header's product is optional", () => {
  for (const type of ["product_record", "permission_decision"]) {
    const entry = FIXTURES.find((e) => e.type === type);
    assert.ok(entry);
    assert.equal(validator.validate(entry).valid, true);
  }
  const bare = FIXTURES[0];
  assert.ok(!("product" in bare));
  assert.equal(validator.validate(bare).valid, true);
});
