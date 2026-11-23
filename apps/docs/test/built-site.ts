// Builds the docs once per test run, into a temporary folder that every test file which reads built pages gets with
// `builtSite()` from test/built.ts. One build, not one per file: TypeDoc deletes and rewrites
// src/content/docs/reference/ during each build, so two builds that run at once can read each other's half-written
// reference and fail the link check. A failed build is provided as its error rather than thrown, because a global
// setup that throws stops every test file, the ones that never read the built site included.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";

/** The folder `astro build` wrote the docs to for this test run, or the build's error when it failed. */
export type BuiltSite = { readonly out: string } | { readonly error: string };

declare module "vitest" {
  export interface ProvidedContext {
    builtSite: BuiltSite;
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

/** A failed build's message with the end of its output, which holds Astro's own report of what failed. */
function buildError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { stdout, stderr } = error as { stdout?: unknown; stderr?: unknown };
  const tail = (output: unknown) => (typeof output === "string" ? output.trim().split("\n").slice(-40).join("\n") : "");
  return [error.message, tail(stdout), tail(stderr)].filter((part) => part !== "").join("\n");
}

/**
 * Runs `build` into a new temporary folder and returns what the tests get, with the teardown that removes the folder.
 * A failed build's folder is removed at once, since nothing reads it, and its error is returned instead of thrown.
 */
export async function buildSite(
  build: (out: string) => Promise<unknown>,
): Promise<{ readonly site: BuiltSite; readonly teardown: () => void }> {
  const out = mkdtempSync(join(tmpdir(), "docs-build-"));
  const teardown = () => rmSync(out, { recursive: true, force: true });
  try {
    await build(out);
  } catch (error) {
    teardown();
    return { site: { error: buildError(error) }, teardown: () => {} };
  }
  return { site: { out }, teardown };
}

/** Runs `astro build` into `out` with an allowlisted environment and a temporary home that it removes afterwards. */
async function astroBuild(out: string): Promise<void> {
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
}

export default async function setup(project: TestProject): Promise<() => void> {
  const { site, teardown } = await buildSite(astroBuild);
  project.provide("builtSite", site);
  return teardown;
}
