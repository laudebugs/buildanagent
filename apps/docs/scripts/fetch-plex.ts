// Re-fetches the IBM Plex Sans files the docs serve and checks them against fonts/ibm-plex-sans.json, or, given a
// version, rewrites the pin for that release. It treats the package as data: it runs `npm pack`, which runs no
// package script, then reads the tarball in memory and refuses it unless every entry is a regular file with a safe
// name, the fonts are WOFF2 and the licence is plain text (scripts/plex-release.ts). The new pin takes the source
// commit and tarball address from the registry, and the unicode range and copyright from the tarball. Nothing is
// written before every check has passed, and then the folder and the pin are each replaced whole. Run it from apps/docs:
//   pnpm fonts:plex          check the tarball against the pin's integrity and restore the pinned files
//   pnpm fonts:plex 1.2.0    pin release 1.2.0, which must be at least a week old, and rewrite the files
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLEX_FONTS_URL, PLEX_PIN_URL, readPlexPin } from "../src/design/theme.js";
import {
  checkPublished,
  checkVersion,
  nextPin,
  parseView,
  readTarball,
  replaceFolder,
  takePlexFiles,
  writeFileAtomic,
} from "./plex-release.js";

const pin = readPlexPin();
const args = process.argv.slice(2);
if (args.length > 1) throw new Error("give at most one argument, a release version such as 1.2.0");
const version = args[0] ?? pin.version;
checkVersion(version);

// An allowlisted environment, so nothing but the network settings reaches npm.
const network = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
];
const home = mkdtempSync(join(tmpdir(), "plex-home-"));
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "",
  HOME: home,
  LANG: "C",
  ...Object.fromEntries(
    network.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]),
  ),
};
const work = mkdtempSync(join(tmpdir(), "plex-pack-"));
// npm runs in the empty work folder, so no project .npmrc reaches either command.
const npm = (args: readonly string[]): string => execFileSync("npm", args, { cwd: work, env, encoding: "utf8" });
try {
  const spec = `${pin.package}@${version}`;
  let viewed: string;
  try {
    viewed = npm(["view", spec, "dist.integrity", "dist.tarball", "gitHead", "time", "--json"]);
  } catch (error) {
    // npm exits non-zero on a missing release and prints `{ "error": … }`, which parseView turns into a plain error.
    viewed = String((error as { stdout?: unknown }).stdout ?? "");
  }
  const view = parseView(viewed, spec);
  const published = checkPublished(view.time[version], new Date());
  const packed = npm(["pack", spec, "--ignore-scripts", "--silent"]).trim();
  if (packed !== basename(packed)) throw new Error(`npm pack named an unexpected file: ${packed}`);
  const tarball = readFileSync(join(work, packed));
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  if (integrity !== view.integrity) {
    throw new Error(`the tarball's integrity ${integrity} is not the registry's ${view.integrity}`);
  }
  if (version === pin.version && integrity !== pin.integrity) {
    throw new Error("the tarball differs from the pin's integrity");
  }
  const files = readTarball(tarball);
  const release = takePlexFiles(
    files,
    pin.folder,
    pin.files.map((file) => file.name),
    pin.licenseFile.from,
  );
  const next = nextPin(pin, {
    version,
    view,
    integrity,
    published,
    today: new Date().toISOString().slice(0, 10),
    files,
    release,
  });
  // The folder is swapped in whole, keeping its SOURCE.md, and the pin follows it, so a failed write leaves the old
  // release in both.
  replaceFolder(
    fileURLToPath(PLEX_FONTS_URL).replace(/\/$/, ""),
    [...release.fonts, { name: pin.licenseFile.name, data: release.licence }],
    ["SOURCE.md"],
  );
  writeFileAtomic(fileURLToPath(PLEX_PIN_URL), `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${spec}, published ${next.published}, integrity ${integrity}`);
  for (const file of next.files) console.log(`${file.sha256}  ${file.name} (${file.bytes} bytes)`);
  console.log(`${next.licenseFile.sha256}  ${next.licenseFile.name}`);
  console.log(
    "If the pin changed: read the new licence, update SOURCE.md, the README and THIRD-PARTY-NOTICES.md, and run the tokens script, since the unicode range may have changed.",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
