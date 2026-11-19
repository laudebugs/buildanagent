// Downloads the book's upstream font files from google/fonts at the commit fonts/sources.json records, into
// fonts/upstream/<family>/, and checks each file's SHA-256 against the manifest. The downloads are data for
// scripts/subset-fonts.py: nothing here runs them, and fonts/upstream/ is gitignored, so the repository ships only the
// subsets and the licence files in public/fonts/.
//
//   node scripts/fetch-fonts.mjs            download and verify every file
//   node scripts/fetch-fonts.mjs --record   download and write each file's SHA-256 into the manifest (after a re-pin)
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const app = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

// Every file each family needs, relative to ofl/ in google/fonts. OFL.txt travels with the subsets, and Google Sans
// Code's TRADEMARKS.md sets the rules for naming them.
const FILES = [
  "instrumentserif/InstrumentSerif-Regular.ttf",
  "instrumentserif/InstrumentSerif-Italic.ttf",
  "instrumentserif/OFL.txt",
  "literata/Literata[opsz,wght].ttf",
  "literata/Literata-Italic[opsz,wght].ttf",
  "literata/OFL.txt",
  "googlesanscode/GoogleSansCode[wght].ttf",
  "googlesanscode/GoogleSansCode-Italic[wght].ttf",
  "googlesanscode/OFL.txt",
  "googlesanscode/TRADEMARKS.md",
];

async function download(commit, path) {
  const url = `https://raw.githubusercontent.com/google/fonts/${commit}/ofl/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const record = process.argv.includes("--record");
const manifestPath = app("fonts/sources.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const known = new Map(manifest.files.map((file) => [file.path, file.sha256]));
const files = [];
for (const path of FILES) {
  const bytes = await download(manifest.commit, path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!record && known.get(path) !== sha256) {
    throw new Error(`${path}: SHA-256 ${sha256} differs from the manifest's ${known.get(path) ?? "(missing)"}`);
  }
  const target = app(`fonts/upstream/${path}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  files.push({ path, bytes: bytes.length, sha256 });
  console.log(`${path}  ${bytes.length} bytes  ${sha256}`);
}
if (record) await writeFile(manifestPath, `${JSON.stringify({ ...manifest, files }, null, 2)}\n`);
