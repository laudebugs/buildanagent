// Takes the account's identifiers out of a case record or log before it is committed: the account id in the image
// reference and the account's workers.dev subdomain. The subdomain appears in URLs, in the echo server's `cf-worker`
// header (JSON-escaped inside a command's stdout, and sometimes cut short by the record's truncation) and anywhere
// else a command printed it. So redact() replaces the label wherever it appears, whole or cut short.
// The label comes from N50_URL (https://n50-egress-test-20261128.<subdomain>.workers.dev), never from a file in the
// repo. Run it over files (N50_URL=... node scripts/redact.mjs results/*), or import redact() as run-cases.mjs does.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "<subdomain>";

/** The account's workers.dev label, from a URL such as https://<worker>.<label>.workers.dev. */
export function subdomainOf(url) {
  const match = /^[^.]+\.([a-z0-9-]+)\.workers\.dev$/.exec(new URL(url).hostname);
  if (!match) throw new Error("N50_URL must be https://<worker>.<subdomain>.workers.dev");
  return match[1];
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redact(text, label = process.env.N50_URL ? subdomainOf(process.env.N50_URL) : undefined) {
  let out = text
    .replace(/registry\.cloudflare\.com\/[0-9a-f]{32}\//g, "registry.cloudflare.com/<account-id>/")
    .replace(/\/accounts\/[0-9a-f]{32}\//g, "/accounts/<account-id>/")
    // The cf-worker header's value, with plain or JSON-escaped quotes, whole or cut short by truncation.
    .replace(/(cf-worker\\?"\s*:\s*\\?")[^"\\]*/g, `$1${PLACEHOLDER}`)
    // Whatever follows the Worker's name and a dot is the subdomain, or a cut-short piece of it, whatever comes
    // after it: ".workers.dev", an escaped newline, a quote or nothing, because the records truncate stdout mid-string.
    .replace(/n50-egress-test-20261128\.(?!<)[a-z0-9-]*/gi, `n50-egress-test-20261128.${PLACEHOLDER}`);
  if (label) {
    // The whole label anywhere, then a cut-short prefix of 4 or more characters wherever a string ends after it.
    out = out.replace(new RegExp(escapeRegExp(label), "gi"), PLACEHOLDER);
    for (let n = label.length - 1; n >= 4; n--) {
      out = out.replace(new RegExp(`${escapeRegExp(label.slice(0, n))}(?=\\\\|"|$)`, "gim"), PLACEHOLDER);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.N50_URL) throw new Error("Set N50_URL so the subdomain label can be found and replaced");
  for (const file of process.argv.slice(2)) writeFileSync(file, redact(readFileSync(file, "utf8")));
}
