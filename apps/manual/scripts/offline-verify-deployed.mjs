// Checks a deployed copy of the book against its own offline list (ADR 0059): it fetches /offline-manifest.json, then
// every listed file, and compares each with the size and SHA-256 the build recorded. The offline worker stores only
// those bytes, so a file the network changes on its way, for example a page that Cloudflare's Email Address
// Obfuscation, Rocket Loader or a Web Analytics beacon rewrote, shows up here. A rewritten page that still carries the
// build's <meta name="manual-build"> is reported as rewritten: the worker keeps it and reports it too. Any other
// difference is a failure, because the worker would refuse that file.
//
// Run it by hand after a deploy; it makes about a hundred requests to the site it is given and nothing else.
//
//   node scripts/offline-verify-deployed.mjs https://manual.buildanagent.fyi
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fetches the list and every listed file from `origin`; resolves to { build, ok, rewritten, failed }, where each of
 * the last three lists paths, and a failure carries its reason.
 */
export async function verifyDeployed(origin, { fetch = globalThis.fetch } = {}) {
  const base = new URL(origin).origin;
  const get = (path) => fetch(`${base}${path}`, { redirect: "manual", cache: "no-store" });
  const listResponse = await get("/offline-manifest.json");
  if (listResponse.status !== 200) throw new Error(`/offline-manifest.json answered ${listResponse.status}`);
  const list = await listResponse.json();
  const mark = `<meta name="manual-build" content="${list.build}">`;
  const result = { build: list.build, ok: [], rewritten: [], failed: [] };
  const worker = await get("/sw.js");
  const workerText = worker.status === 200 ? await worker.text() : "";
  if (!workerText.startsWith(`// The book's service worker for build ${list.build}`)) {
    result.failed.push({ path: "/sw.js", reason: `does not carry build ${list.build}` });
  }
  for (const file of list.files) {
    const response = await get(file.url);
    if (response.status !== 200) {
      result.failed.push({ path: file.url, reason: `status ${response.status}` });
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === file.size && createHash("sha256").update(bytes).digest("hex") === file.sha256) {
      result.ok.push(file.url);
    } else if (file.path.endsWith(".html") && bytes.toString("utf8").includes(mark)) {
      result.rewritten.push(file.url);
    } else {
      result.failed.push({ path: file.url, reason: `${bytes.length} bytes that differ from the build's ${file.size}` });
    }
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const origin = process.argv[2];
  if (!origin || process.argv.length > 3) {
    console.error("Usage: node scripts/offline-verify-deployed.mjs <origin, such as https://manual.buildanagent.fyi>");
    process.exit(2);
  }
  const result = await verifyDeployed(origin);
  console.log(`Build ${result.build}: ${result.ok.length} files match the list byte for byte.`);
  if (result.rewritten.length > 0) {
    console.log(
      `${result.rewritten.length} pages were rewritten on the way but keep the build's mark, so the worker stores ` +
        `them and reports them: ${result.rewritten.join(", ")}. Turn off the Cloudflare feature that rewrites them ` +
        '(README, "The book installs as an app and opens offline").',
    );
  }
  for (const problem of result.failed) console.error(`FAILED ${problem.path}: ${problem.reason}`);
  process.exit(result.failed.length > 0 ? 1 : 0);
}
