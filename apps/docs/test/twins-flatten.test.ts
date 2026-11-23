import assert from "node:assert/strict";
import { test } from "vitest";
import { exampleSource } from "../src/plugins/example-code.js";
import { type FlattenContext, flattenBody, TwinError, twinMarkdown } from "../src/twins/flatten.js";

// The flattening on small fixtures: each part of a page that only makes sense in the rendered site becomes plain
// Markdown, and the rest of the page is the author's own text.
const ctx: FlattenContext = {
  site: "https://docs.test",
  hasTwin: (slug) => slug !== "missing",
  page: "fixture.mdx",
};
const mdx = (body: string) => flattenBody(body, true, ctx);

test("tabs become a bold label line and the code, one block after another", () => {
  const out = mdx(
    [
      'import { Tabs, TabItem } from "@astrojs/starlight/components";',
      "",
      "Install it:",
      "",
      '<Tabs syncKey="pm">',
      '  <TabItem label="pnpm">',
      "  ```bash",
      "  pnpm add x",
      "  ```",
      "  </TabItem>",
      '  <TabItem label="npm">',
      "  ```bash",
      "  npm install x",
      "  ```",
      "  </TabItem>",
      "</Tabs>",
      "",
      "Done.",
    ].join("\n"),
  );
  assert.equal(
    out,
    "Install it:\n\n**pnpm**\n\n```bash\npnpm add x\n```\n\n**npm**\n\n```bash\nnpm install x\n```\n\nDone.\n",
  );
});

test("an aside becomes a blockquote that opens with its label, from a component or a directive", () => {
  const component = mdx('<Aside type="caution" title="Careful">\nDo not do this.\n</Aside>');
  assert.equal(component, "> **Careful**\n>\n> Do not do this.\n");
  const byType = mdx('<Aside type="tip">\nTry this.\n</Aside>');
  assert.equal(byType, "> **Tip**\n>\n> Try this.\n");
  const directive = flattenBody(":::note[Read this]\nIt matters.\n:::\n", false, ctx);
  assert.equal(directive, "> **Read this**\n>\n> It matters.\n");
  assert.equal(flattenBody(":::danger\nStop.\n:::\n", false, ctx), "> **Danger**\n>\n> Stop.\n");
});

test("a figure becomes one line with its caption and alt text, and no drawing", () => {
  const out = mdx(
    '::figure[The six packages and what each imports]{id="package-map" alt="The CLI sits on the harness."}',
  );
  assert.equal(out, "**Figure: The six packages and what each imports.** The CLI sits on the harness.\n");
});

test("a file fence becomes the code it names, titled with the file's name", () => {
  const out = mdx('```ts file="packages/sdk/examples/make-model.ts" region="model"\n```');
  const code = exampleSource({ file: "packages/sdk/examples/make-model.ts", region: "model" });
  assert.equal(out, `\`\`\`ts title="make-model.ts"\n${code}\n\`\`\`\n`);
  assert.doesNotMatch(out, /file=/);
});

test("a file fence inside a tab sits at the margin", () => {
  const out = mdx(
    '<Tabs>\n  <TabItem label="A">\n  ```ts file="packages/sdk/examples/make-model.ts" region="model"\n  ```\n  </TabItem>\n</Tabs>',
  );
  assert.match(out, /^\*\*A\*\*\n\n```ts title="make-model\.ts"\n\/\*\* Binds/);
  assert.ok(
    out.split("\n").every((line) => !line.startsWith("  ```")),
    "the fence keeps no tab indent",
  );
});

test("link cards, a grid and buttons become list items with the links as the twin would give them", () => {
  const out = mdx(
    [
      "<CardGrid>",
      '  <LinkCard title="Gateway" description="Calls models." href="/start/install/" />',
      '  <LinkCard title="Harness" description="Wraps the loop." href="https://example.com/readme" />',
      "</CardGrid>",
      "",
      '<LinkButton href="/guides/add-a-tool/" variant="primary">Read the guides</LinkButton>',
    ].join("\n"),
  );
  assert.equal(
    out,
    [
      "- [Gateway](https://docs.test/start/install.md): Calls models.",
      "- [Harness](https://example.com/readme): Wraps the loop.",
      "",
      "- [Read the guides](https://docs.test/guides/add-a-tool.md)",
      "",
    ].join("\n"),
  );
});

test("imports, exports and comments leave nothing behind", () => {
  const out = mdx(
    [
      'import { Tabs } from "@astrojs/starlight/components";',
      "export const x = 1;",
      "",
      "{/* a note for editors */}",
      "",
      "Text stays.",
      "",
      "{/* another,",
      "   over two lines */}",
    ].join("\n"),
  );
  assert.equal(out, "Text stays.\n");
  assert.equal(flattenBody("Before.\n\n<!-- hidden -->\n\nAfter.\n", false, ctx), "Before.\n\nAfter.\n");
});

test("a link to a page with a twin points at the twin, other links and anchors stay, and a page without one keeps its page", () => {
  const out = flattenBody(
    "See [the gateway](/concepts/the-gateway/#retries), [home](/), [gone](/missing/), [out](https://a.test/x) and [here](#top).\n\n[ref]: /start/install/",
    false,
    ctx,
  );
  assert.equal(
    out,
    "See [the gateway](https://docs.test/concepts/the-gateway.md#retries), [home](https://docs.test/index.md), [gone](https://docs.test/missing/), [out](https://a.test/x) and [here](#top).\n\n[ref]: https://docs.test/start/install.md\n",
  );
});

test("code that mentions a component, a figure or a link is not touched", () => {
  const body = '```mdx\n<Aside>x</Aside>\n::figure[c]{id="a" alt="b"}\n[l](/start/install/)\n```\n';
  assert.equal(flattenBody(body, true, ctx), body);
});

test("a component the module does not know is an error that names the page and line", () => {
  assert.throws(
    () => mdx("Intro.\n\n<Mystery>hi</Mystery>"),
    (error: unknown) => {
      assert.ok(error instanceof TwinError);
      assert.match(error.message, /fixture\.mdx:3: no Markdown form for <Mystery>/);
      return true;
    },
  );
});

test("a twin opens with the title and the description, and leaves the description out when a page has none", () => {
  assert.equal(
    twinMarkdown({ title: "Install", description: "How." }, "Body.\n", false, ctx),
    "# Install\n\nHow.\n\nBody.\n",
  );
  assert.equal(twinMarkdown({ title: "Foo", description: undefined }, "Body.\n", false, ctx), "# Foo\n\nBody.\n");
});
