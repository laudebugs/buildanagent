import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import starlightSidebarTopics from "starlight-sidebar-topics";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";
import { API_PACKAGES, entryPoints, tsconfigOf, typeDocOptions } from "./src/api/packages.js";
import { githubLink } from "./src/chrome.js";
import { CODE_STYLE_OVERRIDES, codeThemes } from "./src/design/theme.js";
import { exampleFile } from "./src/plugins/example-file.js";
import { figureDirective } from "./src/plugins/figure.js";
import { renderInputFiles } from "./src/plugins/render-inputs.js";
import { topics, unlistedPages } from "./src/topics.js";
import { markdownTwins } from "./src/twins/integration.js";

// Astro caches each page's rendered HTML until the page's own file changes. A page that shows an example file, or the
// plugin that fills its fence, would therefore keep old code after an edit. When any of those files differs from the
// last build, the check below deletes the content cache, so every page renders again. Astro 7.4 keeps the cache in
// .astro/data-store.json under `astro dev` and in <cacheDir>/data-store.json under `astro build`, so both are deleted,
// and the config sets cacheDir itself so the check and Astro use the same directory. Check both paths after every Astro
// upgrade.
const CACHE_DIR = "./node_modules/.astro/";
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const hash = createHash("sha256");
for (const file of renderInputFiles()) hash.update(file).update(readFileSync(file));
const digest = hash.digest("hex");
const stamp = here(`${CACHE_DIR}render-inputs.sha256`);
if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== digest) {
  rmSync(here(`${CACHE_DIR}data-store.json`), { force: true });
  rmSync(here("./.astro/data-store.json"), { force: true });
  mkdirSync(here(CACHE_DIR), { recursive: true });
  writeFileSync(stamp, digest);
}

// One TypeDoc plugin, sidebar group and sidebar topic for each package, from the package's own exports and TSDoc. The
// pages are written under src/content/docs/reference/ at build time and are not committed.
const api = API_PACKAGES.map((pkg) => {
  const [plugin, sidebarGroup] = createStarlightTypeDocPlugin();
  const { entryPoints: _entries, tsconfig: _tsconfig, ...typeDoc } = typeDocOptions(pkg);
  return {
    plugin: plugin({
      entryPoints: entryPoints(pkg),
      tsconfig: tsconfigOf(pkg),
      output: pkg.output,
      sidebar: { label: pkg.name, collapsed: false },
      // The package's root entry is its main page, so the module list leads with its exports. Each module is named for
      // its import path by an `@module` tag in the entry file.
      typeDoc: { ...typeDoc, entryFileName: "index" },
    }),
    group: sidebarGroup,
    label: pkg.label,
    output: pkg.output,
  };
});

// The docs are fully static: Astro's default static output and no adapter. The sidebar is explicit, so a new page
// appears only when someone places it in a topic.
export default defineConfig({
  site: "https://docs.buildanagent.fyi",
  cacheDir: CACHE_DIR,
  markdown: { remarkPlugins: [exampleFile, figureDirective] },
  integrations: [
    starlight({
      title: "buildanagent",
      favicon: "/favicon.svg",
      description: "Docs for the buildanagent gateway and SDK: build an agent, test it offline, ship it.",
      social: [{ icon: "github", label: githubLink.label, href: githubLink.href }],
      routeMiddleware: "./src/route-data.ts",
      components: {
        Banner: "./src/components/Banner.astro",
        Footer: "./src/components/Footer.astro",
        Head: "./src/components/Head.astro",
        PageTitle: "./src/components/PageTitle.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
        SocialIcons: "./src/components/SocialIcons.astro",
      },
      // The book's theme: its tokens, mapped onto Starlight's variables, and its code panels in both modes. The
      // panel colours are measured at 4.5:1 or more, so Expressive Code must not shift them to its own minimum. That
      // also turns off its correction on marked, inserted and deleted lines, so the markers take measured panel colours
      // too (CODE_STYLE_OVERRIDES.textMarkers).
      customCss: [
        "./src/styles/tokens.css",
        "./src/styles/starlight.css",
        "@buildanagent/manual/styles/figures.css",
        "./src/styles/figures.css",
      ],
      expressiveCode: {
        themes: codeThemes(),
        minSyntaxHighlightingColorContrast: 0,
        styleOverrides: CODE_STYLE_OVERRIDES,
      },
      // The sidebar is the topics plugin's (src/topics.ts), not a `sidebar` option, which the plugin refuses.
      plugins: [
        starlightLinksValidator(),
        // Before every TypeDoc plugin, because it writes the sidebar and each of them replaces its placeholder in it.
        starlightSidebarTopics(topics(api), { topics: unlistedPages(api) }),
        ...api.map((entry) => entry.plugin),
        // Last: it reads the sidebar after the other plugins have changed it.
        markdownTwins(),
      ],
    }),
  ],
});
