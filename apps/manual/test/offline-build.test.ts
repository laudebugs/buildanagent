import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createContext, runInContext } from "node:vm";
import { afterAll, beforeAll, test } from "vitest";
import { problemsIn } from "../scripts/guard-deploy.mjs";
import {
  BUILD_PLACEHOLDER,
  buildId,
  EXCLUDED,
  FORMAT_VERSION,
  SHELL_PAGES,
  urlFor,
  writeOffline,
} from "../scripts/offline-build.mjs";
import { checkName, LIMITS, previewHeaders } from "../scripts/stage-dist.mjs";
import { offlineHosts } from "../src/offline/hosts.js";
import {
  type OfflineBuild,
  OfflineWorker,
  BUILD_PLACEHOLDER as WORKER_PLACEHOLDER,
  withMark,
} from "../src/offline/worker.js";
import { builtBook } from "./built.js";
import { nearestBin } from "./built-book.js";
import { basic, FakeCaches, FakeNetwork } from "./offline-fakes.js";

// Takes the fixture book test/built-book.ts built once for the whole run, copies it to a temporary folder of its own
// because Pagefind and the offline step write into it, and finishes it the way `pnpm build` does, Pagefind then
// scripts/offline-build.mjs, and checks what the offline step wrote: a file list that matches dist/ byte for byte, a
// worker that carries the build's id and list, and a site the deploy scripts still accept (ADR 0059).
const app = fileURLToPath(new URL("..", import.meta.url));
let out = "";

interface Listed {
  url: string;
  path: string;
  size: number;
  sha256: string;
}
interface OfflineManifest {
  version: number;
  build: string;
  total: { files: number; bytes: number };
  shell: string[];
  excluded: string[];
  files: Listed[];
}
let manifest: OfflineManifest;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "manual-offline-"));
  cpSync(builtBook(), out, { recursive: true });
  const home = mkdtempSync(join(tmpdir(), "manual-home-"));
  // An allowlisted environment, never ...process.env (AGENTS.md), with Astro's telemetry off so the build stays offline.
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: home,
    TMPDIR: tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    ASTRO_TELEMETRY_DISABLED: "1",
  };
  await promisify(execFile)(nearestBin("pagefind"), ["--site", out], { cwd: app, env });
  await writeOffline(out);
  manifest = JSON.parse(readFileSync(join(out, "offline-manifest.json"), "utf8"));
  rmSync(home, { recursive: true, force: true });
}, 240_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

const allFiles = () =>
  readdirSync(out, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(join(out, path)).isFile())
    .map((path) => path.split("\\").join("/"));

test("a page's URL is its directory with a slash, and any other file's URL is its path", () => {
  assert.equal(urlFor("index.html"), "/");
  assert.equal(urlFor("tools/index.html"), "/tools/");
  assert.equal(urlFor("pagefind/pagefind.js"), "/pagefind/pagefind.js");
  assert.equal(urlFor("fonts/literata/OFL.txt"), "/fonts/literata/OFL.txt");
});

test("every listed file exists with the size and SHA-256 the list records, a page with the placeholder in its mark", () => {
  assert.equal(manifest.version, FORMAT_VERSION);
  for (const file of manifest.files) {
    const read = readFileSync(join(out, file.path));
    const bytes = file.path.endsWith(".html") ? Buffer.from(withMark(read, BUILD_PLACEHOLDER)) : read;
    assert.equal(bytes.length, file.size, file.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
    assert.equal(urlFor(file.path), file.url);
  }
  assert.equal(manifest.total.files, manifest.files.length);
  assert.equal(
    manifest.total.bytes,
    manifest.files.reduce((sum, file) => sum + file.size, 0),
  );
});

test("every file of dist/ is listed or excluded by name, and the list holds Pagefind's index", () => {
  const listed = new Set(manifest.files.map((file) => file.path));
  for (const path of allFiles()) {
    assert.ok(listed.has(path) !== EXCLUDED.has(path), `${path} is listed or excluded, not both or neither`);
  }
  assert.deepEqual(manifest.excluded, [...EXCLUDED.keys()]);
  for (const name of ["sw.js", "offline-manifest.json", "_headers", "404.html"]) assert.ok(!listed.has(name), name);
  for (const pattern of [
    /^pagefind\/pagefind\.js$/,
    /^pagefind\/pagefind-worker\.js$/,
    /^pagefind\/wasm\.\w+\.pagefind$/,
  ]) {
    assert.ok(
      [...listed].some((path) => pattern.test(path)),
      String(pattern),
    );
  }
  assert.ok(
    [...listed].some((path) => path.startsWith("pagefind/index/")),
    "Pagefind's index chunks",
  );
});

test("the shell is the three shell pages and the stylesheet, scripts, fonts, manifest and icons they need", () => {
  const listed = new Set(manifest.files.map((file) => file.url));
  for (const url of manifest.shell) assert.ok(listed.has(url), url);
  for (const page of SHELL_PAGES) assert.ok(manifest.shell.includes(page), page);
  for (const url of [
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/favicon.svg",
    "/scripts/theme.js",
    "/scripts/reading.js",
    "/scripts/offline.js",
    "/pagefind/pagefind-component-ui.js",
    "/fonts/literata/literata-roman.woff2",
  ]) {
    assert.ok(manifest.shell.includes(url), url);
  }
  assert.ok(
    manifest.shell.some((url) => /^\/_astro\/.+\.css$/.test(url)),
    "the stylesheet",
  );
  assert.ok(!manifest.shell.includes("/gallery/"), "a page outside the shell");
});

test("the build's id is stamped into sw.js with the whole list, and the worker never calls skipWaiting itself", () => {
  const sw = readFileSync(join(out, "sw.js"), "utf8");
  assert.match(manifest.build, /^[0-9a-f]{16}$/);
  assert.ok(sw.startsWith(`// The book's service worker for build ${manifest.build}`));
  assert.doesNotMatch(sw, /\bimport\b|importScripts/, "one classic script, with nothing to import");
  const listeners = new Map<string, (event: unknown) => void>();
  let skipped = 0;
  const scope = {
    location: new URL("https://manual.buildanagent.fyi/sw.js"),
    caches: {},
    fetch: () => Promise.reject(new Error("no network in this test")),
    skipWaiting: async () => {
      skipped++;
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  };
  const context = createContext({ self: scope, URL, Request, Response, Headers, TextEncoder, crypto, setTimeout });
  runInContext(sw, context);
  assert.deepEqual([...listeners.keys()].sort(), ["activate", "fetch", "install", "message"]);
  // A top-level const of a classic script is visible to later scripts in the same realm, as in a worker.
  const stamped = JSON.parse(runInContext("JSON.stringify(__MANUAL_OFFLINE__)", context)) as {
    build: string;
    shell: string[];
    files: Record<string, unknown>;
  };
  assert.equal(stamped.build, manifest.build);
  assert.deepEqual(stamped.shell, manifest.shell);
  assert.deepEqual(
    Object.keys(stamped.files),
    manifest.files.map((file) => file.url),
  );

  const tab = { type: "window", frameType: "top-level", url: "https://manual.buildanagent.fyi/", postMessage() {} };
  const message = (data: unknown, origin: string, source: unknown = tab) => {
    const waits: Promise<unknown>[] = [];
    listeners.get("message")?.({
      data,
      origin,
      ports: [],
      source,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    return Promise.all(waits);
  };
  return (async () => {
    await message({ type: "SKIP_WAITING" }, "https://evil.example");
    assert.equal(skipped, 0, "another origin's message is ignored");
    await message({ type: "SKIP_WAITING" }, "https://manual.buildanagent.fyi", { ...tab, frameType: "nested" });
    assert.equal(skipped, 0, "a frame's message is ignored");
    await message({ type: "SKIP_WAITING" }, "https://manual.buildanagent.fyi", null);
    assert.equal(skipped, 0, "a message with no window behind it is ignored");
    await message({ type: "SKIP_WAITING" }, "https://manual.buildanagent.fyi");
    assert.equal(skipped, 1, "the page's Reload asks the waiting worker to take over");
  })();
});

test("every page carries this build's mark once, the 404 page included, which is never listed", () => {
  for (const file of manifest.files.filter((entry) => entry.path.endsWith(".html"))) {
    const html = readFileSync(join(out, file.path), "utf8");
    assert.equal(html.split('<meta name="manual-build"').length - 1, 1, file.path);
    assert.ok(html.includes(`<meta name="manual-build" content="${manifest.build}">`), file.path);
  }
  const notFound = readFileSync(join(out, "404.html"), "utf8");
  assert.ok(notFound.includes(`<meta name="manual-build" content="${manifest.build}">`));
  assert.ok(!notFound.includes(BUILD_PLACEHOLDER), "no served page keeps the placeholder");
});

test("the id changes with the worker's code or the shell, so a worker-only deploy gets a new cache", () => {
  const files = manifest.files;
  const base = buildId(files, "worker A", manifest.shell);
  assert.notEqual(buildId(files, "worker B", manifest.shell), base);
  assert.notEqual(buildId(files, "worker A", manifest.shell.slice(1)), base);
  assert.equal(buildId(files, "worker A", manifest.shell), base);
});

test("the shell holds every Pagefind file a search needs, and none of Pagefind's unused bundles", () => {
  const pagefind = manifest.files.filter((file) => file.url.startsWith("/pagefind/")).map((file) => file.url);
  for (const url of pagefind) {
    const unused = /pagefind-(ui|modular-ui|highlight)\.(js|css)$/.test(url);
    assert.equal(manifest.shell.includes(url), !unused, url);
  }
});

test("a second build of the same files gives the same id and the same worker", async () => {
  const first = readFileSync(join(out, "sw.js"));
  const again = await writeOffline(out);
  assert.equal(again.build, manifest.build);
  assert.ok(readFileSync(join(out, "sw.js")).equals(first));
});

test("every built page links the manifest and the touch icon, sets the theme colours and loads offline.js", () => {
  for (const path of allFiles().filter((file) => file.endsWith(".html"))) {
    const html = readFileSync(join(out, path), "utf8");
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/, path);
    assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/, path);
    assert.match(html, /<meta name="theme-color" media="\(prefers-color-scheme: light\)" content="#FAF3E8">/, path);
    assert.match(html, /<meta name="theme-color" media="\(prefers-color-scheme: dark\)" content="#2A1E16">/, path);
    assert.match(html, /<script type="module" src="\/scripts\/offline\.js"><\/script>/, path);
    // The build ran without MANUAL_OFFLINE_TEST_HOST, as production does, so only the production host registers.
    assert.match(html, /<meta name="manual-offline-hosts" content="manual\.buildanagent\.fyi">/, path);
  }
});

test("the offline page says the page is not saved, links the contents and stays out of search engines and the index", () => {
  const html = readFileSync(join(out, "offline", "index.html"), "utf8");
  assert.match(html, /<h1 class="chapter-head__title">You(?:'|&#39;)re offline<\/h1>/);
  assert.match(html, /<a href="\/">contents<\/a>/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /data-pagefind-body/);
});

test("only the production host or a loopback test host can register the worker", () => {
  const site = new URL("https://manual.buildanagent.fyi");
  assert.deepEqual(offlineHosts(site, undefined), ["manual.buildanagent.fyi"]);
  assert.deepEqual(offlineHosts(site, ""), ["manual.buildanagent.fyi"]);
  assert.deepEqual(offlineHosts(site, "127.0.0.1"), ["manual.buildanagent.fyi", "127.0.0.1"]);
  for (const host of ["pr-1.manual.buildanagent.fyi", "evil.example", "0.0.0.0", "127.0.0.1 evil.example"]) {
    assert.throws(() => offlineHosts(site, host), /MANUAL_OFFLINE_TEST_HOST/, host);
  }
  assert.throws(() => offlineHosts(undefined, undefined), /site/);
});

test("the deploy scripts accept the new files unchanged: stage-dist's name and size rules and the guard's headers", () => {
  let total = 0;
  for (const path of allFiles()) {
    checkName(path);
    const size = statSync(join(out, path)).size;
    assert.ok(size <= LIMITS.fileBytes, path);
    total += size;
  }
  assert.ok(total <= LIMITS.totalBytes);
  const source = readFileSync(join(app, "public", "_headers"), "utf8");
  const config = {
    routes: [{ pattern: "manual.buildanagent.fyi", custom_domain: true, previews_enabled: true }],
    assets: { directory: "./dist", not_found_handling: "404-page" },
    workers_dev: false,
    preview_urls: false,
  };
  assert.deepEqual(problemsIn(config, { source, deployed: source }), []);
  assert.deepEqual(problemsIn(config, { source, deployed: previewHeaders(source) }, { preview: true }), []);
});

// The build stamps each page with its id, so a page's bytes differ in every build. The list hashes pages with the
// placeholder in their mark, and the worker compares them that way, so a saved page carries over to the next build
// when only its mark differs, and keeps the new build's mark once carried.
test("after a deploy that changes one stylesheet, the saved pages carry over to the new build and the old cache goes", async () => {
  const ORIGIN = "https://manual.buildanagent.fyi";
  const asBuild = (list: OfflineManifest): OfflineBuild => ({
    build: list.build,
    shell: list.shell,
    files: Object.fromEntries(
      list.files.map((file) => [
        file.url,
        file.path.endsWith(".html")
          ? { size: file.size, sha256: file.sha256, html: true }
          : { size: file.size, sha256: file.sha256 },
      ]),
    ),
  });
  const served = (dir: string, list: OfflineManifest) => {
    const byUrl = new Map(list.files.map((file) => [file.url, file.path]));
    return new FakeNetwork(
      Object.fromEntries(
        [...byUrl].map(([url, path]) => [
          url,
          () => basic(new Response(readFileSync(join(dir, path)), { status: 200 })),
        ]),
      ),
    );
  };
  // The next build: the same fixture with one stylesheet and one chapter changed.
  const next = mkdtempSync(join(tmpdir(), "manual-offline-next-"));
  try {
    cpSync(out, next, { recursive: true });
    const css = manifest.files.find((file) => /^_astro\/.+\.css$/.test(file.path));
    assert.ok(css);
    writeFileSync(join(next, css.path), `${readFileSync(join(next, css.path), "utf8")}\n/* changed */\n`);
    const chapter = join(next, "call-workflow-loop", "index.html");
    writeFileSync(chapter, readFileSync(chapter, "utf8").replace("</h1>", " (second edition)</h1>"));
    const second = (await writeOffline(next)) as OfflineManifest;
    assert.notEqual(second.build, manifest.build);
    assert.notEqual(
      readFileSync(join(next, "glossary", "index.html"), "utf8"),
      readFileSync(join(out, "glossary", "index.html"), "utf8"),
      "the stamped page's bytes differ between the builds",
    );

    const caches = new FakeCaches();
    const first = new OfflineWorker(asBuild(manifest), { origin: ORIGIN, caches, fetch: served(out, manifest).fetch });
    await first.install();
    await first.activate();
    const saved = ["/glossary/", "/sources/", "/call-workflow-loop/"];
    const reply = await first.savePage(saved);
    assert.deepEqual(reply.saved, saved);

    const network = served(next, second);
    const update = new OfflineWorker(asBuild(second), {
      origin: ORIGIN,
      caches,
      fetch: network.fetch,
      openClients: async () => [],
    });
    await update.install();
    const cache = await caches.open(`manual-${second.build}`);
    for (const path of ["/glossary/", "/sources/"]) {
      const page = await (await cache.match(`${ORIGIN}${path}`))?.text();
      assert.equal(
        page,
        readFileSync(join(next, path.slice(1), "index.html"), "utf8"),
        `${path} carried over as the new build's page`,
      );
      assert.ok(
        !network.requests.some((req) => new URL(req.url).pathname === path),
        `${path} was not downloaded again`,
      );
    }
    assert.equal(
      await cache.match(`${ORIGIN}/call-workflow-loop/`),
      undefined,
      "a changed chapter is not carried over",
    );
    await update.activate();
    assert.deepEqual([...caches.stores.keys()], [`manual-${second.build}`], "the old build's cache is gone");
    assert.deepEqual((await update.status()).failed, []);
  } finally {
    rmSync(next, { recursive: true, force: true });
  }
});

test("the worker and the build agree on the placeholder", () => {
  assert.equal(WORKER_PLACEHOLDER, BUILD_PLACEHOLDER);
});
