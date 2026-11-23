// Builds the docs once per test run, into a temporary folder that every test file which reads built pages gets with
// `inject("builtSite")`. One build, not one per file: TypeDoc deletes and rewrites src/content/docs/reference/ during
// each build, so two builds that run at once can read each other's half-written reference and fail the link check.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** The folder `astro build` wrote the docs to for this test run. */
    builtSite: string;
  }
}

const APP = fileURLToPath(new URL("..", import.meta.url));

function nearestBin(name: string): string {
  for (let dir = APP; dir !== dirname(dir); dir = dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin", name);
    if (existsSync(bin)) return bin;
  }
  throw new Error(`no node_modules/.bin/${name} above ${APP}`);
}

export default async function setup(project: TestProject): Promise<() => void> {
  const out = mkdtempSync(join(tmpdir(), "docs-build-"));
  const home = mkdtempSync(join(tmpdir(), "docs-home-"));
  // An allowlisted environment, never ...process.env (AGENTS.md), with Astro's telemetry off so the build stays offline.
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: home,
    TMPDIR: tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    ASTRO_TELEMETRY_DISABLED: "1",
  };
  try {
    await promisify(execFile)(nearestBin("astro"), ["build", "--outDir", out], { cwd: APP, env });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  project.provide("builtSite", out);
  return () => rmSync(out, { recursive: true, force: true });
}
