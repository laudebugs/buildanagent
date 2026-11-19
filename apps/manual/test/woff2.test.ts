import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { woff2Advances, woff2CharacterMap, woff2Names } from "../src/design/woff2.js";

// The WOFF2 reader against the committed code font, and against files cut short or corrupted on purpose.
const font = new Uint8Array(
  readFileSync(new URL("../public/fonts/manual-code/manual-code-roman.woff2", import.meta.url)),
);

test("the character map holds the subset's 484 code points, each mapped to a glyph", () => {
  const map = woff2CharacterMap(font);
  assert.equal(map.size, 484);
  assert.ok((map.get("A".codePointAt(0) ?? 0) ?? 0) > 0);
  assert.ok(map.has(0x2192), "the subset keeps →");
  assert.equal(map.has(0x21ba), false, "the subset drops ↺");
});

test("every advance of the monospaced code font is 0.6 em", () => {
  assert.deepEqual([...new Set(woff2Advances(font).values())], [0.6]);
});

test("the reader names the file or table that is wrong", () => {
  assert.throws(() => woff2CharacterMap(new Uint8Array(10)), /shorter than its 48-byte header/);
  assert.throws(() => woff2CharacterMap(new Uint8Array(48)), /not a WOFF2 file/);
  const truncated = font.slice(0, 50);
  assert.throws(() => woff2Names(truncated), /the WOFF2 table directory ends/);
});
