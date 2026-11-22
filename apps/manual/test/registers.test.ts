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

  test("keeps the order of an entry's own keys and sorts ids by code point", () => {
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
});

describe.each(REGISTER_FILES)("%s", (file) => {
  const text = readFileSync(app(file), "utf8");

  test("has no repeated id", () => {
    assert.deepEqual(repeatedIds(parseRegister(text, file)), [], `a repeated id; keep one entry`);
  });

  test("is in canonical form: one entry per line, sorted by id", () => {
    assert.equal(text, formatRegister(parseRegister(text, file)), `${file} is not in canonical form: ${FIX}`);
  });
});
