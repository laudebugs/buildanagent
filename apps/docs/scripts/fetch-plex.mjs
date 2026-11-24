// Re-fetches the IBM Plex Sans files the docs serve and checks them against fonts/ibm-plex-sans.json, or, given a
// version, rewrites the pin for that release. It treats the package as data: it runs `npm pack`, which runs no
// package script, then reads three files and the licence out of the tarball with `tar`. Run it from apps/docs:
//   node scripts/fetch-plex.mjs            verify the files against the pin, and restore them if they differ
//   node scripts/fetch-plex.mjs 1.2.0      pin release 1.2.0 (a release at least a week old) and rewrite the files
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pinPath = fileURLToPath(new URL("../fonts/ibm-plex-sans.json", import.meta.url));
const target = fileURLToPath(new URL("../public/fonts/ibm-plex-sans/", import.meta.url));
const pin = JSON.parse(readFileSync(pinPath, "utf8"));
const version = process.argv[2] ?? pin.version;
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const env = { PATH: process.env.PATH ?? "", HOME: mkdtempSync(join(tmpdir(), "plex-home-")), LANG: "C" };
const work = mkdtempSync(join(tmpdir(), "plex-pack-"));
try {
  const spec = `${pin.package}@${version}`;
  const meta = JSON.parse(
    execFileSync("npm", ["view", spec, "dist.integrity", "time", "--json"], { env, encoding: "utf8" }),
  );
  const published = execFileSync("npm", ["view", pin.package, `time[${version}]`], { env, encoding: "utf8" }).trim();
  const tarball = execFileSync("npm", ["pack", spec, "--ignore-scripts", "--silent"], {
    cwd: work,
    env,
    encoding: "utf8",
  }).trim();
  const integrity = `sha512-${createHash("sha512")
    .update(readFileSync(join(work, tarball)))
    .digest("base64")}`;
  const advertised = typeof meta === "string" ? meta : meta["dist.integrity"];
  if (integrity !== advertised)
    throw new Error(`the tarball's integrity ${integrity} is not the registry's ${advertised}`);
  if (version === pin.version && integrity !== pin.integrity)
    throw new Error("the tarball differs from the pin's integrity");
  execFileSync("tar", ["xzf", tarball, "-C", work, "package"], { cwd: work, env });
  const next = {
    ...pin,
    version,
    integrity,
    published: published.slice(0, 10),
    registry: pin.registry.replace(/plex-sans-[^/]+\.tgz$/, `plex-sans-${version}.tgz`),
  };
  mkdirSync(target, { recursive: true });
  const source = (name) => join(work, "package", pin.folder, name);
  next.files = pin.files.map((file) => {
    const from = source(file.name);
    copyFileSync(from, join(target, file.name));
    return { ...file, bytes: statSync(from).size, sha256: sha256(from) };
  });
  const licence = join(work, "package", pin.licenseFile.from);
  copyFileSync(licence, join(target, pin.licenseFile.name));
  next.licenseFile = { ...pin.licenseFile, sha256: sha256(licence) };
  writeFileSync(pinPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${spec}, published ${next.published}, integrity ${integrity}`);
  for (const file of next.files) console.log(`${file.sha256}  ${file.name} (${file.bytes} bytes)`);
  console.log(`${next.licenseFile.sha256}  ${next.licenseFile.name}`);
  console.log(
    "Update SOURCE.md, the README and THIRD-PARTY-NOTICES.md if the pin changed, and read the new licence file.",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(env.HOME, { recursive: true, force: true });
}
