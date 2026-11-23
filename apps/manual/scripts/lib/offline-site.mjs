// What the two offline browser checks share (offline-browser-check.mjs and save-offline-check.mjs): a test build of
// the whole book that registers the worker on loopback, and a static server over it that sends public/_headers' rules,
// the content security policy included, and can stop and start again to take the book offline and back.
import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { writeOffline } from "../offline-build.mjs";

/** The manual's folder, `apps/manual/`. */
export const app = fileURLToPath(new URL("../..", import.meta.url));

const run = promisify(execFile);

/**
 * The only variables the build and the browser inherit: no provider key or other secret passes through. HOME is a
 * fresh folder, which the caller removes.
 */
export function offlineEnv() {
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: mkdtempSync(join(tmpdir(), "manual-home-")),
    TMPDIR: tmpdir(),
    LANG: "C.UTF-8",
    ASTRO_TELEMETRY_DISABLED: "1",
  };
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
  return env;
}

function nearestBin(name) {
  for (let dir = app; dir !== dirname(dir); dir = dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin", name);
    if (existsSync(bin)) return bin;
  }
  throw new Error(`no node_modules/.bin/${name} above ${app}`);
}

/**
 * Builds the book into `<work>/dist` with the production build's steps and MANUAL_OFFLINE_TEST_HOST=127.0.0.1, the
 * only way a build lets a loopback host register the worker. Resolves with the folder and the offline manifest.
 */
export async function buildTestBook(work, env) {
  const dist = join(work, "dist");
  await run(nearestBin("astro"), ["build", "--outDir", dist], {
    cwd: app,
    env: { ...env, MANUAL_OFFLINE_TEST_HOST: "127.0.0.1" },
  });
  await run(nearestBin("pagefind"), ["--site", dist], { cwd: app, env });
  return { dist, manifest: await writeOffline(dist) };
}

// The rules of public/_headers, applied as Cloudflare's asset server would: `/*`, a path prefix ending in `*`, or an
// exact path. Values of the same header from two rules are joined with a comma.
function parseHeaders(text) {
  const rules = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    if (!line.startsWith(" ")) rules.push({ pattern: line.trim(), headers: [] });
    else
      rules.at(-1)?.headers.push(
        line
          .trim()
          .split(/:\s*(.*)/s)
          .slice(0, 2),
      );
  }
  return rules;
}
const RULES = parseHeaders(readFileSync(join(app, "public", "_headers"), "utf8"));
const matches = (pattern, path) => (pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/**
 * Serves the folder `root()` names on a loopback port, with `_headers`' rules. A page goes through `rewrite` first,
 * so a check can change pages on their way as a CDN would. `stop()` closes the server and every open connection, and
 * `start()` listens on the same port again.
 */
export async function serveBook(root, rewrite = (html) => html) {
  const sockets = new Set();
  const server = createServer((request, response) => {
    const base = root();
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname))
      .split(sep)
      .join("/");
    let file = join(base, path);
    let status = 200;
    if (!file.startsWith(base) || !existsSync(file)) {
      file = join(base, "404.html");
      status = 404;
    } else if (statSync(file).isDirectory()) {
      if (!path.endsWith("/")) {
        response.writeHead(307, { location: `${path}/` }).end();
        return;
      }
      file = join(file, "index.html");
    }
    const headers = new Map([["content-type", TYPES[extname(file)] ?? "application/octet-stream"]]);
    for (const rule of RULES) {
      if (!matches(rule.pattern, path)) continue;
      for (const [name, value] of rule.headers) {
        const key = name.toLowerCase();
        headers.set(key, headers.has(key) && key !== "content-type" ? `${headers.get(key)}, ${value}` : value);
      }
    }
    response.writeHead(status, Object.fromEntries(headers));
    if (file.endsWith(".html")) response.end(rewrite(readFileSync(file, "utf8")));
    else createReadStream(file).pipe(response);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const stop = () =>
    new Promise((resolve) => {
      server.close(resolve);
      for (const socket of sockets) socket.destroy();
    });
  const start = () => new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const close = () => {
    server.close();
    for (const socket of sockets) socket.destroy();
  };
  return { origin: `http://127.0.0.1:${port}`, port, stop, start, close };
}
