// `pnpm --filter @buildanagent/manual figures:audit`: proves every isometric figure under the folders it is given
// with the vendored anatomy skill's two checks. For each figure it runs scripts/audit-figure.ts, the skill's geometry
// audit, which must print `audit passed`, and then the skill's scripts/lines.mjs on the figure's light and dark check
// pages, which must each print `line ends: 0`. The line check drives headless Chrome, found as the skill finds it: the
// CHROME_PATH variable, then the usual install paths. Each check runs in its own process with an allowlisted
// environment (AGENTS.md), and the script prints how long each took.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IsoFigure, THEMES } from "../figures/lib/isokit.js";
import { figureScripts, fromRepo, loadFigure } from "../figures/lib/registry.js";

const LINES = fileURLToPath(new URL("../../../.agents/skills/anatomy/scripts/lines.mjs", import.meta.url));
const AUDIT = fileURLToPath(new URL("./audit-figure.ts", import.meta.url));

/** Runs a Node script with this process's loader flags (tsx's) and an allowlisted environment; resolves its output. */
function run(args: string[], home: string): Promise<{ code: number; output: string; seconds: number }> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    ...(process.env.CHROME_PATH ? { CHROME_PATH: process.env.CHROME_PATH } : {}),
  };
  const started = performance.now();
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, ...args], { env });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? 1, output, seconds: (performance.now() - started) / 1000 }));
  });
}

const roots = process.argv.slice(2).map((root) => resolve(root));
const out = mkdtempSync(join(tmpdir(), "figures-audit-"));
const home = mkdtempSync(join(tmpdir(), "figures-audit-home-"));
const failed: string[] = [];
let audited = 0;
const proven = new Map<string, string>();
const started = performance.now();
try {
  for (const root of roots) {
    for (const figure of figureScripts(root)) {
      const drawn = await loadFigure(figure);
      if (!(drawn instanceof IsoFigure)) continue;
      // A fixture may re-export another fixture's figure; the same drawing needs proving once.
      const card = drawn.fragment(figure.source).replace(/^<!--[^\n]*-->\n/, "");
      const same = proven.get(card);
      if (same !== undefined) {
        console.log(`${figure.source}: the same figure as ${same}, already checked`);
        continue;
      }
      proven.set(card, figure.source);
      audited += 1;
      const audit = await run([AUDIT, root, `${figure.chapter}/${figure.id}`, out], home);
      const passed = audit.code === 0 && /^audit passed$/m.test(audit.output);
      console.log(`${figure.source}: ${passed ? "audit passed" : "audit FAILED"} (${audit.seconds.toFixed(1)} s)`);
      if (!passed) {
        console.log(audit.output);
        failed.push(`${figure.source}: audit`);
        continue;
      }
      for (const theme of THEMES) {
        const page = join(out, `${figure.id}-${theme}.html`);
        const lines = await run([LINES, page], home);
        const clean = lines.code === 0 && /^line ends: 0 /m.test(lines.output);
        const summary = /^line ends: .*$/m.exec(lines.output)?.[0] ?? "the line check did not run";
        console.log(`  ${theme}: ${summary} (${lines.seconds.toFixed(1)} s)`);
        if (!clean) {
          console.log(lines.output);
          failed.push(`${figure.source}: line ends, ${theme}`);
        }
      }
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`figures:audit: ${audited} isometric figure(s) in ${seconds} s, ${failed.length} failing check(s)`);
for (const failure of failed) console.log(`  failed: ${failure}`);
if (audited === 0) console.log("figures:audit: no isometric figures found under", roots.map(fromRepo).join(", "));
process.exitCode = failed.length === 0 ? 0 : 1;
