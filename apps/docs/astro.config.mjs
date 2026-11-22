import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import { exampleFile } from "./src/plugins/example-file.js";

// The docs are fully static: Astro's default static output and no adapter. The sidebar is explicit, in the order
// start, concepts, guides, testing, reference, so a new page appears only when someone places it.
export default defineConfig({
  site: "https://docs.buildanagent.fyi",
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
