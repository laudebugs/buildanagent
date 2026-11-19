// Run one bundled example in workerd and print a JSON result line. run-examples.mjs spawns this
// script per example with an allowlisted environment, so workerd (a child of this process)
// inherits no credentials.
// Usage: node scripts/worker-run.mjs <job.json>
//   job: { file, mode: "probe" | "test", durableObjects: { binding: className }, compatibilityFlags, live }
import { readFile } from "node:fs/promises";
import { start } from "./workerd.mjs";

const job = JSON.parse(await readFile(process.argv[2], "utf8"));
// Refuse non-local fetches from this Node process too (Miniflare only talks to localhost).
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname))
    return Promise.reject(new Error(`verify harness: network disabled (blocked ${url.hostname})`));
  return realFetch(input, init);
};

const out = (result) => console.log(`__RESULT__${JSON.stringify(result)}`);
let mf;
const evicted = [];
try {
  // A live run answers the Worker's model calls here, outside workerd, through the fetch the guard above leaves
  // alone (scripts/live-model.mjs). Importing it takes the key out of the environment before workerd starts.
  const liveModel = job.live ? (await import("./live-model.mjs")).liveModel(realFetch) : undefined;
  const started = start(job.file, {
    durableObjects: job.durableObjects,
    compatibilityFlags: job.compatibilityFlags,
    vars: job.vars,
    onEvict: (c) => evicted.push(c),
    liveModel,
  });
  mf = started.mf;
  try {
    await mf.ready;
  } catch (e) {
    out({ phase: "startup", error: String(e.message ?? e).slice(0, 1500), blocked: started.blocked });
    process.exit(0);
  }
  const path =
    job.mode === "test"
      ? "/__harness/test"
      : `/__harness/probe?bindings=${encodeURIComponent(JSON.stringify(Object.entries(job.durableObjects).map(([name, className]) => ({ name, className }))))}`;
  const res = await mf.dispatchFetch(`http://localhost${path}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: `harness returned ${res.status}: ${text.slice(0, 500)}` };
  }
  out({ phase: "run", status: res.status, ...body, blocked: [...new Set(started.blocked)], evicted });
} catch (e) {
  out({ phase: "harness", error: String(e?.stack ?? e).slice(0, 1500) });
} finally {
  await mf?.dispose().catch(() => {});
}
process.exit(0);
