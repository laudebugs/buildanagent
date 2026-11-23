/**
 * The files whose change must make Astro render the pages again. Astro caches a page's rendered HTML by the page's own
 * file, so an edit to an example file, a figure SVG or the plugin that fills a fence or a figure would otherwise leave
 * the old content on the page. The config hashes these files and clears the cache when the hash changes.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FIGURE_IDS, svgOf } from "../../figures/registry.js";
import { REPO_ROOT } from "./example-code.js";
import { DOCS_DIR, pagePaths } from "./pages.js";

const PLUGINS_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Every plugin file, every example file that a page's `file=` fence names and every figure SVG, sorted. */
export function renderInputFiles(): string[] {
  const plugins = readdirSync(PLUGINS_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(PLUGINS_DIR, name));
  const examples = pagePaths(DOCS_DIR).flatMap((page) =>
    [...readFileSync(page, "utf8").matchAll(/(?:^|\s)file="([^"]+)"/g)].map((match) =>
      resolve(REPO_ROOT, (match[1] ?? "").split("/").join(sep)),
    ),
  );
  // A file that does not exist is left out, so the plugin that fills the fence reports the real error with the path.
  const figures = FIGURE_IDS.map(svgOf);
  return [...new Set([...plugins, ...examples, ...figures].filter((file) => existsSync(file)))].sort();
}
