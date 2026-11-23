// The last step of the book's build, after `astro build` and Pagefind (ADR 0059). It lists every file of the built
// site with its size and SHA-256, writes that list as dist/offline-manifest.json, and bundles the service worker
// (src/offline/sw.ts and worker.ts) into dist/sw.js with the list stamped above it. The worker stores only files on the
// list, with exactly those bytes, so a cache never mixes builds; and because the list changes whenever any file
// changes, so do the worker's bytes, which is what makes a browser install the new build's worker.
//
// The application shell, which the worker saves when it installs, is the home page, the offline page and the search
// page, with every same-origin stylesheet, script, icon and manifest they link, every font the stylesheets name, and
// the Pagefind files a search needs.
//
// Every page carries <meta name="manual-build" content="__MANUAL_BUILD__">; this step writes the build id into it, so
// the worker can still recognise one of its pages after a CDN rewrote a few of its bytes.
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

// Pagefind's files the search page needs to answer any query: its module, web worker, WebAssembly, entry and meta
// files, and the index chunks and result fragments. The shell holds them so search works offline from the first visit;
// Pagefind's other UI bundles, which no page loads, stay out.
const PAGEFIND_SHELL = [
  /^\/pagefind\/pagefind\.js$/,
  /^\/pagefind\/pagefind-worker\.js$/,
  /^\/pagefind\/pagefind-entry\.json$/,
  /^\/pagefind\/[^/]+\.pf_meta$/,
  /^\/pagefind\/wasm\.[^/]+\.pagefind$/,
  /^\/pagefind\/index\/[^/]+\.pf_index$/,
  /^\/pagefind\/fragment\/[^/]+\.pf_fragment$/,
];

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

/** Bumped when the worker's rules change in a way that must not trust caches an earlier worker filled. */
export const FORMAT_VERSION = 2;

/** The placeholder every page's <meta name="manual-build"> carries until this step writes the build id into it. */
export const BUILD_PLACEHOLDER = "__MANUAL_BUILD__";
const MARK = /<meta name="manual-build" content="([^"]*)">/g;

/**
 * The build's id: the first 16 hex digits of a SHA-256 over the format version, the worker's code, every listed
 * file's URL, size and hash, taken while the pages still carry the placeholder, and the shell's URLs. A deploy that changes only the worker
 * therefore gets a new id and a new cache, so a fixed worker never trusts entries an older one stored.
 */
export function buildId(files, workerCode = "", shell = []) {
  const hash = createHash("sha256");
  hash.update(`format ${FORMAT_VERSION}\n`);
  hash.update(createHash("sha256").update(workerCode).digest("hex")).update("\n");
  for (const file of files) hash.update(`${file.url} ${file.size} ${file.sha256}\n`);
  for (const url of shell) hash.update(`shell ${url}\n`);
  return hash.digest("hex").slice(0, 16);
}

// Writes `value` into every page's build mark. Each page must hold exactly one mark, so a page the layout did not
// render, or one with a second mark, fails the build.
// The excluded 404.html is stamped too, so no served page carries the placeholder; it never affects the id, because
// the id is taken over the listed files.
function stampPages(dist, value) {
  const root = resolve(dist);
  const pages = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
  for (const page of pages) {
    const path = join(root, page);
    const html = readFileSync(path, "utf8");
    const marks = [...html.matchAll(MARK)];
    if (marks.length !== 1) throw new Error(`${page} holds ${marks.length} build marks, not one`);
    writeFileSync(path, html.replace(MARK, `<meta name="manual-build" content="${value}">`));
  }
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
  for (const file of files) if (PAGEFIND_SHELL.some((pattern) => pattern.test(file.url))) add(file.url, "Pagefind");
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

/** Bundles the worker's code, without the build's list, as one classic script. */
async function bundleWorker() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/offline/sw.ts", import.meta.url))],
    write: false,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    charset: "utf8",
    legalComments: "none",
    logLevel: "warning",
  });
  return result.outputFiles[0].text;
}

/**
 * Writes the build id into every page, then dist/offline-manifest.json and dist/sw.js; returns the manifest. Running
 * it again on the same dist/ gives the same id and the same files.
 */
export async function writeOffline(dist) {
  const code = await bundleWorker();
  stampPages(dist, BUILD_PLACEHOLDER);
  const unstamped = listFiles(dist);
  const id = buildId(unstamped, code, shellUrls(dist, unstamped));
  stampPages(dist, id);
  const files = listFiles(dist);
  const shell = shellUrls(dist, files);
  const manifest = {
    version: FORMAT_VERSION,
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
    files: Object.fromEntries(
      files.map((file) => [
        file.url,
        file.path.endsWith(".html")
          ? { size: file.size, sha256: file.sha256, html: true }
          : { size: file.size, sha256: file.sha256 },
      ]),
    ),
  };
  // A classic script's top-level const is visible inside the bundle's function, so the list needs no import.
  const banner = `// The book's service worker for build ${id}, generated by scripts/offline-build.mjs (ADR 0059).\nconst __MANUAL_OFFLINE__ = ${JSON.stringify(stamped)};\n`;
  writeFileSync(join(dist, "sw.js"), banner + code);
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
  const shell = new Set(manifest.shell);
  const shellKb = Math.round(
    manifest.files.filter((file) => shell.has(file.url)).reduce((sum, f) => sum + f.size, 0) / 1024,
  );
  console.log(
    `Offline: build ${manifest.build}, ${manifest.files.length} files (${kb} KiB), a shell of ${manifest.shell.length} ` +
      `(${shellKb} KiB).`,
  );
}
