// The render-input hash below is adapted from astro.config.mjs in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import { chaptersDir as bookChaptersDir, loadBook, renderDependencies } from "./src/book/load.js";
import { book, markdownOptions } from "./src/markdown/options.js";

// Astro caches each chapter's rendered HTML until the chapter file itself changes. An edit to a Markdown plugin, to
// the content model it calls, to the outline or a register it reads, or to another chapter's numbered blocks would
// therefore never reach the chapters. When any render input differs from the last build, the render-input check below
// deletes the content cache, so every chapter renders again. Astro 7.4 keeps that cache in .astro/data-store.json
// under `astro dev` and in <cacheDir>/data-store.json under `astro build` (astro/dist/content/paths.js), so both are
// deleted. The config sets cacheDir itself, so the check and Astro use the same directory. Check both paths after
// every Astro upgrade, because a moved cache would make chapters go stale again.
// Paths resolve from this file, so the config loads from any directory.
const CACHE_DIR = "./node_modules/.astro/";
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const filesIn = (dir) =>
  readdirSync(here(dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
const renderInputs = [
  ...filesIn("./src/markdown/"),
  ...filesIn("./src/book/"),
  ...filesIn("./src/data/"),
  here("./src/outline.ts"),
  here("./src/content/analogies.json"),
].sort();
const renderHash = createHash("sha256");
for (const file of renderInputs) renderHash.update(file.slice(here("./").length)).update(readFileSync(file));
// The other chapters' numbered blocks, which a chapter's references and numbers depend on.
renderHash.update(renderDependencies(book));
const renderDigest = renderHash.digest("hex");
const renderStamp = here(`${CACHE_DIR}render-inputs.sha256`);
if (!existsSync(renderStamp) || readFileSync(renderStamp, "utf8") !== renderDigest) {
  rmSync(here(`${CACHE_DIR}data-store.json`), { force: true });
  rmSync(here("./.astro/data-store.json"), { force: true });
  mkdirSync(here(CACHE_DIR), { recursive: true });
  writeFileSync(renderStamp, renderDigest);
}

// Under `astro dev`, an edit to a render input restarts the server, which reloads this config and reruns the check.
// So does a chapter edit that changes the book's numbered blocks, or one that breaks the book's rules, so the error
// shows at once.
const chaptersDir = bookChaptersDir();
function chapterChangesNumbers() {
  try {
    return renderDependencies(loadBook()) !== renderDependencies(book);
  } catch {
    return true;
  }
}
const restartOnRenderInputs = {
  name: "restart-on-render-inputs",
  configureServer(server) {
    server.watcher.add(renderInputs);
    const onChange = (file) => {
      if (renderInputs.includes(file)) server.restart();
      else if (file.startsWith(chaptersDir) && file.endsWith(".md") && chapterChangesNumbers()) server.restart();
    };
    for (const event of ["change", "add", "unlink"]) server.watcher.on(event, onChange);
  },
};

// The book is fully static: Astro's default static output and no adapter (BK3).
export default defineConfig({
  site: "https://manual.buildanagent.fyi",
  cacheDir: CACHE_DIR,
  // Every page URL ends in a slash, so links and the search index agree on one address per page.
  trailingSlash: "always",
  devToolbar: { enabled: false },
  // Every style and script ships as its own same-origin file, never inlined into the page, so the content security
  // policy can allow scripts and styles by origin alone, with no hashes or 'unsafe-inline'.
  build: { inlineStylesheets: "never" },
  vite: { plugins: [restartOnRenderInputs], build: { assetsInlineLimit: 0 } },
  markdown: {
    // Astro 7's default processor, Sätteri, runs no remark or rehype plugins, so chapters use `unified()`.
    processor: unified(markdownOptions),
  },
});
