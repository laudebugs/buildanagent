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

/** The string literals of every exported `...ErrorCode` union in `source`, such as `HarnessErrorCode`. */
export function errorCodesIn(source: string): string[] {
  const unions = source.matchAll(/export type \w*ErrorCode =([^;]*);/g);
  return [...unions].flatMap((union) =>
    [...(union[1] ?? "").matchAll(/"([a-z]+(?:_[a-z]+)+)"/g)].map((m) => m[1] ?? ""),
  );
}

/** The error codes the packages define: the members of their `...ErrorCode` unions, not any string in their source. */
function definedCodes(): Set<string> {
  const root = join(REPO_ROOT, "packages");
  const codes = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".ts"))
        for (const code of errorCodesIn(readFileSync(join(dir, entry.name), "utf8"))) codes.add(code);
    }
  };
  for (const pkg of readdirSync(root)) walk(join(root, pkg, "src"));
  return codes;
}

/** The snake_case words in backticks that `text` names and `defined` lacks. */
export function unknownCodes(text: string, defined: ReadonlySet<string>): string[] {
  return [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1] ?? "").filter((code) => !defined.has(code));
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

  test(`${page.path} names only error codes that a package's error-code union defines`, () => {
    const defined = definedCodes();
    for (const entry of entries) {
      const text = [entry.heading, ...entry.paragraphs].join("\n");
      assert.deepEqual(unknownCodes(text, defined), [], `"${entry.heading}" names a code that no package defines`);
    }
  });
}

test("the entry reader splits a page into entries and stops at the next section", () => {
  const body = "## Area\n\n### One\n\n**You see.** a\n\n**Cause.** b\n\n**Fix.** c\n\n## Other\n\ntext\n";
  assert.deepEqual(entriesOf(body), [{ heading: "One", paragraphs: ["**You see.** a", "**Cause.** b", "**Fix.** c"] }]);
});

test("a quoted word that is no member of an error-code union fails, even when it appears in source", () => {
  const defined = new Set(
    errorCodesIn('export type HarnessErrorCode = | "session_locked" | "duplicate_tool";\nconst other = "not_a_code";'),
  );
  assert.deepEqual([...defined], ["session_locked", "duplicate_tool"]);
  assert.deepEqual(unknownCodes("`session_locked` and `not_a_code`", defined), ["not_a_code"]);
});

test("the packages define the codes that the harness pages name", () => {
  const defined = definedCodes();
  for (const code of [
    "session_locked",
    "session_read_only",
    "entry_not_found",
    "duplicate_tool",
    "invalid_turn_options",
  ]) {
    assert.ok(defined.has(code), code);
  }
});
