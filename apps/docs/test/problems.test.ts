import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { REPO_ROOT } from "../src/plugins/example-code.js";
import { readPages } from "../src/plugins/pages.js";

// A "Problems and fixes" page starts each entry from what the reader sees, then gives the cause and the fix
// (docs/guidelines/docs-writing.md). These tests check the shape of every entry, and that every error code a page names
// is a code that a package's source defines, so a renamed code fails here and not in a reader's search.
const problemPages = readPages().filter((page) => /(^|\/)problems-and-fixes\.mdx?$/.test(page.path));
const MIN_ENTRIES = 3;
const LABELS = ["**You see.**", "**Cause.**", "**Fix.**"] as const;

/** The entries of a page: each `###` heading and the paragraphs under it. */
export function entriesOf(body: string): { heading: string; paragraphs: string[] }[] {
  return body
    .split(/^### /m)
    .slice(1)
    .map((chunk) => {
      const [heading = "", ...rest] = chunk.split("\n");
      const text = rest.join("\n").split(/^## /m)[0] ?? "";
      return {
        heading: heading.trim(),
        paragraphs: text
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter((paragraph) => paragraph !== ""),
      };
    });
}

/** Every source file of every package, joined, to look error codes up in. */
function packageSources(): string {
  const root = join(REPO_ROOT, "packages");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".ts")) files.push(join(dir, entry.name));
    }
  };
  for (const pkg of readdirSync(root)) walk(join(root, pkg, "src"));
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

test("the docs have at least one Problems and fixes page", () => {
  assert.ok(problemPages.length > 0);
});

for (const page of problemPages) {
  const entries = entriesOf(page.body);

  test(`${page.path} holds at least ${MIN_ENTRIES} entries`, () => {
    assert.ok(entries.length >= MIN_ENTRIES, `${page.path} has ${entries.length} entries`);
  });

  test(`${page.path} writes each entry as what you see, then its cause, then its fix`, () => {
    for (const entry of entries) {
      const starts = entry.paragraphs.map((paragraph) => LABELS.find((label) => paragraph.startsWith(label)));
      assert.deepEqual(
        starts.slice(0, LABELS.length),
        [...LABELS],
        `"${entry.heading}" must give ${LABELS.join(", ")}`,
      );
    }
  });

  test(`${page.path} names only error codes that a package defines`, () => {
    const sources = packageSources();
    for (const entry of entries) {
      const text = [entry.heading, ...entry.paragraphs].join("\n");
      const codes = [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1] ?? "");
      for (const code of codes) {
        assert.ok(sources.includes(`"${code}"`), `"${entry.heading}" names ${code}, which no package defines`);
      }
    }
  });
}

test("the entry reader splits a page into entries and stops at the next section", () => {
  const body = "## Area\n\n### One\n\n**You see.** a\n\n**Cause.** b\n\n**Fix.** c\n\n## Other\n\ntext\n";
  assert.deepEqual(entriesOf(body), [{ heading: "One", paragraphs: ["**You see.** a", "**Cause.** b", "**Fix.** c"] }]);
});
