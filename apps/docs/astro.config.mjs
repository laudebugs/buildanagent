import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import { exampleFile } from "./src/plugins/example-file.js";
import { renderInputFiles } from "./src/plugins/render-inputs.js";

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

// The docs are fully static: Astro's default static output and no adapter. The sidebar is explicit, in the order
// start, concepts, guides, testing, reference, so a new page appears only when someone places it.
export default defineConfig({
  site: "https://docs.buildanagent.fyi",
  cacheDir: CACHE_DIR,
  markdown: { remarkPlugins: [exampleFile] },
  integrations: [
    starlight({
      title: "buildanagent",
      description: "Docs for the buildanagent gateway and SDK: build an agent, test it offline, ship it.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/laudebugs/buildanagent" }],
      components: { Footer: "./src/components/Footer.astro" },
      plugins: [starlightLinksValidator()],
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "What the SDK is", slug: "start/what-the-sdk-is" },
            { label: "Install", slug: "start/install" },
            { label: "Your first agent", slug: "start/first-agent" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "The transcript and the stream", slug: "concepts/transcript-and-stream" },
            { label: "Stop reasons", slug: "concepts/stop-reasons" },
            { label: "Tools", slug: "concepts/tools" },
            { label: "Approvals", slug: "concepts/approvals" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Add a tool", slug: "guides/add-a-tool" },
            { label: "Pause for approval", slug: "guides/pause-for-approval" },
          ],
        },
        {
          label: "Testing",
          items: [
            { label: "Test with ScriptedModel", slug: "testing/scripted-model" },
            { label: "Keep tests offline", slug: "testing/offline" },
          ],
        },
        {
          label: "Reference",
          items: [{ label: "Packages and entry points", slug: "reference/packages" }],
        },
      ],
    }),
  ],
});
