// The JSON Schema of the entry union: the committed file is what the generator writes now, every fixture validates
// against it, the changes a reader must reject do not, and the field names of every entry match the type's.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SessionEntry } from "@buildanagent/protocol";
import { Validator } from "@cfworker/json-schema";
import { test } from "vitest";
import { buildSessionEntrySchema, type MirroredEntry } from "../scripts/session-entry-schema.js";
import { FIXTURES } from "./fixtures.js";

const committed = readFileSync(new URL("../schema/session-entry.schema.json", import.meta.url), "utf8");
const validator = new Validator(JSON.parse(committed), "2020-12");

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type KeysByType<E extends { type: string }> = { [T in E["type"]]: keyof Extract<E, { type: T }> };
// Field names only: zod writes an optional field as `a?: T | undefined`, which `exactOptionalPropertyTypes` tells
// apart from `a?: T`, so the comparison leaves types out. The fixtures check the rest against the schema.
const sameFields: Equal<KeysByType<SessionEntry>, KeysByType<MirroredEntry>> = true;

test("the committed schema is what the generator writes now", () => {
  assert.equal(
    committed,
    `${JSON.stringify(buildSessionEntrySchema(), null, 2)}\n`,
    "run `pnpm --filter @buildanagent/protocol schema`",
  );
});

test("every entry type has the same field names in the type and in the schema's source", () => {
  assert.equal(sameFields, true);
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
