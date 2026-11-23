// Builds the fixture book once per test run, into a temporary folder that every test file which reads built pages gets
// with `builtBook()` from test/built.ts. One build, not one per file: `astro build` writes its prerender bundle to
// <app>/.astro/.prerender whatever --outDir says, so two builds that run at once delete the chunks the other is
// importing and fail with ERR_MODULE_NOT_FOUND, which skips every test behind them. A failed build is provided as its
// error rather than thrown, because a global setup that throws stops every test file, the ones that never read the
// built site included. The same pattern as apps/docs/test/built-site.ts.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";

/** The folder `astro build` wrote the fixture book to for this test run, or the build's error when it failed. */
export type BuiltBook = { readonly out: string } | { readonly error: string };

declare module "vitest" {
  export interface ProvidedContext {
    builtBook: BuiltBook;
  }
}

const APP = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_BOOK = fileURLToPath(new URL("./fixtures/site/", import.meta.url));

/** The nearest `node_modules/.bin/<name>` above the app, for the tests that run a build tool themselves. */
export function nearestBin(name: string): string {
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

/** Runs `astro build` into `out` with an allowlisted environment and a temporary home that it removes afterwards. */
async function astroBuild(out: string): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "manual-home-"));
  // An allowlisted environment, never ...process.env (AGENTS.md), with Astro's telemetry off so the build stays offline.
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: home,
    TMPDIR: tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    ASTRO_TELEMETRY_DISABLED: "1",
    BOOK_FIXTURE_DIR: FIXTURE_BOOK,
  };
  try {
    await promisify(execFile)(nearestBin("astro"), ["build", "--outDir", out], { cwd: APP, env });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export default async function setup(project: TestProject): Promise<() => void> {
  const out = mkdtempSync(join(tmpdir(), "manual-build-"));
  const teardown = () => rmSync(out, { recursive: true, force: true });
  try {
    await astroBuild(out);
  } catch (error) {
    teardown();
    project.provide("builtBook", { error: buildError(error) });
    return () => {};
  }
  project.provide("builtBook", { out });
  return teardown;
}
