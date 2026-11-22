// The entry union: the runtime list matches the type, every entry type has a fixture, and `parseEntry()` reads
// entries, refuses a format it does not know and refuses entries that break the base.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  FORMAT_VERSION,
  isProtocolError,
  parseEntry,
  SESSION_ENTRY_TYPES,
  type SessionEntry,
} from "@buildanagent/protocol";
import { test } from "vitest";
import { FIXTURES } from "./fixtures.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
// Compile-time check: `pnpm typecheck` fails when the runtime list and the union name different types.
const sameType: Equal<(typeof SESSION_ENTRY_TYPES)[number], SessionEntry["type"]> = true;

test("SESSION_ENTRY_TYPES lists every type of the union once, which pnpm typecheck enforces", () => {
  assert.equal(sameType, true);
  assert.equal(new Set(SESSION_ENTRY_TYPES).size, SESSION_ENTRY_TYPES.length);
  assert.equal(
    SESSION_ENTRY_TYPES.length,
    18,
    "the plan lists 21 types; approvals (N13) and code_call (N40) come later",
  );
});

test("every entry type has a fixture, and parseEntry() reads each as a line and as a value", () => {
  assert.deepEqual([...new Set(FIXTURES.map((entry) => entry.type))].sort(), [...SESSION_ENTRY_TYPES].sort());
  for (const entry of FIXTURES) {
    assert.deepEqual(parseEntry(JSON.stringify(entry)), entry);
    assert.deepEqual(parseEntry(entry), entry);
  }
});

test("parseEntry() refuses a session header from another format version with a typed error", () => {
  const header = FIXTURES[0];
  for (const formatVersion of [2, 0, "1", undefined]) {
    assert.throws(
      () => parseEntry({ ...header, formatVersion }),
      (error) => isProtocolError(error) && error.code === "unsupported_format_version",
    );
  }
  assert.equal(FORMAT_VERSION, 1);
});

test("parseEntry() refuses text that is not JSON, a value that is not an object, an unknown type and a bad base", () => {
  const entry = FIXTURES[1];
  const bad: unknown[] = [
    "{not json",
    "[]",
    "null",
    42,
    { ...entry, type: "from_the_future" },
    { ...entry, id: "" },
    { ...entry, parentId: 3 },
    { ...entry, seq: -1 },
    { ...entry, seq: 1.5 },
    { ...entry, timestamp: 5 },
    { ...entry, timestamp: "yesterday" },
    { ...entry, origin: "robot" },
  ];
  for (const input of bad) {
    assert.throws(
      () => parseEntry(input),
      (error) => isProtocolError(error) && error.code === "invalid_entry",
      JSON.stringify(input),
    );
  }
});

test("a usage entry accepts a null total, and a session header needs no product", () => {
  const usage = FIXTURES.find((entry) => entry.type === "usage" && entry.cost.total === null);
  assert.ok(usage, "a fixture with an unknown price exists");
  assert.equal(parseEntry(usage).type, "usage");
  const header = FIXTURES[0];
  assert.ok(header.type === "session_header" && !("product" in header));
  assert.equal(parseEntry(header).type, "session_header");
});

test("the protocol package depends on no harness package, in its manifest or its source", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies });
  assert.ok(!declared.includes("@buildanagent/harness"));
  const src = new URL("../src/", import.meta.url);
  const files = readdirSync(src, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  assert.ok(files.length > 0, "src/ has files to scan");
  for (const file of files) {
    const text = readFileSync(new URL(`${file.parentPath}/${file.name}`, "file:///"), "utf8");
    assert.ok(!/@buildanagent\/harness/.test(text), `${file.name} imports the harness`);
  }
});

test("the stable fields carry a @stable tag: the base fields, formatVersion and each entry's type", () => {
  const source = readFileSync(new URL("../src/entries.ts", import.meta.url), "utf8");
  const tagged = (field: string) => new RegExp(`@stable \\*/\\n  ${field}\\b`).test(source);
  for (const field of ["id", "parentId", "seq", "timestamp", "origin", "formatVersion"]) {
    assert.ok(tagged(field), `${field} lacks @stable`);
  }
  const typeFields = source.match(/\n {2}type: "[a-z_]+";/g) ?? [];
  assert.equal(typeFields.length, SESSION_ENTRY_TYPES.length);
  assert.equal(source.match(/@stable \*\/\n {2}type: "/g)?.length, SESSION_ENTRY_TYPES.length);
});
