// Rewrites public/_headers from the built site in dist/, which `pnpm --filter @buildanagent/docs headers` builds
// first. The deploy serves main's public/_headers, so this is how a changed inline script reaches the live policy.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkedSiteHeaders } from "../src/csp/policy.js";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const target = fileURLToPath(new URL("../public/_headers", import.meta.url));
try {
  const { headers, hashes, documents } = checkedSiteHeaders(dist);
  writeFileSync(target, headers);
  console.log(`Wrote public/_headers with ${hashes.length} inline script hashes and ${documents.size} document rules.`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
