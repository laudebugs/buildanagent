// The registers keep one entry per line, sorted by id, so branches that add entries merge without conflicts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { formatRegister, parseRegister, REGISTER_FILES, repeatedIds } from "../src/book/register-format.js";

const app = (file: string) => fileURLToPath(new URL(`../${file}`, import.meta.url));
const FIX = "run `pnpm --filter @buildanagent/manual registers:format`";

describe("the layout", () => {
  test("sorts by id, writes one entry per line and ends with a newline", () => {
    const text = formatRegister([
      { id: "b", note: "two" },
      { id: "a", note: "one", nested: { x: [1, 2] } },
    ]);
    assert.equal(text, '[\n  {"id":"a","note":"one","nested":{"x":[1,2]}},\n  {"id":"b","note":"two"}\n]\n');
  });

  test("keeps the order of an entry's own keys and sorts ids by code unit", () => {
    const keyed = formatRegister([{ id: "b", z: 1, a: 2 }]);
    assert.equal(keyed, '[\n  {"id":"b","z":1,"a":2}\n]\n', "the keys stay in the order the entry has them");
    const text = formatRegister([{ id: "b-1" }, { id: "a2" }, { id: "a-2" }, { id: "B" }]);
    assert.deepEqual(
      text
        .split("\n")
        .slice(1, -2)
        .map((line) => line.replace(/[ ,]/g, "")),
      ['{"id":"B"}', '{"id":"a-2"}', '{"id":"a2"}', '{"id":"b-1"}'],
    );
  });

  test("finds a repeated id, and refuses an entry with no string id", () => {
    assert.deepEqual(repeatedIds([{ id: "a" }, { id: "b" }, { id: "a" }, { id: "a" }]), ["a"]);
    assert.throws(() => parseRegister('[{"name":"x"}]'), /needs a string id/);
    assert.throws(() => parseRegister('{"id":"a"}'), /JSON array/);
  });

  test("refuses a repeated key inside an entry, names the file on a syntax error, and writes an empty register as []", () => {
    assert.throws(() => parseRegister('[{"id":"a","x":1,"x":2}]', "sources.json"), /repeats the key "x"/);
    assert.doesNotThrow(() => parseRegister('[{"id":"a","x":"{\\"y\\":1,\\"y\\":2}"},{"id":"b","x":1}]'));
    assert.throws(() => parseRegister('[{"id":"a"} {"id":"b"}]', "glossary.json"), /glossary.json is not valid JSON/);
    assert.equal(formatRegister([]), "[]\n");
  });
});

describe.each(REGISTER_FILES)("%s", (file) => {
  const text = readFileSync(app(file), "utf8");

  test("has no repeated id", () => {
    const repeated = repeatedIds(parseRegister(text, file));
    assert.deepEqual(repeated, [], `${file} repeats ${repeated.join(", ")}: keep one entry of each, then ${FIX}`);
  });

  test("is in canonical form: one entry per line, sorted by id", () => {
    assert.equal(text, formatRegister(parseRegister(text, file)), `${file} is not in canonical form: ${FIX}`);
  });
});
