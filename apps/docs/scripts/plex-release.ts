// The checks `fetch-plex.ts` runs on a release of @ibm/plex-sans before it writes anything into public/ or the pin.
// The tarball is untrusted data: it is read in memory, never unpacked onto disk, so a symbolic link, a hard link or a
// path that climbs out of the package can't make the script copy some other file of this machine into the site.
import { gunzipSync } from "node:zlib";

/** How old a release must be before it is pinned, in days: the repo's rule for every dependency. */
export const PLEX_MIN_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const BLOCK = 512;
// The 1.1.0 tarball unpacks to about 30 MB; the cap stops a decompression bomb long before memory runs out.
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const MAX_LICENCE_BYTES = 64 * 1024;
const WOFF2_MAGIC = "wOF2";

/**
 * Refuses a version that is not a plain `major.minor.patch`. Anything else, such as `npm:other@1.0.0`, would make npm
 * read another package's spec, so the check runs before any command is spawned.
 */
export function checkVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${version}" is not a release version such as 1.1.0`);
}

/**
 * Returns the publish date (YYYY-MM-DD) of a release from the registry's `time` entry, and refuses a release with no
 * publish time or one published less than {@link PLEX_MIN_AGE_DAYS} days before `now`.
 */
export function checkPublished(time: unknown, now: Date): string {
  if (typeof time !== "string" || Number.isNaN(Date.parse(time))) {
    throw new Error("the registry gives no publish time for this release");
  }
  const age = now.getTime() - Date.parse(time);
  if (age < PLEX_MIN_AGE_DAYS * DAY_MS) {
    throw new Error(`the release was published ${time}, less than ${PLEX_MIN_AGE_DAYS} days ago: wait until it is`);
  }
  return time.slice(0, 10);
}

function text(header: Buffer, start: number, length: number): string {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function octal(header: Buffer, start: number, length: number, what: string): number {
  const field = text(header, start, length).trim();
  if (!/^[0-7]+$/.test(field)) throw new Error(`the tarball has an entry whose ${what} is not an octal number`);
  return Number.parseInt(field, 8);
}

function checkHeaderSum(header: Buffer): void {
  let sum = 0;
  for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  if (sum !== octal(header, 148, 8, "checksum")) throw new Error("the tarball has a header with a wrong checksum");
}

// A PAX extended header holds records of the form "<length> <key>=<value>\n"; only `path` and `size` matter here.
function paxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const length = space === -1 ? Number.NaN : Number(data.subarray(at, space).toString("utf8"));
    if (!Number.isInteger(length) || length <= 0 || at + length > data.length) {
      throw new Error("the tarball has a malformed PAX header");
    }
    const record = data.subarray(space + 1, at + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals === -1) throw new Error("the tarball has a malformed PAX header");
    records.set(record.slice(0, equals), record.slice(equals + 1));
    at += length;
  }
  return records;
}

/** Refuses an entry name that is absolute, climbs with `..`, or lies outside the package's `package/` folder. */
export function checkEntryName(name: string): void {
  const parts = name.split("/");
  if (
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    parts[0] !== "package" ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`the tarball has an entry with an unsafe name: ${JSON.stringify(name)}`);
  }
}

/**
 * Reads a gzipped npm tarball in memory and returns its files by name. It refuses the whole tarball when any entry is
 * not a regular file (a symbolic link, a hard link, a device, a directory), has an unsafe name or appears twice, so
 * nothing is written unless every entry is plain data.
 */
export function readTarball(gzipped: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(gzipped, { maxOutputLength: MAX_UNPACKED_BYTES });
  const files = new Map<string, Buffer>();
  let pax = new Map<string, string>();
  let at = 0;
  while (at + BLOCK <= tar.length) {
    const header = tar.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) return files;
    checkHeaderSum(header);
    const type = String.fromCharCode(header[156] ?? 0);
    const size = pax.has("size") ? Number(pax.get("size")) : octal(header, 124, 12, "size");
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("the tarball has an entry with an invalid size");
    const start = at + BLOCK;
    if (start + size > tar.length) throw new Error("the tarball ends inside an entry");
    const data = tar.subarray(start, start + size);
    at = start + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      pax = paxRecords(data);
      continue;
    }
    const prefix = text(header, 257, 6) === "ustar" ? text(header, 345, 155) : "";
    const name = pax.get("path") ?? (prefix === "" ? text(header, 0, 100) : `${prefix}/${text(header, 0, 100)}`);
    pax = new Map();
    if (type !== "0" && type !== "\0") {
      throw new Error(
        `the tarball's entry ${JSON.stringify(name)} is not a regular file (type ${JSON.stringify(type)})`,
      );
    }
    checkEntryName(name);
    if (files.has(name)) throw new Error(`the tarball has two entries named ${JSON.stringify(name)}`);
    files.set(name, Buffer.from(data));
  }
  throw new Error("the tarball has no end-of-archive marker");
}

/** The files the docs take from a release: each font's bytes by name, and the licence's. */
export interface PlexRelease {
  readonly fonts: readonly { readonly name: string; readonly data: Buffer }[];
  readonly licence: Buffer;
}

/**
 * Takes the named fonts from `folder` and the licence file from the package root, and refuses a font that is not
 * WOFF2 or a licence that is not short plain UTF-8 text.
 */
export function takePlexFiles(
  files: ReadonlyMap<string, Buffer>,
  folder: string,
  fontNames: readonly string[],
  licenceFile: string,
): PlexRelease {
  const take = (path: string): Buffer => {
    const data = files.get(`package/${path}`);
    if (data === undefined) throw new Error(`the tarball has no package/${path}`);
    return data;
  };
  const fonts = fontNames.map((name) => {
    const data = take(`${folder}/${name}`);
    if (data.length > MAX_FONT_BYTES || data.subarray(0, 4).toString("latin1") !== WOFF2_MAGIC) {
      throw new Error(`${name} is not a WOFF2 file under ${MAX_FONT_BYTES} bytes`);
    }
    return { name, data };
  });
  const licence = take(licenceFile);
  const plain = (() => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(licence);
    } catch {
      return undefined;
    }
  })();
  if (licence.length > MAX_LICENCE_BYTES || plain === undefined || /[^\t\n\r\x20-\x7e\u0080-￿]/.test(plain)) {
    throw new Error(`${licenceFile} is not plain text under ${MAX_LICENCE_BYTES} bytes`);
  }
  return { fonts, licence };
}
