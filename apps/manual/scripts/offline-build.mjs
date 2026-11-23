// The last step of the book's build, after `astro build` and Pagefind (ADR 0059). It lists every file of the built
// site with its size and SHA-256, writes that list as dist/offline-manifest.json, and bundles the service worker
// (src/offline/sw.ts and worker.ts) into dist/sw.js with the list stamped above it. The worker stores only files on the
// list, with exactly those bytes, so a cache never mixes builds; and because the list changes whenever any file
// changes, so do the worker's bytes, which is what makes a browser install the new build's worker.
//
// The application shell, which the worker saves when it installs, is the home page, the offline page and the search
// page, with every same-origin stylesheet, script, icon and manifest they link and every font the stylesheets name.
//
// Usage: node scripts/offline-build.mjs <dist directory>
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** Files the list leaves out, each with the reason; every other file of dist/ is listed. */
export const EXCLUDED = new Map([
  ["_headers", "Cloudflare reads it and never serves it"],
  ["sw.js", "the worker script must always come from the network"],
  ["offline-manifest.json", "the list itself, which changes with every build"],
  ["404.html", "a page that is not found is never saved as a page that is"],
]);

/** The pages of the application shell, which the worker saves when it installs. */
export const SHELL_PAGES = ["/", "/offline/", "/search/"];

/** Returns the URL path a file is served at: a directory's index.html is served at the directory, with a slash. */
export function urlFor(path) {
  const posix = path.split(sep).join("/");
  if (posix === "index.html") return "/";
  if (posix.endsWith("/index.html")) return `/${posix.slice(0, -"index.html".length)}`;
  return `/${posix}`;
}

/** Lists every file of dist/ but the excluded ones, sorted by URL, each as { url, path, size, sha256 }. */
export function listFiles(dist) {
  const root = resolve(dist);
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !EXCLUDED.has(path))
    .map((path) => {
      const bytes = readFileSync(join(root, path));
      return { url: urlFor(path), path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    })
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** The build's id: the first 16 hex digits of a SHA-256 over every listed file's URL, size and hash. */
export function buildId(files) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file.url} ${file.size} ${file.sha256}\n`);
  return hash.digest("hex").slice(0, 16);
}

// Same-origin paths a page links with <link href> or <script src>, and fonts a stylesheet names with url().
const linked = (html) =>
  [...html.matchAll(/<(?:link|script)\b[^>]*\s(?:href|src)="(\/[^"/][^"]*)"/g)].map((match) => match[1]);
const fontsIn = (css) => [...css.matchAll(/url\(\s*["']?(\/fonts\/[^"')]+)["']?\s*\)/g)].map((match) => match[1]);

/** Returns the shell's URL paths, in a stable order. Throws if the shell links a file the list lacks. */
export function shellUrls(dist, files) {
  const byUrl = new Map(files.map((file) => [file.url, file]));
  const shell = new Set();
  const add = (url, from) => {
    const path = url.split(/[?#]/)[0];
    if (!byUrl.has(path)) throw new Error(`${from} links ${path}, which is not a listed file of the build`);
    shell.add(path);
  };
  for (const page of SHELL_PAGES) {
    add(page, "the shell");
    const html = readFileSync(join(dist, byUrl.get(page).path), "utf8");
    for (const url of linked(html)) {
      add(url, page);
      if (url.endsWith(".css")) for (const font of fontsIn(readFileSync(join(dist, url), "utf8"))) add(font, url);
      if (url.endsWith(".webmanifest")) {
        for (const icon of JSON.parse(readFileSync(join(dist, url), "utf8")).icons ?? []) add(icon.src, url);
      }
    }
  }
  return [...shell].sort();
}

/** Writes dist/offline-manifest.json and dist/sw.js; returns the manifest. */
export async function writeOffline(dist) {
  const files = listFiles(dist);
  const id = buildId(files);
  const shell = shellUrls(dist, files);
  const manifest = {
    version: 1,
    build: id,
    total: { files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) },
    shell,
    excluded: [...EXCLUDED.keys()],
    files,
  };
  writeFileSync(join(dist, "offline-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const stamped = {
    build: id,
    shell,
    files: Object.fromEntries(files.map((file) => [file.url, { size: file.size, sha256: file.sha256 }])),
  };
  await build({
    entryPoints: [fileURLToPath(new URL("../src/offline/sw.ts", import.meta.url))],
    outfile: join(dist, "sw.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    charset: "utf8",
    legalComments: "none",
    logLevel: "warning",
    // A classic script's top-level const is visible inside the bundle's function, so the list needs no import.
    banner: {
      js: `// The book's service worker for build ${id}, generated by scripts/offline-build.mjs (ADR 0059).\nconst __MANUAL_OFFLINE__ = ${JSON.stringify(stamped)};`,
    },
  });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2];
  if (!dist || process.argv.length > 3) {
    console.error("Usage: node scripts/offline-build.mjs <dist directory>");
    process.exit(2);
  }
  const manifest = await writeOffline(dist);
  const kb = Math.round(manifest.total.bytes / 1024);
  console.log(
    `Offline: build ${manifest.build}, ${manifest.files.length} files (${kb} KiB), a shell of ${manifest.shell.length}.`,
  );
}
