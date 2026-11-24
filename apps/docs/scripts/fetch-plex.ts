// Re-fetches the IBM Plex Sans files the docs serve and checks them against fonts/ibm-plex-sans.json, or, given a
// version, rewrites the pin for that release. It treats the package as data: it runs `npm pack`, which runs no
// package script, then reads the tarball in memory and refuses it unless every entry is a regular file with a safe
// name, the fonts are WOFF2 and the licence is plain text (scripts/plex-release.ts). Nothing is written before every
// check has passed. Run it from apps/docs:
//   pnpm fonts:plex          check the tarball against the pin's integrity and restore the pinned files
//   pnpm fonts:plex 1.2.0    pin release 1.2.0, which must be at least a week old, and rewrite the files
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLEX_FONTS_URL, PLEX_PIN_URL, type PlexPin, readPlexPin } from "../src/design/theme.js";
import { checkPublished, checkVersion, readTarball, takePlexFiles } from "./plex-release.js";

const pin = readPlexPin();
const args = process.argv.slice(2);
if (args.length > 1) throw new Error("give at most one argument, a release version such as 1.2.0");
const version = args[0] ?? pin.version;
checkVersion(version);
const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

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
try {
  const spec = `${pin.package}@${version}`;
  const meta = JSON.parse(
    execFileSync("npm", ["view", spec, "dist.integrity", "time", "--json"], { env, encoding: "utf8" }),
  ) as {
    "dist.integrity"?: string;
    time?: Record<string, string>;
  };
  const published = checkPublished(meta.time?.[version], new Date());
  const packed = execFileSync("npm", ["pack", spec, "--ignore-scripts", "--silent"], {
    cwd: work,
    env,
    encoding: "utf8",
  }).trim();
  if (packed !== basename(packed)) throw new Error(`npm pack named an unexpected file: ${packed}`);
  const tarball = readFileSync(join(work, packed));
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  if (integrity !== meta["dist.integrity"]) {
    throw new Error(`the tarball's integrity ${integrity} is not the registry's ${meta["dist.integrity"]}`);
  }
  if (version === pin.version && integrity !== pin.integrity) {
    throw new Error("the tarball differs from the pin's integrity");
  }
  const release = takePlexFiles(
    readTarball(tarball),
    pin.folder,
    pin.files.map((file) => file.name),
    pin.licenseFile.from,
  );
  const next: PlexPin = {
    ...pin,
    version,
    integrity,
    published,
    pinned: version === pin.version ? pin.pinned : new Date().toISOString().slice(0, 10),
    registry: pin.registry.replace(/plex-sans-[^/]+\.tgz$/, `plex-sans-${version}.tgz`),
    licenseFile: { ...pin.licenseFile, sha256: sha256(release.licence) },
    files: pin.files.map((file, index) => {
      const data = release.fonts[index]?.data ?? Buffer.alloc(0);
      return { ...file, bytes: data.length, sha256: sha256(data) };
    }),
  };
  const target = fileURLToPath(PLEX_FONTS_URL);
  mkdirSync(target, { recursive: true });
  const write = (name: string, data: Buffer): void => {
    // Removed first, so a link left in the folder is replaced rather than written through.
    rmSync(join(target, name), { force: true });
    writeFileSync(join(target, name), data, { mode: 0o644, flag: "wx" });
  };
  for (const font of release.fonts) write(font.name, font.data);
  write(pin.licenseFile.name, release.licence);
  writeFileSync(PLEX_PIN_URL, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${spec}, published ${next.published}, integrity ${integrity}`);
  for (const file of next.files) console.log(`${file.sha256}  ${file.name} (${file.bytes} bytes)`);
  console.log(`${next.licenseFile.sha256}  ${next.licenseFile.name}`);
  console.log(
    "Update SOURCE.md, the README and THIRD-PARTY-NOTICES.md if the pin changed, and read the new licence file.",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
