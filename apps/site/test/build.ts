// Builds the site into a temporary folder with an allowlisted environment, for test/global-build.ts.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/** The app's folder. */
export const ROOT = fileURLToPath(new URL("..", import.meta.url));

function nearestBin(name: string): string {
  for (let dir = ROOT; dir !== dirname(dir); dir = dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin", name);
    if (existsSync(bin)) return bin;
  }
  throw new Error(`no node_modules/.bin/${name} above ${ROOT}`);
}

/** Runs `astro build` into a new temporary folder and returns it; the caller removes it. */
export async function buildSite(): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), "site-build-"));
  const home = mkdtempSync(join(tmpdir(), "site-home-"));
  // An allowlisted environment, never ...process.env (AGENTS.md), with Astro's telemetry off so the build stays offline.
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: home,
    TMPDIR: tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    ASTRO_TELEMETRY_DISABLED: "1",
  };
  await promisify(execFile)(nearestBin("astro"), ["build", "--outDir", out], { cwd: ROOT, env });
  rmSync(home, { recursive: true, force: true });
  return out;
}
