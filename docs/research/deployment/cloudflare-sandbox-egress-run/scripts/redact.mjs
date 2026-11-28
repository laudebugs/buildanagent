// Takes the account's identifiers out of a case record before it is committed: the account id in the image
// reference and the account's workers.dev subdomain, which the echo server's headers and URLs carry. Run it over
// files (node scripts/redact.mjs results/*.json), or import redact() as run-cases.mjs does.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function redact(text) {
  return text
    .replace(/registry\.cloudflare\.com\/[0-9a-f]{32}\//g, "registry.cloudflare.com/<account-id>/")
    .replace(/n50-egress-test-20261128\.[a-z0-9-]+\.workers\.dev/g, "n50-egress-test-20261128.<subdomain>.workers.dev")
    .replace(/"cf-worker":"[a-z0-9-]+\.workers\.dev"/g, '"cf-worker":"<subdomain>.workers.dev"');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const file of process.argv.slice(2)) writeFileSync(file, redact(readFileSync(file, "utf8")));
}
