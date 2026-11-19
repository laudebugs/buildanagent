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
import { markdownOptions } from "./src/markdown/options.js";

// Astro caches each chapter's rendered HTML until the chapter file itself changes. An edit to a Markdown plugin, or
// to data a plugin reads, would therefore never reach the chapters. When any render input differs from the last
// build, the config deletes the content cache, so every chapter renders again. Astro 7.4 keeps that cache in
// .astro/data-store.json under `astro dev` and in <cacheDir>/data-store.json under `astro build`
// (astro/dist/content/paths.js), so both are deleted. The config sets cacheDir itself, so the hash and Astro read
// the same directory. Check both paths after every Astro upgrade, because a moved cache would make chapters go stale
// again. Paths resolve from this file, so the config loads from any directory.
const CACHE_DIR = "./node_modules/.astro/";
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const renderInputs = readdirSync(here("./src/markdown/"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();
const renderHash = createHash("sha256");
for (const file of renderInputs) renderHash.update(file.slice(here("./").length)).update(readFileSync(file));
const renderDigest = renderHash.digest("hex");
const renderStamp = here(`${CACHE_DIR}render-inputs.sha256`);
if (!existsSync(renderStamp) || readFileSync(renderStamp, "utf8") !== renderDigest) {
  rmSync(here(`${CACHE_DIR}data-store.json`), { force: true });
  rmSync(here("./.astro/data-store.json"), { force: true });
  mkdirSync(here(CACHE_DIR), { recursive: true });
  writeFileSync(renderStamp, renderDigest);
}

// Under `astro dev`, an edit to a render input restarts the server, which reloads this config and runs the check.
const restartOnRenderInputs = {
  name: "restart-on-render-inputs",
  configureServer(server) {
    server.watcher.add(renderInputs);
    server.watcher.on("change", (file) => {
      if (renderInputs.includes(file)) server.restart();
    });
  },
};

// The book is fully static: Astro's default static output and no adapter (BK3).
export default defineConfig({
  site: "https://manual.buildanagent.fyi",
  cacheDir: CACHE_DIR,
  // Every page URL ends in a slash, so links and the search index agree on one address per page.
  trailingSlash: "always",
  devToolbar: { enabled: false },
  vite: { plugins: [restartOnRenderInputs] },
  markdown: {
    // Astro 7's default processor, Sätteri, runs no remark or rehype plugins, so chapters use `unified()`.
    processor: unified(markdownOptions),
  },
});
