/**
 * The Astro integration that writes `dist/_headers` from the built pages, after every page is written. It fails the
 * build when a page carries markup the policy blocks or when the CSP line passes `MAX_CSP_LINE`. The deploy serves
 * main's committed `public/_headers`, not this file, so `test/csp.test.ts` compares the two.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { siteHeaders } from "./policy.js";

export function cspHeaders(): AstroIntegration {
  return {
    name: "docs-csp-headers",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const { headers, hashes, problems } = siteHeaders(dist);
        if (problems.length > 0)
          throw new Error(`The content security policy cannot be built:\n${problems.join("\n")}`);
        // Replaces the copy of public/_headers that Astro wrote, so dist/ always carries the policy its pages need.
        writeFileSync(join(dist, "_headers"), headers);
        logger.info(`wrote _headers with ${hashes.length} inline script hashes`);
      },
    },
  };
}
