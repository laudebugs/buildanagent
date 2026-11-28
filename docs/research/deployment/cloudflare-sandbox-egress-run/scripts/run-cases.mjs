// Runs N50's live cases against the deployed test Worker, one at a time, and writes each case's record to
// results/<case>.json. The Worker's URL and run key come from the environment, never from a file in the repo:
//   N50_URL=https://n50-egress-test-20261128.<subdomain>.workers.dev N50_RUN_KEY=... node scripts/run-cases.mjs [case...]
// The records name neither the account id nor its workers.dev subdomain (scripts/redact.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "./redact.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.dirname(here);
const CASES = [
  "a-http-only-intercepts",
  "a-no-intercepts",
  "a-reverse-proxy-routes",
  "b-per-host-https",
  "cd-per-host-denied-and-internal",
  "c-star-intercept",
  "d-internet-on",
  "e-limit-hostnames",
  "e-limit-ips",
  "e-wildcard",
];
const base = process.env.N50_URL;
const key = process.env.N50_RUN_KEY;
if (!base || !key) throw new Error("Set N50_URL and N50_RUN_KEY");
const host = new URL(base).hostname;
const placeholder = "n50-egress-test-20261128.<subdomain>.workers.dev";
const pkg = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8"));

for (const name of process.argv.length > 2 ? process.argv.slice(2) : CASES) {
  const requestedAt = new Date().toISOString();
  const response = await get(`${base}/case/${name}`);
  const text = response.text;
  let body;
  try {
    body = JSON.parse(redact(text.replaceAll(host, placeholder)));
  } catch {
    body = { status: response.status, text: redact(text.replaceAll(host, placeholder)) };
  }
  const record = {
    todo: "N50",
    requestedAt,
    finishedAt: new Date().toISOString(),
    versions: { ...pkg.dependencies, ...pkg.devDependencies, compatibility_date: "2026-11-01" },
    httpStatus: response.status,
    result: body,
  };
  writeFileSync(path.join(project, "results", `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  const steps = body.steps ?? [];
  console.log(
    `${name}: HTTP ${response.status}, ${steps.length} steps, ${(body.registrations ?? []).length} registrations`,
  );
}
const stop = await get(`${base}/stop`);
console.log("stop:", stop.status, stop.text);

// node:https, not fetch: a case can run for minutes before the Worker answers, past fetch's headers timeout.
function get(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { "x-run-key": key } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.setTimeout(30 * 60_000, () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}
