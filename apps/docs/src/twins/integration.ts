/**
 * The Starlight plugin that adds the twin step to a build. Starlight plugins run with the user's sidebar, which gives
 * `llms.txt` its reading order, so the order never has a second copy to keep in step with `astro.config.mjs`.
 */
import { fileURLToPath } from "node:url";
import type { StarlightPlugin } from "@astrojs/starlight/types";
import type { AstroIntegration } from "astro";
import { checkTwins, type TwinSite, writeTwins } from "./build.js";
import { readingOrder, type SidebarEntry, twinPages } from "./pages.js";

/**
 * Where a `context7.json` could be added. Context7 reads a file of that name at the root of a site or repository to learn
 * which pages to index. The owner chose not to use it (2026-11-23), so nothing writes one. To add it, write the file
 * into `dist` in `astro:build:done` below, from `twinPages()`, with the site's `url` and these twins' addresses.
 */
function twinIntegration(summary: string, sidebar: readonly SidebarEntry[]): AstroIntegration {
  let origin = "";
  return {
    name: "docs-markdown-twins",
    hooks: {
      "astro:config:done": ({ config }) => {
        if (config.site === undefined) throw new Error("the docs need `site` in astro.config.mjs to write llms.txt");
        origin = config.site.replace(/\/+$/, "");
      },
      "astro:build:done": ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const pages = twinPages(true);
        const site: TwinSite = { origin, title: "Build An Agent docs", summary };
        const started = performance.now();
        const report = writeTwins(dist, readingOrder(pages, sidebar), site);
        const problems = checkTwins(dist, pages);
        if (problems.length > 0) throw new Error(`Markdown twins are incomplete:\n${problems.join("\n")}`);
        logger.info(
          `wrote ${report.count} Markdown twins (${Math.round(report.bytes / 1024)} KiB) in ${Math.round(performance.now() - started)} ms`,
        );
      },
    },
  };
}

/** The Starlight plugin: list it in `starlight({ plugins })`, after every plugin that changes the sidebar. */
export function markdownTwins(): StarlightPlugin {
  return {
    name: "docs-markdown-twins",
    hooks: {
      "config:setup": ({ config, addIntegration }) => {
        addIntegration(twinIntegration(config.description ?? "", (config.sidebar ?? []) as SidebarEntry[]));
      },
    },
  };
}
