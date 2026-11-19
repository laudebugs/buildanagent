import assert from "node:assert/strict";
import { readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "vitest";

// Vite 8 replaces its default SSR conditions with the list a config gives, so each package's Vitest config spells
// out `source` and then Vite's `defaultServerConditions`, which `vitest/config` doesn't re-export. This test reads the
// defaults from the `vite` that Vitest itself resolves, so a Vite upgrade that changes them fails here.
const packagesDir = fileURLToPath(new URL("../..", import.meta.url));

async function viteDefaultServerConditions(): Promise<readonly string[]> {
  const vitestManifest = realpathSync(createRequire(import.meta.url).resolve("vitest/package.json"));
  const viteEntry = createRequire(vitestManifest).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { defaultServerConditions: readonly string[] };
  return vite.defaultServerConditions;
}

const configs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packagesDir, entry.name, "vitest.config.ts"));

test("every package's Vitest config lists source, then Vite's default server conditions", async () => {
  const defaults = await viteDefaultServerConditions();
  assert.ok(defaults.length > 0);
  assert.ok(configs.length >= 2);
  for (const file of configs) {
    const config = (await import(pathToFileURL(file).href)) as {
      default: { ssr?: { resolve?: { conditions?: string[] } } };
    };
    assert.deepEqual(config.default.ssr?.resolve?.conditions, ["source", ...defaults], file);
  }
});
