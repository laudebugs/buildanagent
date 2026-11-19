// Checks the book-dist artifact that book-build.yml uploaded and unpacks it into dist/ for the deploy workflow.
//
// The artifact may come from any pull request, a fork's included, so nothing in it is trusted (book plan BK15). The
// workflow downloads it unextracted, and this script reads the zip itself instead of letting a general extractor
// write wherever the archive's names point. It refuses the whole artifact, before writing anything, when an entry:
//
// - has a name that is absolute, holds a backslash, `.` or `..`, or starts a segment with a dot (such as
//   `.assetsignore`, which Wrangler would read);
// - is a symbolic link or anything else that is not a plain file or a directory;
// - is encrypted, uses a compression method other than store or deflate, or needs ZIP64;
// - repeats another entry's name, or sits under a name another entry uses as a file;
// - is one of the files Cloudflare's asset server treats as configuration (`_redirects`, `_routes.json`,
//   `_worker.js`), or any other top-level name starting with `_` except `_astro` and `_headers`;
// - is larger than 25 MiB, Cloudflare's limit for one asset;
// - pushes the archive past 20,000 files, the Workers Free plan's limit per Worker version, or past 100 MiB unpacked.
//
// It also refuses an artifact without index.html or 404.html, and an entry whose data fails its CRC-32 or size.
// It skips the artifact's own _headers file, refuses a `_headers` directory or anything under one, and writes main's
// public/_headers in its place, so a pull request cannot change the headers.
//
// Usage: node scripts/stage-dist.mjs <download directory> <dist directory> <_headers file>. The download directory
// must hold exactly one file, the zip that actions/download-artifact saved with skip-decompress.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";

export const LIMITS = {
  /** Cloudflare's limit for one static asset. */
  fileBytes: 25 * 1024 * 1024,
  /** The Workers Free plan's limit of files per Worker version. */
  files: 20_000,
  /** Our own cap on the unpacked site and on the zip, many times the book's size. */
  totalBytes: 100 * 1024 * 1024,
};

const REQUIRED = ["index.html", "404.html"];
const ALLOWED_UNDERSCORE = new Set(["_astro", "_headers"]);

export class ArtifactError extends Error {
  constructor(message) {
    super(`Artifact refused: ${message}`);
    this.name = "ArtifactError";
  }
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

function findEndOfCentralDirectory(zip) {
  // The record is 22 bytes plus a comment of at most 65,535 bytes, at the very end of the file.
  const earliest = Math.max(0, zip.length - 22 - 0xffff);
  for (let at = zip.length - 22; at >= earliest; at--) {
    if (zip.readUInt32LE(at) === EOCD && at + 22 + zip.readUInt16LE(at + 20) === zip.length) return at;
  }
  throw new ArtifactError("not a zip file (no end of central directory record)");
}

/** Checks one entry name and returns its path segments; a trailing slash marks a directory. */
export function checkName(name) {
  if (name.length === 0 || name.length > 1024) throw new ArtifactError(`an entry name has ${name.length} characters`);
  if (name.includes("\\") || name.includes("\0")) throw new ArtifactError(`"${name}" holds a backslash or NUL`);
  if (name.startsWith("/")) throw new ArtifactError(`"${name}" is an absolute path`);
  const segments = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") throw new ArtifactError(`"${name}" is not a plain path`);
    if (segment.startsWith(".")) throw new ArtifactError(`"${name}" has a segment that starts with a dot`);
  }
  const top = segments[0];
  // main's copy replaces the artifact's _headers, so only a plain top-level file may carry that name.
  if (top === "_headers" && (segments.length > 1 || name.endsWith("/"))) {
    throw new ArtifactError(`"${name}": _headers must be a plain file, which main's copy replaces`);
  }
  if (top.startsWith("_") && !ALLOWED_UNDERSCORE.has(top)) {
    throw new ArtifactError(`"${top}" is a name Cloudflare's asset server may treat as configuration`);
  }
  return segments;
}

/**
 * Reads a zip archive's central directory and returns its entries, checking every rule above that the directory
 * alone can settle. Throws an ArtifactError on the first broken rule.
 */
export function readEntries(zip) {
  if (zip.length > LIMITS.totalBytes) throw new ArtifactError(`the zip is ${zip.length} bytes`);
  const end = findEndOfCentralDirectory(zip);
  if (zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0) {
    throw new ArtifactError("the zip spans several disks");
  }
  const count = zip.readUInt16LE(end + 10);
  const size = zip.readUInt32LE(end + 12);
  const offset = zip.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new ArtifactError("the zip needs ZIP64");
  if (count > LIMITS.files) throw new ArtifactError(`the zip holds ${count} entries, over ${LIMITS.files}`);
  if (offset + size > end) throw new ArtifactError("the central directory overlaps its end record");

  const entries = [];
  const files = new Set();
  const dirs = new Set();
  let total = 0;
  let at = offset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL) throw new ArtifactError("the central directory is broken");
    const madeBy = zip.readUInt16LE(at + 4) >> 8;
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const uncompressedSize = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const external = zip.readUInt32LE(at + 38);
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (at > end) throw new ArtifactError("the central directory is broken");

    const segments = checkName(name);
    if (flags & 0x1) throw new ArtifactError(`"${name}" is encrypted`);
    if (method !== 0 && method !== 8) throw new ArtifactError(`"${name}" uses compression method ${method}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ArtifactError(`"${name}" needs ZIP64`);
    }
    // Unix archivers keep the file type in the high 16 bits; others leave it 0, and bit 4 marks an MS-DOS directory.
    const mode = madeBy === 3 ? external >>> 16 : 0;
    const type = mode & S_IFMT;
    const isDir = name.endsWith("/");
    if (type !== 0 && type !== (isDir ? S_IFDIR : S_IFREG)) {
      throw new ArtifactError(`"${name}" is a symbolic link or another special file`);
    }
    if (!isDir && madeBy !== 3 && external & 0x10) throw new ArtifactError(`"${name}" is marked as a directory`);

    const path = segments.join("/");
    if (files.has(path) || (isDir ? false : dirs.has(path))) throw new ArtifactError(`"${path}" appears twice`);
    for (let i = 1; i < segments.length; i++) {
      const parent = segments.slice(0, i).join("/");
      if (files.has(parent)) throw new ArtifactError(`"${path}" sits under the file "${parent}"`);
      dirs.add(parent);
    }
    if (isDir) {
      dirs.add(path);
      continue;
    }
    if (uncompressedSize > LIMITS.fileBytes) throw new ArtifactError(`"${path}" is ${uncompressedSize} bytes`);
    total += uncompressedSize;
    if (total > LIMITS.totalBytes) throw new ArtifactError(`the site unpacks to more than ${LIMITS.totalBytes} bytes`);
    files.add(path);
    // The artifact's own _headers is never written: stageZip puts main's copy there.
    if (path !== "_headers") entries.push({ path, method, crc, compressedSize, uncompressedSize, localOffset });
  }
  for (const file of files) if (dirs.has(file)) throw new ArtifactError(`"${file}" is both a file and a directory`);
  for (const file of REQUIRED) if (!files.has(file)) throw new ArtifactError(`${file} is missing`);
  return entries;
}

/** Returns one entry's bytes, checking its local header, size and CRC-32. */
export function readEntry(zip, entry) {
  const at = entry.localOffset;
  if (at + 30 > zip.length || zip.readUInt32LE(at) !== LOCAL) {
    throw new ArtifactError(`"${entry.path}" has no local header`);
  }
  const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
  if (start + entry.compressedSize > zip.length) throw new ArtifactError(`"${entry.path}" runs past the zip`);
  const raw = zip.subarray(start, start + entry.compressedSize);
  let data;
  try {
    data = entry.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
  } catch (error) {
    throw new ArtifactError(`"${entry.path}" does not inflate: ${error.message}`);
  }
  if (data.length !== entry.uncompressedSize) throw new ArtifactError(`"${entry.path}" is not the size it claims`);
  if (crc32(data) !== entry.crc) throw new ArtifactError(`"${entry.path}" fails its CRC-32`);
  return data;
}

/**
 * Checks the zip, then writes it into `distDir`, which must not exist yet, with `headersFile` as `distDir/_headers`
 * in place of the artifact's own. Nothing is written unless every entry passes. Returns the number of files written.
 */
export function stageZip(zip, distDir, headersFile) {
  const entries = readEntries(zip);
  const contents = entries.map((entry) => readEntry(zip, entry));
  const root = resolve(distDir);
  if (existsSync(root)) throw new ArtifactError(`${distDir} already exists`);
  entries.forEach((entry, i) => {
    const target = resolve(root, ...entry.path.split("/"));
    // checkName already rules out escaping names; this keeps the rule next to the write.
    if (relative(root, target).split(sep).includes("..")) throw new ArtifactError(`"${entry.path}" leaves dist/`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents[i], { flag: "wx", mode: 0o644 });
  });
  copyFileSync(headersFile, join(root, "_headers"));
  return entries.length + 1;
}

/** Finds the one zip in the download directory and stages it. */
export function stageDownload(downloadDir, distDir, headersFile) {
  const names = readdirSync(downloadDir);
  if (names.length !== 1) throw new ArtifactError(`expected one file in the download, found ${names.length}`);
  const zipPath = join(downloadDir, names[0]);
  if (!lstatSync(zipPath).isFile()) throw new ArtifactError(`${names[0]} is not a plain file`);
  return stageZip(readFileSync(zipPath), distDir, headersFile);
}

function main() {
  const [downloadDir, distDir, headersFile] = process.argv.slice(2);
  if (!downloadDir || !distDir || !headersFile) {
    console.error("Usage: node scripts/stage-dist.mjs <download directory> <dist directory> <_headers file>");
    process.exit(2);
  }
  try {
    const count = stageDownload(downloadDir, distDir, headersFile);
    console.log(`Staged ${count} files into ${distDir}, with main's _headers.`);
  } catch (error) {
    if (!(error instanceof ArtifactError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
