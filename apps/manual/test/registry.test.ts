import assert from "node:assert/strict";
import { test, vi } from "vitest";

// figureScripts() reads names as readdirSync gives them, which on Windows separate folders with a backslash. The
// listing is mocked to Windows's form, so the test runs the same on every platform.
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: () => true,
    readdirSync: () => ["call-workflow-loop\\who-decides.ts", "lib", "lib\\registry.ts", "lib\\svgkit.ts"],
  };
});

test("figure scripts are found, and lib/ skipped, when the listing uses Windows separators", async () => {
  const { figureScripts } = await import("../figures/lib/registry.js");
  assert.deepEqual(
    figureScripts("figures").map(({ chapter, id }) => `${chapter}/${id}`),
    ["call-workflow-loop/who-decides"],
  );
});
