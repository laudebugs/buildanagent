// Tests for stage-dist.mjs: every rule that refuses an artifact, on zips written here, and a clean artifact staged
// with main's _headers. Run with `node --test scripts/*.test.mjs` from apps/manual, as its `test` script does.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { ArtifactError, LIMITS, readEntries, stageDownload, stageZip } from "./stage-dist.mjs";

const work = mkdtempSync(join(tmpdir(), "stage-dist-"));
after(() => rmSync(work, { recursive: true, force: true }));

/**
 * Writes a zip the way Unix archivers do. Each entry is { name, data?, mode?, method?, madeBy?, flags?, size? };
 * `size` overrides the recorded size, to write an entry that lies about it.
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data ?? "");
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(data) : data;
    const size = entry.size ?? data.length;
    const mode = entry.mode ?? (entry.name.endsWith("/") ? 0o040755 : 0o100644);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(((entry.madeBy ?? 3) << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const SITE = [
  { name: "index.html", data: "<!doctype html><title>Book</title>" },
  { name: "404.html", data: "<!doctype html><title>Not found</title>" },
  { name: "_astro/", data: "" },
  { name: "_astro/page.abc123.css", data: "body{}" },
  { name: "pagefind/pagefind.js", data: "export {}", method: 0 },
  { name: "_headers", data: "/*\n  X-From-The-Pull-Request: yes\n" },
];

const MAIN_HEADERS = join(work, "main-headers");
writeFileSync(MAIN_HEADERS, "/*\n  X-Content-Type-Options: nosniff\n");

let n = 0;
const freshDir = () => join(work, `dist-${n++}`);

function refuses(entries, pattern) {
  const dist = freshDir();
  assert.throws(
    () => stageZip(zip(entries), dist, MAIN_HEADERS),
    (error) => {
      assert.ok(error instanceof ArtifactError, String(error));
      assert.match(error.message, pattern);
      return true;
    },
  );
  assert.equal(existsSync(dist), false, "a refused artifact writes nothing");
}

test("a clean artifact unpacks byte for byte, with main's _headers in place of its own", () => {
  const dist = freshDir();
  assert.equal(stageZip(zip(SITE), dist, MAIN_HEADERS), 5);
  assert.equal(readFileSync(join(dist, "index.html"), "utf8"), "<!doctype html><title>Book</title>");
  assert.equal(readFileSync(join(dist, "_astro/page.abc123.css"), "utf8"), "body{}");
  assert.equal(readFileSync(join(dist, "pagefind/pagefind.js"), "utf8"), "export {}");
  assert.equal(readFileSync(join(dist, "_headers"), "utf8"), readFileSync(MAIN_HEADERS, "utf8"));
});

test("an artifact without its own _headers still gets main's", () => {
  const dist = freshDir();
  stageZip(zip(SITE.filter((entry) => entry.name !== "_headers")), dist, MAIN_HEADERS);
  assert.equal(readFileSync(join(dist, "_headers"), "utf8"), readFileSync(MAIN_HEADERS, "utf8"));
});

test("names that leave dist/ or are not plain paths are refused", () => {
  for (const name of ["../escape.html", "/etc/passwd", "a/../../b.html", "a\\b.html", "a//b.html", "./a.html"]) {
    refuses([...SITE, { name, data: "x" }], /absolute|backslash|plain path|dot/);
  }
});

test("dot files, such as .assetsignore, are refused at any depth", () => {
  refuses([...SITE, { name: ".assetsignore", data: "*" }], /starts with a dot/);
  refuses([...SITE, { name: "fonts/.hidden/x.woff2", data: "x" }], /starts with a dot/);
});

test("symbolic links and other special files are refused", () => {
  refuses([...SITE, { name: "link.html", data: "/etc/passwd", mode: 0o120777 }], /symbolic link/);
  refuses([...SITE, { name: "fifo", data: "", mode: 0o010644 }], /symbolic link or another special file/);
});

test("files the asset server may read as configuration are refused", () => {
  for (const name of ["_redirects", "_routes.json", "_worker.js", "_worker.js/index.js", "_anything.html"]) {
    refuses([...SITE, { name, data: "x" }], /configuration/);
  }
});

test("encrypted entries, other compression methods and broken data are refused", () => {
  refuses([...SITE, { name: "a.html", data: "x", flags: 1 }], /encrypted/);
  refuses([...SITE, { name: "a.html", data: "x", method: 12 }], /compression method 12/);
  refuses([...SITE, { name: "a.html", data: "abc", method: 0, size: 2 }], /not the size it claims/);
  // Changing a stored entry's bytes after the fact leaves its recorded CRC-32 wrong.
  const stored = zip(SITE);
  stored.write("EXPORT", stored.indexOf("export {}"));
  assert.throws(() => stageZip(stored, freshDir(), MAIN_HEADERS), /fails its CRC-32/);
});

test("a repeated name, or a file used as a directory, is refused", () => {
  refuses([...SITE, { name: "index.html", data: "again" }], /appears twice/);
  refuses([...SITE, { name: "index.html/inner.html", data: "x" }], /under the file|both a file and a directory/);
});

test("an artifact without index.html or 404.html is refused", () => {
  refuses(
    SITE.filter((entry) => entry.name !== "404.html"),
    /404\.html is missing/,
  );
  refuses(
    SITE.filter((entry) => entry.name !== "index.html"),
    /index\.html is missing/,
  );
});

test("a file over 25 MiB, too many files or too many bytes are refused", () => {
  refuses([...SITE, { name: "big.bin", data: "x", method: 0, size: LIMITS.fileBytes + 1 }], /bytes/);
  const many = Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ name: `f/${i}.txt`, data: "", method: 0 }));
  assert.throws(() => readEntries(zip(many)), /entries, over 20000/);
  const heavy = Array.from({ length: 5 }, (_, i) => ({
    name: `h/${i}.bin`,
    data: "x",
    method: 0,
    size: LIMITS.fileBytes,
  }));
  assert.throws(() => readEntries(zip([...SITE, ...heavy])), /more than/);
});

test("anything but a zip is refused", () => {
  assert.throws(() => readEntries(Buffer.from("not a zip at all, just text")), /not a zip file/);
});

test("the download directory must hold exactly one plain file", () => {
  const empty = join(work, "empty");
  mkdirSync(empty);
  assert.throws(() => stageDownload(empty, freshDir(), MAIN_HEADERS), /expected one file/);
  const linked = join(work, "linked");
  mkdirSync(linked);
  writeFileSync(join(work, "real.zip"), zip(SITE));
  symlinkSync(join(work, "real.zip"), join(linked, "book-dist.zip"));
  assert.throws(() => stageDownload(linked, freshDir(), MAIN_HEADERS), /not a plain file/);
  const good = join(work, "good");
  mkdirSync(good);
  writeFileSync(join(good, "book-dist.zip"), zip(SITE));
  assert.equal(stageDownload(good, freshDir(), MAIN_HEADERS), 5);
});

test("an existing dist/ is never written into", () => {
  const dist = freshDir();
  mkdirSync(dist);
  assert.throws(() => stageZip(zip(SITE), dist, MAIN_HEADERS), /already exists/);
});
