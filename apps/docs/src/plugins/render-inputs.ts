/**
 * The files whose change must make Astro render the pages again. Astro caches a page's rendered HTML by the page's own
 * file, so an edit to an example file or to the plugin that fills a fence would otherwise leave the old code on the
 * page. The config hashes these files and clears the cache when the hash changes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { REPO_ROOT } from "./example-code.js";
import { DOCS_DIR, pagePaths } from "./pages.js";

const PLUGINS_DIR = new URL(".", import.meta.url).pathname;

/** Every plugin file, and every example file that a page's `file=` fence names, sorted. */
export function renderInputFiles(): string[] {
  const plugins = readdirSync(PLUGINS_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(PLUGINS_DIR, name));
  const examples = pagePaths(DOCS_DIR).flatMap((page) =>
    [...readFileSync(page, "utf8").matchAll(/(?:^|\s)file="([^"]+)"/g)].map((match) =>
      resolve(REPO_ROOT, (match[1] ?? "").split("/").join(sep)),
    ),
  );
  return [...new Set([...plugins, ...examples])].sort();
}
