// The session format page against the protocol: every entry type has a section, every field of the JSON Schema is in its
// section, every field a section lists is in the schema, and a field is marked optional exactly when the schema allows it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMAT_VERSION, SESSION_ENTRY_TYPES } from "@buildanagent/harness/session";
import { describe, test } from "vitest";

interface EntrySchema {
  readonly properties: Record<string, unknown>;
  readonly required: readonly string[];
}

const doc = readFileSync(new URL("../../docs/session-format.md", import.meta.url), "utf8");
// The protocol's entry point is one folder below its package root, in src/ or in dist/, so the schema is a level up.
const protocolEntry = fileURLToPath(import.meta.resolve("@buildanagent/protocol"));
const schema = JSON.parse(
  readFileSync(join(dirname(protocolEntry), "..", "schema", "session-entry.schema.json"), "utf8"),
) as { oneOf: EntrySchema[] };

const BASE = ["id", "parentId", "seq", "timestamp", "type", "origin"];
const typeOf = (entry: EntrySchema) => (entry.properties.type as { const: string }).const;
const schemaOf = new Map(schema.oneOf.map((entry) => [typeOf(entry), entry]));

/** The rows of a section's table: field name and whether its type cell says optional. */
function rows(section: string): Map<string, boolean> {
  const found = new Map<string, boolean>();
  for (const line of section.split("\n")) {
    const cells = /^\| `([A-Za-z]+)` \| (.*?) \| .* \|$/.exec(line);
    if (cells?.[1] !== undefined) found.set(cells[1], /optional/.test(cells[2] ?? ""));
  }
  return found;
}

/** The text under `### \`type\``, up to the next heading. */
function sectionOf(type: string): string {
  const start = doc.indexOf(`\n### \`${type}\`\n`);
  assert.notEqual(start, -1, `the page has no section for ${type}`);
  const next = doc.indexOf("\n#", start + 5);
  return doc.slice(start, next === -1 ? undefined : next);
}

describe("the session format page", () => {
  test("lists every type in SESSION_ENTRY_TYPES, once and in order, and no other", () => {
    const headings = [...doc.matchAll(/^### `([a-z_]+)`$/gm)].map((match) => match[1]);
    assert.deepEqual(headings, [...SESSION_ENTRY_TYPES]);
  });

  test("agrees with the JSON Schema on every type", () => {
    assert.deepEqual([...schemaOf.keys()].sort(), [...SESSION_ENTRY_TYPES].sort());
    for (const type of SESSION_ENTRY_TYPES) {
      const entry = schemaOf.get(type);
      assert.ok(entry, type);
      const documented = rows(sectionOf(type));
      const own = Object.keys(entry.properties).filter((name) => !BASE.includes(name));
      assert.deepEqual(
        [...documented.keys()].sort(),
        own.sort(),
        `${type}: the documented fields differ from the schema's`,
      );
      for (const [field, optional] of documented) {
        assert.equal(
          optional,
          !entry.required.includes(field),
          `${type}.${field}: optional in the page and in the schema differ`,
        );
      }
    }
  });

  test("names the six base fields, and the format version the protocol writes", () => {
    const base = rows(
      doc.slice(doc.indexOf("## Every entry carries six base fields"), doc.indexOf("## Twenty entry types")),
    );
    assert.deepEqual([...base.keys()].sort(), [...BASE].sort());
    assert.ok(doc.includes(`the current value is ${FORMAT_VERSION}.`));
    for (const field of BASE) assert.ok(schemaOf.get("turn_end")?.properties[field] !== undefined, field);
  });
});
