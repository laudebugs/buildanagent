// Builds the site once for every test file: two Astro builds at the same time share one `.astro` cache folder and break
// each other. The folder's path reaches the tests through `inject("siteOut")`.
import { rmSync } from "node:fs";
import type { TestProject } from "vitest/node";
import { buildSite } from "./build.js";

let out = "";

/** Builds the site before the first test file runs. */
export async function setup(project: TestProject): Promise<void> {
  out = await buildSite();
  project.provide("siteOut", out);
}

/** Removes the build output after the last test file. */
export function teardown(): void {
  rmSync(out, { recursive: true, force: true });
}

declare module "vitest" {
  export interface ProvidedContext {
    siteOut: string;
  }
}
