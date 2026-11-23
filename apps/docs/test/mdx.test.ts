import assert from "node:assert/strict";
import { test } from "vitest";
import { splitFences } from "../src/plugins/pages.js";

// The content tests read MDX pages through splitFences. These tests pin what it skips and what it still checks, so
// supporting a component never loosens a rule for Markdown or hides a reader's words.
const TABS = [
  "Install it with your package manager:",
  "",
  '<Tabs syncKey="package-manager">',
  '  <TabItem label="pnpm">',
  "  ```bash",
  "  pnpm add pkg",
  "  ```",
  "  </TabItem>",
  '  <TabItem label="npm">',
  "  ```bash",
  "  npm install pkg",
  "  ```",
  "  </TabItem>",
  "</Tabs>",
  "",
  "Then run it.",
].join("\n");

test("an MDX page's component lines and imports leave no text in the body, and still split paragraphs", () => {
  const { body } = splitFences(
    `import { Tabs, TabItem } from "@astrojs/starlight/components";\n\nOne.\n<Tabs>\nTwo.\n</Tabs>\n`,
    true,
  );
  assert.equal(body, "\n\nOne.\n\nTwo.\n\n");
});

test("fences in sibling tabs take the sentence that introduces the group", () => {
  const { fences } = splitFences(TABS, true);
  assert.deepEqual(
    fences.map((fence) => fence.before),
    ["Install it with your package manager:", "Install it with your package manager:"],
  );
});

test("a component line that carries words stays in the body, so its words are counted", () => {
  const { body } = splitFences("<Aside>Read this first.</Aside>\n", true);
  assert.match(body, /Read this first/);
});

test("Markdown keeps the strict rule: a fence after another fence has no introduction", () => {
  const { fences } = splitFences("Run:\n\n```bash\none\n```\n\n```bash\ntwo\n```\n", false);
  assert.equal(fences[0]?.before, "Run:");
  assert.equal(fences[1]?.before, "```");
  // The same text read as MDX has no component line between the fences, so it is just as strict.
  assert.equal(splitFences("Run:\n\n```bash\none\n```\n\n```bash\ntwo\n```\n", true).fences[1]?.before, "```");
});

test("component lines in Markdown are plain text, so a .md page cannot hide words in them", () => {
  assert.match(splitFences("<Tabs>\n", false).body, /<Tabs>/);
});

test("lines inside a code block are never blanked, whatever they look like", () => {
  const page = [
    "```ts",
    'import { createAgent } from "@buildanagent/sdk";',
    "const a = 1;",
    "```",
    "",
    "```tsx",
    "<Foo />",
    "```",
    "",
    "```ts",
    'import { wrong } from "nowhere";',
    "```",
  ].join("\n");
  const { fences } = splitFences(page, true);
  assert.equal(fences[0]?.code, 'import { createAgent } from "@buildanagent/sdk";\nconst a = 1;');
  assert.equal(fences[1]?.code, "<Foo />");
  assert.equal(fences[2]?.code, 'import { wrong } from "nowhere";');
});

test("text a reader sees in a component's title, label or description is still checked as prose", () => {
  const { body } = splitFences(
    [
      '<Aside title="Mind this gotcha">',
      '<LinkCard title="Read more" description="A short pointer." href="/x/" />',
    ].join("\n"),
    true,
  );
  assert.match(body, /Mind this gotcha/);
  assert.match(body, /Read more/);
  assert.match(body, /A short pointer\./);
  assert.doesNotMatch(body, /href|<LinkCard/);
});

test("a fence borrows the previous fence's introduction only across TabItem lines", () => {
  const between = (middle: string) =>
    splitFences(`Run it:\n\n\`\`\`bash\none\n\`\`\`\n${middle}\n\`\`\`bash\ntwo\n\`\`\`\n`, true).fences[1]?.before;
  assert.equal(between('</TabItem>\n<TabItem label="npm">'), "Run it:");
  assert.equal(between("<Aside>\n</Aside>"), "```");
  assert.equal(between("<Card>"), "```");
});

test("imports, exports and comments outside a fence leave no words in the body", () => {
  const { body } = splitFences(
    [
      'import "./x.css";',
      "import {",
      "  Tabs,",
      "  TabItem,",
      '} from "@astrojs/starlight/components";',
      "export const meta = {",
      '  a: "b",',
      "};",
      "{/* a note to authors */}",
      "{/*",
      "  more of the note",
      "*/}",
      "Real words.",
    ].join("\n"),
    true,
  );
  assert.equal(body.replace(/\s+/g, " ").trim(), "Real words.");
});
