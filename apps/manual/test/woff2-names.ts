import { brotliDecompressSync } from "node:zlib";

// Reads the Windows-platform name records of a WOFF2 font, enough for the font tests to check what a served subset
// calls itself. It follows the WOFF2 layout (https://www.w3.org/TR/WOFF2/): a 48-byte header, a table directory of
// variable-length entries, then one Brotli stream holding every table in directory order.

// The WOFF2 known-table tags, in the order the spec numbers them; `name` is index 5, `glyf` 10 and `loca` 11.
const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca"];

function readBase128(bytes: Uint8Array, start: number): [value: number, next: number] {
  let value = 0;
  for (let i = start; i < start + 5; i += 1) {
    const byte = bytes[i] ?? 0;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, i + 1];
  }
  throw new Error("UIntBase128 longer than five bytes");
}

interface TableEntry {
  readonly tag: string;
  readonly length: number;
}

function tableDirectory(bytes: Uint8Array, view: DataView): [entries: TableEntry[], next: number] {
  const count = view.getUint16(12);
  const entries: TableEntry[] = [];
  let at = 48;
  for (let i = 0; i < count; i += 1) {
    const flags = bytes[at] ?? 0;
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
    entries.push({ tag, length });
  }
  return [entries, at];
}

/** The font's name records on the Windows platform (3), keyed by name id. */
export function woff2Names(file: Uint8Array): Map<number, string> {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(0) !== 0x774f4632) throw new Error("not a WOFF2 file");
  const [entries, start] = tableDirectory(file, view);
  const tables = brotliDecompressSync(file.subarray(start, start + view.getUint32(20)));
  let offset = 0;
  for (const entry of entries) {
    if (entry.tag === "name") return nameRecords(tables.subarray(offset, offset + entry.length));
    offset += entry.length;
  }
  throw new Error("no name table");
}

function nameRecords(table: Uint8Array): Map<number, string> {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2);
  const storage = view.getUint16(4);
  const names = new Map<number, string>();
  for (let i = 0; i < count; i += 1) {
    const record = 6 + i * 12;
    if (view.getUint16(record) !== 3) continue;
    const length = view.getUint16(record + 8);
    const offset = storage + view.getUint16(record + 10);
    names.set(view.getUint16(record + 6), new TextDecoder("utf-16be").decode(table.subarray(offset, offset + length)));
  }
  return names;
}
