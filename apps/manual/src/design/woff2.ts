import { brotliDecompressSync } from "node:zlib";

// Reads the few tables of a WOFF2 font that the book needs: the Windows-platform name records, which the font tests
// check, and the character map and advance widths, which the figure kit uses to refuse a glyph the font lacks and to
// measure a label. It follows the WOFF2 layout (https://www.w3.org/TR/WOFF2/): a 48-byte header, a table directory of
// variable-length entries, then one Brotli stream holding every table in directory order.

// The WOFF2 known-table tags, in the order the spec numbers them; `name` is index 5, `glyf` 10 and `loca` 11.
const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca"];

function readBase128(bytes: Uint8Array, start: number): [value: number, next: number] {
  let value = 0;
  for (let i = start; i < start + 5; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) throw new Error("the WOFF2 table directory ends inside a number");
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, i + 1];
  }
  throw new Error("UIntBase128 longer than five bytes");
}

interface TableEntry {
  readonly tag: string;
  readonly length: number;
  readonly transformed: boolean;
}

function tableDirectory(bytes: Uint8Array, view: DataView): [entries: TableEntry[], next: number] {
  const count = view.getUint16(12);
  const entries: TableEntry[] = [];
  let at = 48;
  for (let i = 0; i < count; i += 1) {
    const flags = bytes[at];
    if (flags === undefined) throw new Error(`the WOFF2 table directory ends after ${i} of its ${count} entries`);
    at += 1;
    const index = flags & 0x3f;
    const transform = flags >> 6;
    let tag = KNOWN_TAGS[index] ?? `#${index}`;
    if (index === 63) {
      tag = String.fromCharCode(...bytes.subarray(at, at + 4));
      at += 4;
    }
    let length: number;
    [length, at] = readBase128(bytes, at);
    // glyf and loca are transformed unless their version is 3; every other table is transformed unless it is 0.
    const transformed = tag === "glyf" || tag === "loca" ? transform !== 3 : transform !== 0;
    if (transformed) [length, at] = readBase128(bytes, at);
    entries.push({ tag, length, transformed });
  }
  return [entries, at];
}

type Tables = Map<string, { readonly bytes: Uint8Array; readonly transformed: boolean }>;

// Each font's tables, decompressed once: the figure kit reads the character map and the advances of one font for
// every label it draws.
const decompressed = new WeakMap<Uint8Array, Tables>();

/** Every table of a WOFF2 font, decompressed and keyed by tag. A transformed table keeps its transformed bytes. */
function woff2Tables(file: Uint8Array): Tables {
  const cached = decompressed.get(file);
  if (cached !== undefined) return cached;
  if (file.byteLength < 48) throw new Error("not a WOFF2 file: shorter than its 48-byte header");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(0) !== 0x774f4632) throw new Error("not a WOFF2 file");
  const [entries, start] = tableDirectory(file, view);
  const stream = brotliDecompressSync(file.subarray(start, start + view.getUint32(20)));
  const tables: Tables = new Map();
  let offset = 0;
  for (const entry of entries) {
    if (offset + entry.length > stream.byteLength) {
      throw new Error(`the WOFF2 font's ${entry.tag} table runs past the end of its decompressed data`);
    }
    tables.set(entry.tag, { bytes: stream.subarray(offset, offset + entry.length), transformed: entry.transformed });
    offset += entry.length;
  }
  decompressed.set(file, tables);
  return tables;
}

/** Runs `read` over one table, turning a read past its end into an error that names the table. */
function reading<T>(tag: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof RangeError) throw new Error(`the ${tag} table is shorter than its own fields say`);
    throw error;
  }
}

function table(file: Uint8Array, tag: string): DataView {
  const found = woff2Tables(file).get(tag);
  if (found === undefined) throw new Error(`no ${tag} table`);
  if (found.transformed) throw new Error(`the ${tag} table is transformed, which this reader does not undo`);
  return new DataView(found.bytes.buffer, found.bytes.byteOffset, found.bytes.byteLength);
}

/** The font's name records on the Windows platform (3), keyed by name id. */
export function woff2Names(file: Uint8Array): Map<number, string> {
  const view = table(file, "name");
  return reading("name", () => nameRecords(view));
}

function nameRecords(view: DataView): Map<number, string> {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const count = view.getUint16(2);
  const storage = view.getUint16(4);
  const names = new Map<number, string>();
  for (let i = 0; i < count; i += 1) {
    const record = 6 + i * 12;
    if (view.getUint16(record) !== 3) continue;
    const length = view.getUint16(record + 8);
    const offset = storage + view.getUint16(record + 10);
    names.set(view.getUint16(record + 6), new TextDecoder("utf-16be").decode(bytes.subarray(offset, offset + length)));
  }
  return names;
}

/** The Unicode subtable to read: format 12 (full Unicode) when the font has one, else format 4 (the BMP). */
function unicodeSubtable(cmap: DataView): number {
  const count = cmap.getUint16(2);
  let bmp: number | undefined;
  for (let i = 0; i < count; i += 1) {
    const record = 4 + i * 8;
    const platform = cmap.getUint16(record);
    const encoding = cmap.getUint16(record + 2);
    const offset = cmap.getUint32(record + 4);
    const format = cmap.getUint16(offset);
    if (format === 12 && (platform === 0 || (platform === 3 && encoding === 10))) return offset;
    if (format === 4 && (platform === 0 || (platform === 3 && encoding === 1))) bmp ??= offset;
  }
  if (bmp === undefined) throw new Error("no Unicode cmap subtable in format 4 or 12");
  return bmp;
}

function format4(cmap: DataView, at: number, map: Map<number, number>): void {
  const segments = cmap.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let s = 0; s < segments; s += 1) {
    const end = cmap.getUint16(ends + s * 2);
    const start = cmap.getUint16(starts + s * 2);
    const delta = cmap.getInt16(deltas + s * 2);
    const rangeOffset = cmap.getUint16(rangeOffsets + s * 2);
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
      else {
        const raw = cmap.getUint16(rangeOffsets + s * 2 + rangeOffset + (code - start) * 2);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) map.set(code, glyph);
    }
  }
}

/** The highest Unicode code point; a format 12 group past it, or running backwards, is corrupt. */
const MAX_CODE_POINT = 0x10ffff;

function format12(cmap: DataView, at: number, map: Map<number, number>): void {
  const groups = cmap.getUint32(at + 12);
  for (let g = 0; g < groups; g += 1) {
    const group = at + 16 + g * 12;
    const start = cmap.getUint32(group);
    const end = cmap.getUint32(group + 4);
    if (end < start || end > MAX_CODE_POINT) {
      throw new Error(`the cmap table's group ${g + 1} runs from ${start} to ${end}, outside Unicode`);
    }
    const first = cmap.getUint32(group + 8);
    for (let code = start; code <= end; code += 1) map.set(code, first + code - start);
  }
}

/** The font's character map: each code point it can draw, and the glyph that draws it. */
export function woff2CharacterMap(file: Uint8Array): Map<number, number> {
  const cmap = table(file, "cmap");
  const at = reading("cmap", () => unicodeSubtable(cmap));
  const map = new Map<number, number>();
  reading("cmap", () => (cmap.getUint16(at) === 12 ? format12(cmap, at, map) : format4(cmap, at, map)));
  return map;
}

/** Each code point's advance width as a fraction of the em, at the font's default instance. */
export function woff2Advances(file: Uint8Array): Map<number, number> {
  const head = table(file, "head");
  const hhea = table(file, "hhea");
  const hmtx = table(file, "hmtx");
  const unitsPerEm = reading("head", () => head.getUint16(18));
  const metrics = reading("hhea", () => hhea.getUint16(34));
  const advances = new Map<number, number>();
  for (const [code, glyph] of woff2CharacterMap(file)) {
    // Glyphs past the last full metric share its advance (the hmtx table's rule for monospaced tails).
    const advance = reading("hmtx", () => hmtx.getUint16(Math.min(glyph, metrics - 1) * 4));
    advances.set(code, advance / unitsPerEm);
  }
  return advances;
}
