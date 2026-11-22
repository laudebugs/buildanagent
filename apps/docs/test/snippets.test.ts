import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { parseExampleRef } from "../src/plugins/example-code.js";
import { readPages } from "../src/plugins/pages.js";

// A short code block that a page writes inline must still compile against the packages. A longer block comes from an
// example file, which the package's own type-check already covers. Each block is a module of its own, beside the
// docs app so that it resolves the workspace packages through their `source` condition, as the packages' tests do.
const TSC = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc");
const APP = fileURLToPath(new URL("..", import.meta.url));

// The type-check reads the gateway's sources too, so it gets more than the default 5 seconds on a busy runner.
test("every inline TypeScript block type-checks against the packages", { timeout: 60_000 }, () => {
  const blocks = readPages().flatMap((page) =>
    page.fences
      .filter((fence) => ["ts", "typescript"].includes(fence.lang) && parseExampleRef(fence.meta) === undefined)
      .map((fence) => ({ where: `${page.path}:${fence.line}`, code: fence.code })),
  );
  assert.ok(blocks.length > 0, "the pages have inline TypeScript blocks");
  const folder = mkdtempSync(join(APP, ".snippets-"));
  try {
    for (const [index, block] of blocks.entries()) {
      writeFileSync(join(folder, `block-${index}.ts`), `${block.code}\nexport {};\n`);
    }
    writeFileSync(
      join(folder, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2024",
          lib: ["es2024"],
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ["node"],
          customConditions: ["source"],
        },
        include: ["*.ts"],
      }),
    );
    const env = { PATH: process.env.PATH ?? "", HOME: tmpdir(), TMPDIR: tmpdir(), LANG: "C.UTF-8" };
    try {
      execFileSync(process.execPath, [TSC, "-p", join(folder, "tsconfig.json")], {
        env,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      const output = (error as { stdout?: string }).stdout ?? String(error);
      const named = output.replace(/block-(\d+)\.ts/g, (_all, n: string) => blocks[Number(n)]?.where ?? `block ${n}`);
      assert.fail(`an inline block does not compile:\n${named}`);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
