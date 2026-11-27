// Rewrites public/_headers from the built pages in dist/, which `pnpm --filter @buildanagent/docs headers` builds
// first. The deploy serves main's public/_headers, so this is how a changed inline script reaches the live policy.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { siteHeaders } from "../src/csp/policy.js";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const target = fileURLToPath(new URL("../public/_headers", import.meta.url));
const { headers, hashes, problems } = siteHeaders(dist);
if (problems.length > 0) {
  console.error(`The content security policy cannot be built:\n${problems.join("\n")}`);
  process.exit(1);
}
writeFileSync(target, headers);
console.log(`Wrote public/_headers with ${hashes.length} inline script hashes.`);
