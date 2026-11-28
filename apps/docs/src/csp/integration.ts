/**
 * The Astro integration that writes `dist/_headers` from the built site, after every page is written. It fails the
 * build when a page or a served SVG carries markup the policy blocks, or when a limit on the file is passed. The
 * deploy serves main's committed `public/_headers`, not this file, so `test/csp.test.ts` compares the two.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { checkedSiteHeaders } from "./policy.js";

export function cspHeaders(): AstroIntegration {
  return {
    name: "docs-csp-headers",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const { headers, hashes, documents } = checkedSiteHeaders(dist);
        // Replaces the copy of public/_headers that Astro wrote, so dist/ always carries the policy its pages need.
        writeFileSync(join(dist, "_headers"), headers);
        logger.info(`wrote _headers with ${hashes.length} inline script hashes and ${documents.size} document rules`);
      },
    },
  };
}
