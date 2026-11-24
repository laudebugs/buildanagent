import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, test } from "vitest";
import {
  checkEntryName,
  checkPublished,
  checkVersion,
  PLEX_MIN_AGE_DAYS,
  readTarball,
  takePlexFiles,
} from "../scripts/plex-release.js";

// Tarballs are built here, in memory or in a scratch folder, so the tests need no network and no real release.
const FOLDER = "fonts/split/woff2";
const FONT = "IBMPlexSans-Regular-Latin1.woff2";
const woff2 = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(60, 1)]);
const licence = Buffer.from("Copyright © 2017 IBM Corp.\r\nSIL OPEN FONT LICENSE Version 1.1\r\n");

function field(header: Buffer, start: number, length: number, value: string): void {
  header.write(value.slice(0, length), start, length, "utf8");
}

function header(name: string, type: string, size: number, linkname = ""): Buffer {
  const block = Buffer.alloc(512);
  field(block, 0, 100, name);
  field(block, 100, 8, "0000644\0");
  field(block, 108, 8, "0000000\0");
  field(block, 116, 8, "0000000\0");
  field(block, 124, 12, `${size.toString(8).padStart(11, "0")}\0`);
  field(block, 136, 12, "00000000000\0");
  field(block, 148, 8, "        ");
  field(block, 156, 1, type);
  field(block, 157, 100, linkname);
  field(block, 257, 6, "ustar\0");
  field(block, 263, 2, "00");
  let sum = 0;
  for (const byte of block) sum += byte;
  field(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

interface Entry {
  readonly name: string;
  readonly type?: string;
  readonly data?: Buffer;
  readonly linkname?: string;
}

function tarball(entries: readonly Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0);
    blocks.push(header(entry.name, entry.type ?? "0", data.length, entry.linkname));
    blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

const good: readonly Entry[] = [
  { name: "package/package.json", data: Buffer.from("{}") },
  { name: `package/${FOLDER}/${FONT}`, data: woff2 },
  { name: "package/LICENSE.txt", data: licence },
];

const scratch: string[] = [];
afterEach(() => {
  for (const folder of scratch.splice(0)) rmSync(folder, { recursive: true, force: true });
});

// Builds a tarball with the system's tar from a scratch folder, so the links are the kind tar itself writes.
function systemTarball(build: (root: string) => void, members: readonly string[]): Buffer {
  const root = mkdtempSync(join(tmpdir(), "plex-tar-"));
  scratch.push(root);
  mkdirSync(join(root, "package", FOLDER), { recursive: true });
  build(root);
  const out = join(root, "out.tgz");
  const env = { PATH: process.env.PATH ?? "", HOME: root, TMPDIR: tmpdir(), LANG: "C" };
  execFileSync("tar", ["czf", out, "-C", root, ...members], { env });
  return readFileSync(out);
}

test("a tarball of regular files is read in memory and its fonts and licence are taken", () => {
  const files = readTarball(tarball(good));
  assert.deepEqual(
    [...files.keys()],
    good.map((entry) => entry.name),
  );
  const release = takePlexFiles(files, FOLDER, [FONT], "LICENSE.txt");
  assert.ok(release.fonts[0]?.data.equals(woff2));
  assert.ok(release.licence.equals(licence));
});

test("a PAX header's path names the entry that follows it", () => {
  const long = `package/${"a".repeat(120)}.txt`;
  const record = (key: string, value: string): string => {
    const body = ` ${key}=${value}\n`;
    let length = body.length + 1;
    while (`${length}${body}`.length !== length) length = `${length}${body}`.length;
    return `${length}${body}`;
  };
  const files = readTarball(
    tarball([
      { name: "PaxHeader", type: "x", data: Buffer.from(record("path", long)) },
      { name: "package/short", data: Buffer.from("x") },
    ]),
  );
  assert.deepEqual([...files.keys()], [long]);
});

test("a symbolic link anywhere in the tarball refuses it, here one standing in for the licence", () => {
  assert.throws(
    () =>
      readTarball(tarball([...good.slice(0, 2), { name: "package/LICENSE.txt", type: "2", linkname: "/root/.npmrc" }])),
    /"package\/LICENSE\.txt" is not a regular file \(type "2"\)/,
  );
  const fromTar = systemTarball(
    (root) => {
      writeFileSync(join(root, "package", FOLDER, FONT), woff2);
      symlinkSync("/etc/hostname", join(root, "package", "LICENSE.txt"));
    },
    [`package/${FOLDER}/${FONT}`, "package/LICENSE.txt"],
  );
  assert.throws(() => readTarball(fromTar), /"package\/LICENSE\.txt" is not a regular file \(type "2"\)/);
});

test("a hard link refuses the tarball", () => {
  assert.throws(
    () =>
      readTarball(tarball([...good, { name: `package/${FOLDER}/other.woff2`, type: "1", linkname: "/root/.ssh/id" }])),
    /is not a regular file \(type "1"\)/,
  );
  const fromTar = systemTarball(
    (root) => {
      writeFileSync(join(root, "package", FOLDER, FONT), woff2);
      linkSync(join(root, "package", FOLDER, FONT), join(root, "package", "LICENSE.txt"));
    },
    [`package/${FOLDER}/${FONT}`, "package/LICENSE.txt"],
  );
  assert.throws(() => readTarball(fromTar), /"package\/LICENSE\.txt" is not a regular file \(type "1"\)/);
});

test("a directory, a device or a FIFO entry refuses the tarball", () => {
  for (const type of ["5", "3", "4", "6"]) {
    assert.throws(() => readTarball(tarball([{ name: "package/x", type }])), /is not a regular file/);
  }
});

test("an entry name that is absolute, climbs with .., or lies outside package/ refuses the tarball", () => {
  for (const name of [
    "/etc/passwd",
    "package/../../.npmrc",
    "../package/LICENSE.txt",
    "other/LICENSE.txt",
    "package//x",
  ]) {
    assert.throws(() => readTarball(tarball([{ name, data: licence }])), /unsafe name/, name);
    assert.throws(() => checkEntryName(name), /unsafe name/, name);
  }
  assert.doesNotThrow(() => checkEntryName(`package/${FOLDER}/${FONT}`));
});

test("two entries with one name, a bad checksum or a truncated tarball refuse it", () => {
  assert.throws(() => readTarball(tarball([...good, good[2] as Entry])), /two entries named/);
  const raw = Buffer.concat([header("package/x", "0", 0), Buffer.alloc(1024)]);
  raw[0] = "q".charCodeAt(0);
  assert.throws(() => readTarball(gzipSync(raw)), /wrong checksum/);
  assert.throws(() => readTarball(gzipSync(header("package/x", "0", 4096))), /ends inside an entry/);
});

test("a font that is not WOFF2, or a licence that is not short plain text, is refused", () => {
  const withFont = (data: Buffer) =>
    readTarball(tarball([{ name: `package/${FOLDER}/${FONT}`, data }, good[2] as Entry]));
  assert.throws(
    () => takePlexFiles(withFont(Buffer.from("-----BEGIN OPENSSH PRIVATE KEY-----")), FOLDER, [FONT], "LICENSE.txt"),
    /is not a WOFF2 file/,
  );
  const withLicence = (data: Buffer) => readTarball(tarball([good[1] as Entry, { name: "package/LICENSE.txt", data }]));
  for (const data of [Buffer.from([0x00, 0x01, 0x02]), Buffer.from([0xff, 0xfe, 0x41]), Buffer.alloc(70_000, 0x41)]) {
    assert.throws(() => takePlexFiles(withLicence(data), FOLDER, [FONT], "LICENSE.txt"), /is not plain text/);
  }
  assert.throws(() => takePlexFiles(withFont(woff2), FOLDER, ["Missing.woff2"], "LICENSE.txt"), /has no package\//);
});

test("only a plain major.minor.patch version reaches npm", () => {
  for (const version of ["1.1.0", "2.0.0", "10.20.30"]) assert.doesNotThrow(() => checkVersion(version));
  for (const version of ["npm:other-pkg@1.0.0", "latest", "1.1", "1.1.0-beta.1", "^1.1.0", "1.1.0 --registry=x", ""]) {
    assert.throws(() => checkVersion(version), /is not a release version/, version);
  }
});

test("a release with no publish time, or one under a week old, is refused", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  assert.equal(PLEX_MIN_AGE_DAYS, 7);
  assert.throws(() => checkPublished(undefined, now), /no publish time/);
  assert.throws(() => checkPublished("", now), /no publish time/);
  assert.throws(() => checkPublished("2026-11-18T18:05:37Z", now), /less than 7 days ago/);
  assert.equal(checkPublished("2026-11-17T12:00:00Z", now), "2026-11-17");
  assert.equal(checkPublished("2024-11-11T14:44:52Z", now), "2024-11-11");
});
