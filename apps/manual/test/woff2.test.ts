import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as zlib from "node:zlib";
import { test, vi } from "vitest";
import { woff2Advances, woff2CharacterMap, woff2Names } from "../src/design/woff2.js";

// The WOFF2 reader against the committed code font, and against small fonts built here with one thing wrong, so each
// failure path runs. The decompressor is wrapped to count its calls.
vi.mock("node:zlib", async (original) => {
  const actual = await original<typeof import("node:zlib")>();
  return { ...actual, brotliDecompressSync: vi.fn(actual.brotliDecompressSync) };
});

const font = new Uint8Array(
  readFileSync(new URL("../public/fonts/manual-code/manual-code-roman.woff2", import.meta.url)),
);

/** The WOFF2 known-table index of each tag these tests build. */
const TAG_INDEX: Record<string, number> = { cmap: 0, head: 1, hhea: 2, hmtx: 3, name: 5 };

/**
 * A WOFF2 file holding `tables`, untransformed, in one Brotli stream. `declared` overrides the length the directory
 * gives a table, to describe a table longer than the data holds.
 */
function woff2Of(tables: { tag: string; bytes: Uint8Array; declared?: number }[]): Uint8Array {
  const directory: number[] = [];
  for (const { tag, bytes, declared } of tables) {
    directory.push(TAG_INDEX[tag] ?? 63);
    let length = declared ?? bytes.byteLength;
    const base128: number[] = [length & 0x7f];
    for (length >>= 7; length > 0; length >>= 7) base128.unshift((length & 0x7f) | 0x80);
    directory.push(...base128);
  }
  const stream = zlib.brotliCompressSync(Buffer.concat(tables.map(({ bytes }) => bytes)));
  const file = new Uint8Array(48 + directory.length + stream.byteLength);
  const view = new DataView(file.buffer);
  view.setUint32(0, 0x774f4632);
  view.setUint16(12, tables.length);
  view.setUint32(20, stream.byteLength);
  file.set(directory, 48);
  file.set(stream, 48 + directory.length);
  return file;
}

/** A cmap table with one Windows Unicode subtable in format 12 holding one group. */
function cmapFormat12(start: number, end: number): Uint8Array {
  const bytes = new Uint8Array(12 + 28);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1);
  view.setUint16(4, 3);
  view.setUint16(6, 10);
  view.setUint32(8, 12);
  view.setUint16(12, 12);
  view.setUint32(16, 28);
  view.setUint32(24, 1);
  view.setUint32(28, start);
  view.setUint32(32, end);
  view.setUint32(36, 1);
  return bytes;
}

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

test("a built font with a valid format 12 group reads back", () => {
  assert.deepEqual(
    [...woff2CharacterMap(woff2Of([{ tag: "cmap", bytes: cmapFormat12(0x41, 0x42) }]))],
    [
      [0x41, 1],
      [0x42, 2],
    ],
  );
});

test("a format 12 group past U+10FFFF, or running backwards, fails instead of mapping a million code points", () => {
  assert.throws(
    () => woff2CharacterMap(woff2Of([{ tag: "cmap", bytes: cmapFormat12(0x41, 0x110000) }])),
    /the cmap table's group 1 runs from 65 to 1114112, outside Unicode/,
  );
  assert.throws(
    () => woff2CharacterMap(woff2Of([{ tag: "cmap", bytes: cmapFormat12(0x42, 0x41) }])),
    /outside Unicode/,
  );
});

test("a table shorter than its own fields fails, naming the table", () => {
  const cut = cmapFormat12(0x41, 0x42).slice(0, 30);
  assert.throws(
    () => woff2CharacterMap(woff2Of([{ tag: "cmap", bytes: cut }])),
    /the cmap table is shorter than its own fields say/,
  );
});

test("a table the directory says is longer than the decompressed data fails, naming the table", () => {
  const bytes = cmapFormat12(0x41, 0x42);
  assert.throws(
    () => woff2CharacterMap(woff2Of([{ tag: "cmap", bytes, declared: bytes.byteLength + 100 }])),
    /the WOFF2 font's cmap table runs past the end of its decompressed data/,
  );
});

test("the reader decompresses a font once, however many tables it reads", () => {
  const file = new Uint8Array(font);
  const decompress = vi.mocked(zlib.brotliDecompressSync);
  decompress.mockClear();
  woff2CharacterMap(file);
  woff2Advances(file);
  woff2Names(file);
  assert.equal(decompress.mock.calls.length, 1);
});

test("the reader names the file or directory that is wrong", () => {
  assert.throws(() => woff2CharacterMap(new Uint8Array(10)), /shorter than its 48-byte header/);
  assert.throws(() => woff2CharacterMap(new Uint8Array(48)), /not a WOFF2 file/);
  assert.throws(() => woff2Names(font.slice(0, 50)), /the WOFF2 table directory ends/);
});
