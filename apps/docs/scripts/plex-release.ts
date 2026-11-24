// The checks `fetch-plex.ts` runs on a release of @ibm/plex-sans before it writes anything into public/ or the pin.
// The tarball is untrusted data: it is read in memory, never unpacked onto disk, so a symbolic link, a hard link or a
// path that climbs out of the package can't make the script copy some other file of this machine into the site.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { PlexPin } from "../src/design/theme.js";

/** What `npm view <spec> dist.integrity dist.tarball gitHead time --json` reports about a release. */
export interface PlexView {
  readonly integrity: string;
  readonly tarball: string;
  readonly gitHead: string;
  readonly time: Readonly<Record<string, string>>;
}

/**
 * Reads the output of `npm view`, which is empty, or an `{ "error": … }` object, when the registry has no such
 * release, and refuses a release without an integrity, a tarball address or a 40-character commit.
 */
export function parseView(stdout: string, spec: string): PlexView {
  const raw = stdout.trim() === "" ? undefined : (JSON.parse(stdout) as Record<string, unknown>);
  if (raw === undefined || "error" in raw) throw new Error(`no such release ${spec}`);
  const field = (key: string): unknown => raw[key];
  const integrity = field("dist.integrity");
  const tarball = field("dist.tarball");
  const gitHead = field("gitHead");
  const time = field("time");
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
    throw new Error(`the registry gives no sha512 integrity for ${spec}`);
  }
  if (typeof tarball !== "string" || !tarball.startsWith("https://registry.npmjs.org/")) {
    throw new Error(`the registry gives no registry.npmjs.org tarball for ${spec}`);
  }
  if (typeof gitHead !== "string" || !/^[0-9a-f]{40}$/.test(gitHead)) {
    throw new Error(`the registry gives no source commit (gitHead) for ${spec}`);
  }
  if (typeof time !== "object" || time === null) throw new Error(`the registry gives no publish times for ${spec}`);
  return { integrity, tarball, gitHead, time: time as Record<string, string> };
}

/** How old a release must be before it is pinned, in days: the repo's rule for every dependency. */
export const PLEX_MIN_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const BLOCK = 512;
// The 1.1.0 tarball unpacks to about 30 MB; the cap stops a decompression bomb long before memory runs out.
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const MAX_LICENCE_BYTES = 64 * 1024;
const WOFF2_MAGIC = "wOF2";
// A licence may hold tabs, line ends, printable ASCII, printable Latin-1 but the soft hyphen (IBM's has "©") and the
// typographic dashes, quotes and ellipsis. That leaves out C0 and C1 controls, the byte-order mark, zero-width and
// bidirectional controls, and every other invisible format character.
const LICENCE_TEXT = /^[\t\n\r\u0020-\u007e\u00a0-\u00ac\u00ae-\u00ff\u2010-\u2027]*$/;

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
export function readTarball(gzipped: Buffer, maxBytes: number = MAX_UNPACKED_BYTES): Map<string, Buffer> {
  let tar: Buffer;
  try {
    tar = gunzipSync(gzipped, { maxOutputLength: maxBytes });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new Error(`the tarball unpacks to more than ${maxBytes} bytes`);
    }
    throw error;
  }
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
  if (licence.length > MAX_LICENCE_BYTES || plain === undefined || !LICENCE_TEXT.test(plain)) {
    throw new Error(`${licenceFile} is not plain text under ${MAX_LICENCE_BYTES} bytes`);
  }
  return { fonts, licence };
}

/**
 * The `unicode-range` IBM's per-face CSS, beside the split files in `folder`, gives each named Latin1 file. Every file
 * must have one and all must agree, since the docs declare one range for the three faces.
 */
export function latin1Range(files: ReadonlyMap<string, Buffer>, folder: string, fontNames: readonly string[]): string {
  const ranges = fontNames.map((name) => {
    const cssName = `${folder}/${name.replace(/-Latin1\.woff2$/, ".css")}`;
    const css = files.get(`package/${cssName}`)?.toString("utf8");
    if (css === undefined || cssName.endsWith(".woff2")) throw new Error(`the tarball has no package/${cssName}`);
    const rule = css.split("@font-face").find((block) => block.includes(`url("${name}")`));
    const range = rule
      ?.match(/unicode-range:\s*([^;}]+)/)?.[1]
      ?.trim()
      .replace(/\s+/g, " ");
    if (
      range === undefined ||
      !/^U\+[0-9A-F]{4,6}(-[0-9A-F]{4,6})?(, U\+[0-9A-F]{4,6}(-[0-9A-F]{4,6})?)*$/i.test(range)
    ) {
      throw new Error(`${cssName} gives ${name} no unicode-range`);
    }
    return range;
  });
  if (new Set(ranges).size !== 1) throw new Error(`IBM's CSS gives the faces different ranges: ${ranges.join(" | ")}`);
  return ranges[0] as string;
}

/** The copyright line of an OFL 1.1 licence; it refuses a licence that is not the SIL Open Font License 1.1. */
export function licenceCopyright(licence: Buffer): string {
  const text = licence.toString("utf8");
  if (!/SIL Open Font License,? Version 1\.1/i.test(text)) throw new Error("the licence is not the SIL OFL 1.1");
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("Copyright "));
  if (line === undefined) throw new Error("the licence has no copyright line");
  return line.trim();
}

/** What a run learned about a release, from the registry and its checked tarball. */
export interface PlexFetch {
  readonly version: string;
  readonly view: PlexView;
  readonly integrity: string;
  readonly published: string;
  readonly today: string;
  readonly files: ReadonlyMap<string, Buffer>;
  readonly release: PlexRelease;
}

/**
 * The pin for a fetched release. Every field that describes the release comes from the registry or the tarball, not
 * from the old pin: the source commit and tarball address from `npm view`, the range from IBM's CSS and the copyright
 * from the licence. The old pin supplies only the docs' own choices, the family, folder and face list.
 */
export function nextPin(pin: PlexPin, fetched: PlexFetch): PlexPin {
  const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
  if (basename(fetched.view.tarball) !== `${pin.package.split("/").pop()}-${fetched.version}.tgz`) {
    throw new Error(
      `the registry's tarball ${fetched.view.tarball} is not named for ${pin.package} ${fetched.version}`,
    );
  }
  return {
    ...pin,
    version: fetched.version,
    published: fetched.published,
    pinned: fetched.version === pin.version ? pin.pinned : fetched.today,
    registry: fetched.view.tarball,
    integrity: fetched.integrity,
    gitHead: fetched.view.gitHead,
    copyright: licenceCopyright(fetched.release.licence),
    licenseFile: { ...pin.licenseFile, sha256: sha256(fetched.release.licence) },
    files: pin.files.map((file) => {
      const data = fetched.release.fonts.find((font) => font.name === file.name)?.data;
      if (data === undefined) throw new Error(`the release has no ${file.name}`);
      return { ...file, bytes: data.length, sha256: sha256(data) };
    }),
    unicodeRange: latin1Range(
      fetched.files,
      pin.folder,
      pin.files.map((file) => file.name),
    ),
  };
}

/**
 * Replaces `target` with a folder holding `files` plus the named files kept from the old one. The new folder is
 * written beside the old under a temporary name and swapped in with two renames, so an error while writing leaves
 * the old folder as it was.
 */
export function replaceFolder(
  target: string,
  files: readonly { name: string; data: Buffer }[],
  keep: readonly string[],
): void {
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const stamp = randomBytes(6).toString("hex");
  const staging = join(parent, `.${basename(target)}-new-${stamp}`);
  const old = join(parent, `.${basename(target)}-old-${stamp}`);
  mkdirSync(staging);
  try {
    for (const name of keep) {
      const from = join(target, name);
      if (existsSync(from)) writeFileSync(join(staging, name), readFileSync(from), { mode: 0o644, flag: "wx" });
    }
    for (const file of files) writeFileSync(join(staging, file.name), file.data, { mode: 0o644, flag: "wx" });
    if (existsSync(target)) renameSync(target, old);
    try {
      renameSync(staging, target);
    } catch (error) {
      if (existsSync(old)) renameSync(old, target);
      throw error;
    }
    rmSync(old, { recursive: true, force: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Writes a file under a temporary name beside it and renames it into place, so a reader never sees half of it. */
export function writeFileAtomic(path: string, data: string): void {
  const temporary = join(dirname(path), `.${basename(path)}-${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(temporary, data, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
