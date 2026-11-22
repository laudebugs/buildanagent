// Checks the artifact that docs-build.yml or site-build.yml uploaded and unpacks it into the app's dist/ for the
// deploy workflow (publish-and-docs DS3). The artifact may come from a fork, so nothing in it is trusted.
//
// The zip checks are the book's, from apps/manual/scripts/stage-dist.mjs: the workflow downloads the artifact
// unextracted, and that module reads the zip itself and refuses the whole artifact, before anything is written, for
// an unsafe name, a link or special file, an entry Cloudflare's asset server reads as configuration (`_redirects`,
// `_routes.json`, `_worker.js`, a dot file such as `.assetsignore`), a broken or oversized entry, or a missing
// required page. The two sites differ from the book only in their required pages and their `_headers`.
//
// The artifact's own `_headers` is never written. In its place goes main's `public/_headers` when the app has one,
// and nothing when it has none, as neither site does today. With --noindex, for a preview or for
// next.docs.buildanagent.fyi, the file also sets `X-Robots-Tag: noindex` on every path. Cloudflare already adds that
// header to workers.dev preview URLs, but not to a custom domain such as next.docs.buildanagent.fyi.
//
// Usage: node scripts/ci/site-stage-dist.mjs <docs|site> <download directory> [--noindex]. The download directory
// must hold exactly one file, the zip that actions/download-artifact saved with skip-decompress. The files go to
// apps/<app>/dist, which must not exist yet.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArtifactError,
  PREVIEW_HEADER,
  previewHeaders,
  readEntries,
  readEntry,
} from "../../apps/manual/scripts/stage-dist.mjs";

export { ArtifactError };

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The two sites. `domain` is production's custom domain, `next` the docs' domain for main once a release exists,
 * `worker` the Worker's name, which a workers.dev preview URL carries, and `required` the pages a build must hold.
 * apps/site has no 404 page yet, so it requires only its landing page.
 */
export const SITES = {
  docs: {
    app: "apps/docs",
    worker: "buildanagent-docs",
    domain: "docs.buildanagent.fyi",
    next: "next.docs.buildanagent.fyi",
    required: ["index.html", "404.html"],
  },
  site: {
    app: "apps/site",
    worker: "buildanagent-site",
    domain: "buildanagent.fyi",
    required: ["index.html"],
  },
};

/** The `_headers` a site with no `public/_headers` gets for a preview or for next.docs. */
export const NOINDEX_HEADERS = `/*\n  ${PREVIEW_HEADER}\n`;

/** Returns the site's entry from SITES, or throws for any other name. */
export function siteOf(name) {
  if (!Object.hasOwn(SITES, name)) throw new Error(`unknown site "${name}"; expected docs or site`);
  return SITES[name];
}

/**
 * Returns the `_headers` text to deploy, or null for none: main's `public/_headers` as it is, or with
 * PREVIEW_HEADER added to its one `/*` rule when `noindex` is true. With no `public/_headers`, a noindex deploy gets
 * NOINDEX_HEADERS and any other gets no file.
 */
export function headersFor(appDir, { noindex = false } = {}) {
  const source = join(appDir, "public", "_headers");
  const text = existsSync(source) ? readFileSync(source, "utf8") : null;
  if (!noindex) return text;
  return text === null ? NOINDEX_HEADERS : previewHeaders(text);
}

/**
 * Checks the zip, then writes it into `distDir`, which must not exist yet, followed by `headers` as
 * `distDir/_headers` unless it is null. Nothing is written unless every entry passes. Returns the files written.
 */
export function stageSiteZip(zip, distDir, { required, headers }) {
  const entries = readEntries(zip, { required });
  const contents = entries.map((entry) => readEntry(zip, entry));
  const root = resolve(distDir);
  if (existsSync(root)) throw new ArtifactError(`${distDir} already exists`);
  entries.forEach((entry, i) => {
    const target = resolve(root, ...entry.path.split("/"));
    // readEntries already rules out escaping names; this keeps the rule next to the write.
    if (relative(root, target).split(sep).includes("..")) throw new ArtifactError(`"${entry.path}" leaves dist/`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents[i], { flag: "wx", mode: 0o644 });
  });
  if (headers === null) return entries.length;
  writeFileSync(join(root, "_headers"), headers, { flag: "wx", mode: 0o644 });
  return entries.length + 1;
}

/** Finds the one zip in the download directory and stages it into the site's dist/ under `root`. */
export function stageSite(name, downloadDir, { noindex = false, root = ROOT } = {}) {
  const site = siteOf(name);
  const appDir = join(root, site.app);
  const names = readdirSync(downloadDir);
  if (names.length !== 1) throw new ArtifactError(`expected one file in the download, found ${names.length}`);
  const zipPath = join(downloadDir, names[0]);
  if (!lstatSync(zipPath).isFile()) throw new ArtifactError(`${names[0]} is not a plain file`);
  const headers = headersFor(appDir, { noindex });
  return stageSiteZip(readFileSync(zipPath), join(appDir, "dist"), { required: site.required, headers });
}

function main() {
  const args = process.argv.slice(2);
  const noindex = args.at(-1) === "--noindex";
  const [name, downloadDir, ...rest] = noindex ? args.slice(0, -1) : args;
  if (!name || !downloadDir || rest.length > 0 || !Object.hasOwn(SITES, name)) {
    console.error("Usage: node scripts/ci/site-stage-dist.mjs <docs|site> <download directory> [--noindex]");
    process.exit(2);
  }
  try {
    const count = stageSite(name, downloadDir, { noindex });
    console.log(`Staged ${count} files into ${SITES[name].app}/dist${noindex ? `, with ${PREVIEW_HEADER}` : ""}.`);
  } catch (error) {
    if (!(error instanceof ArtifactError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
