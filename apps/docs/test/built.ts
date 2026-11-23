// The folder test/built-site.ts built the docs into, for the tests that read built pages. When the build failed, the
// call throws the build's error, so only the tests that read the built site fail and every other test still runs.
import { inject } from "vitest";

/** The folder `astro build` wrote the docs to for this test run; throws the build's error when the build failed. */
export function builtSite(): string {
  const site = inject("builtSite");
  if ("error" in site) throw new Error(`the docs build failed, so this test has no built site to read:\n${site.error}`);
  return site.out;
}
