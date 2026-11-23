// What the book's two Playwright checks share (notes-browser-check.mjs and touch-fields-check.mjs): loading Playwright,
// the allowlisted environment a browser runs with, a static server over the built book and a text selection helper.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/** The built book, `apps/manual/dist/`. */
export const dist = fileURLToPath(new URL("../../dist/", import.meta.url));

/** The only variables a launched browser inherits: no provider key or other secret passes through. */
export const browserEnv = { PATH: process.env.PATH ?? "", HOME: tmpdir(), LANG: "C.UTF-8" };

const require = createRequire(import.meta.url);

/** Playwright from the workspace, or else from npm's global folder, where the cloud sessions install it. */
export function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const global = execFileSync("npm", ["root", "-g"], { encoding: "utf8", env: browserEnv }).trim();
    return createRequire(join(global, "x.js"))("playwright");
  }
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

/** Serves `dist/` on a loopback port and resolves with the server and its origin. A missing path gets 404.html. */
export async function serveDist() {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
    let file = join(dist, path);
    if (!file.startsWith(dist) || !existsSync(file)) file = join(dist, "404.html");
    else if (statSync(file).isDirectory()) file = join(file, "index.html");
    response.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

/** Selects `length` characters, from `from`, inside the first text node long enough in the n-th long paragraph. */
export async function selectIn(page, paragraphIndex, from, length) {
  return page.evaluate(
    ([index, start, count]) => {
      const paragraph = [...document.querySelectorAll("article p")].filter((p) => p.textContent.trim().length > 200)[
        index
      ];
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      // A node a reader can select: long enough, shown, and not inside a hidden glossary card, code or a link.
      const usable = (text) =>
        text.data.length >= start + count &&
        !text.parentElement.closest("[aria-hidden='true'], [data-pagefind-ignore], code, a") &&
        text.parentElement.getClientRects().length > 0;
      while (node && !usable(node)) node = walker.nextNode();
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + count);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return range.toString();
    },
    [paragraphIndex, from, length],
  );
}
