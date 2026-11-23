import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the README's override table lists exactly the components astro.config.mjs overrides, with their files", () => {
  const config = read("../astro.config.mjs");
  const block = /components:\s*\{([^}]*)\}/.exec(config)?.[1] ?? "";
  const configured = [...block.matchAll(/(\w+):\s*"\.\/([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`).sort();
  const readme = read("../README.md");
  const table = /### Components the docs override([\s\S]*?)\n###? /.exec(readme)?.[1] ?? "";
  const documented = [...table.matchAll(/^\| `(\w+)` \| `([^`]+)` \|/gm)].map((m) => `${m[1]} ${m[2]}`).sort();
  assert.ok(configured.length > 0, "found no overrides in astro.config.mjs");
  assert.deepEqual(documented, configured);
});
