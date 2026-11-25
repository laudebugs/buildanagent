// The opt-in live run of the Cloudflare adapters on the owner's own account. It deploys the same test Worker that
// cloudflare.test.ts runs in Miniflare, under a name of its own, runs the same checks against real Durable Objects, a
// real alarm and real hibernation, and deletes the Worker however the run ends. It never runs in CI, and it reads no
// secret it prints: the key ring and the access token are random values made for this run alone, handed to Wrangler on
// standard input, and the owner's Cloudflare login stays with Wrangler. The steps are in docs/cloudflare-live-run.md.
//
//   HARNESS_CLOUDFLARE_LIVE=1 pnpm --filter @buildanagent/harness live:cloudflare
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleWorker, COMPAT_DATE } from "./miniflare.js";

const NAME = `buildanagent-harness-live-${randomBytes(3).toString("hex")}`;
// The variables Wrangler needs to find the owner's login and run; nothing else from this shell reaches it.
const PASSED = ["PATH", "HOME", "LANG", "TMPDIR", "XDG_CONFIG_HOME", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];

function refuseUnlessAsked(): void {
  if (process.env.HARNESS_CLOUDFLARE_LIVE !== "1") {
    console.error("The live run deploys to your Cloudflare account. Set HARNESS_CLOUDFLARE_LIVE=1 to run it.");
    process.exit(2);
  }
  if (process.env.CI !== undefined) {
    console.error("The live run never runs in CI.");
    process.exit(2);
  }
}

/** Runs Wrangler in `dir` and returns its output. Output is shown only on failure, with this run's secrets removed. */
function wrangler(dir: string, args: string[], secrets: readonly string[], input?: string): string {
  const env = Object.fromEntries(
    PASSED.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
  );
  const result = spawnSync(process.env.WRANGLER ?? "wrangler", args, { cwd: dir, env, input, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    const shown = secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), output);
    throw new Error(`wrangler ${args[0]} failed:\n${shown}`);
  }
  return output;
}

async function deploy(dir: string, secrets: { ring: string; token: string }): Promise<string> {
  await bundleWorker(fileURLToPath(new URL("./worker.ts", import.meta.url)), join(dir, "worker.mjs"));
  const config = {
    name: NAME,
    main: "worker.mjs",
    compatibility_date: COMPAT_DATE,
    compatibility_flags: ["nodejs_compat"],
    durable_objects: { bindings: [{ name: "HarnessDO", class_name: "HarnessDO" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["HarnessDO"] }],
    // The Worker refuses every request until LIVE_TOKEN is set, so the public address is closed from the first deploy.
    vars: { LIVE: "1" },
  };
  writeFileSync(join(dir, "wrangler.json"), JSON.stringify(config, null, 2));
  const hidden = [secrets.ring, secrets.token];
  const deployed = wrangler(dir, ["deploy"], hidden);
  wrangler(dir, ["secret", "put", "APPROVAL_KEYS"], hidden, secrets.ring);
  wrangler(dir, ["secret", "put", "LIVE_TOKEN"], hidden, secrets.token);
  const url = /https:\/\/\S+\.workers\.dev/.exec(deployed)?.[0];
  assert.ok(url, "wrangler deploy printed no workers.dev address");
  return url;
}

async function get<T>(base: string, path: string, token: string): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${base}${path}${separator}token=${token}`);
  const body = await response.text();
  assert.equal(response.status, 200, `${path}: ${response.status}`);
  return JSON.parse(body) as T;
}

async function checkCases(base: string, token: string): Promise<void> {
  const names = await get<string[]>(base, "/cases", token);
  let failed = 0;
  for (const [index, name] of names.entries()) {
    const outcome = await get<{ name: string; skipped?: string; error?: string }>(base, `/case?index=${index}`, token);
    const verdict =
      outcome.error !== undefined ? `failed: ${outcome.error}` : outcome.skipped !== undefined ? "skipped" : "passed";
    if (outcome.error !== undefined || outcome.name !== name) failed += 1;
    console.log(`${verdict.padEnd(8)} ${name}`);
  }
  assert.equal(failed, 0, `${failed} portability cases failed on Cloudflare`);
}

async function checkRaces(base: string, token: string): Promise<void> {
  const locks = await Promise.all(Array.from({ length: 16 }, () => get<string>(base, "/race/lock", token)));
  assert.equal(locks.filter((result) => result === "won").length, 1, `lock race: ${locks.join()}`);
  const appends = await Promise.all(
    Array.from({ length: 16 }, (_, i) => get<string>(base, `/race/append?id=r${i}`, token)),
  );
  assert.equal(appends.filter((result) => result === "won").length, 1, `append race: ${appends.join()}`);
  console.log("passed   16 concurrent requests: one lock holder and one append");
}

async function checkAlarm(base: string, token: string): Promise<void> {
  const at = await get<number>(base, "/alarm/arm?id=live&ms=2000", token);
  const ends = Date.now() + 60_000;
  for (;;) {
    const rows = await get<{ wake_id: string; at: number }[]>(base, "/alarm/deliveries", token);
    const delivered = rows.find((row) => row.wake_id === "live");
    if (delivered !== undefined) {
      assert.equal(delivered.at, at);
      console.log(`passed   the real alarm delivered a wake ${Date.now() - at} ms after its time`);
      return;
    }
    assert.ok(Date.now() < ends, "the real alarm delivered nothing within a minute");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function send(socket: WebSocket, message: unknown): void {
  socket.send(JSON.stringify(message));
}

/** Runs a turn, waits until the object really leaves memory, and runs another turn on the same socket. */
async function checkHibernation(base: string, token: string): Promise<void> {
  const socket = new WebSocket(`${base.replace("https://", "wss://")}/ws?token=${token}`);
  const seen: { id?: unknown; method?: string; result?: { accepted?: boolean } }[] = [];
  socket.addEventListener("message", (event) => seen.push(JSON.parse(String(event.data))));
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  const settled = (n: number) => seen.filter((message) => message.method === "turn/settled").length >= n;
  const waitFor = async (done: () => boolean, what: string, ms: number) => {
    const ends = Date.now() + ms;
    while (!done()) {
      assert.ok(Date.now() < ends, `timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  send(socket, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "live", version: "1" }, capabilities: [] },
  });
  send(socket, { jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "live", cwd: "/workspace" } });
  send(socket, {
    jsonrpc: "2.0",
    id: 3,
    method: "turn/start",
    params: { session: "live", input: [{ type: "text", text: "hi" }] },
  });
  await waitFor(() => settled(1), "the first turn", 30_000);
  const before = (await get<{ instance: string }>(base, "/ws/served", token)).instance;
  // An idle object with only hibernatable sockets leaves memory after a short while; a request would wake it, so wait.
  await new Promise((resolve) => setTimeout(resolve, 90_000));
  send(socket, {
    jsonrpc: "2.0",
    id: 4,
    method: "turn/start",
    params: { session: "live", input: [{ type: "text", text: "again" }] },
  });
  await waitFor(() => settled(2), "the turn after hibernation", 30_000);
  const after = (await get<{ instance: string }>(base, "/ws/served", token)).instance;
  assert.equal(seen.find((message) => message.id === 4)?.result?.accepted, true);
  console.log(
    `passed   a turn after hibernation on the same socket (the object ${before === after ? "stayed in memory" : "was evicted and rebuilt"})`,
  );
  socket.close(1000);
}

async function main(): Promise<void> {
  refuseUnlessAsked();
  const dir = mkdtempSync(join(tmpdir(), "harness-cloudflare-live-"));
  const secrets = {
    ring: JSON.stringify({ current: "live", keys: { live: randomBytes(32).toString("base64url") } }),
    token: randomBytes(24).toString("base64url"),
  };
  try {
    const base = await deploy(dir, secrets);
    console.log(`deployed ${NAME}`);
    const smoke = await get<Record<string, unknown>>(base, "/smoke", secrets.token);
    assert.equal(smoke.evalBlocked, true);
    assert.deepEqual(
      [smoke.pi, smoke.fallback],
      [
        { valid: true, invalid: false },
        { valid: true, invalid: false },
      ],
    );
    assert.deepEqual(smoke.tools, ["echo"]);
    console.log("passed   the workerd smoke test");
    await checkCases(base, secrets.token);
    await checkRaces(base, secrets.token);
    await checkAlarm(base, secrets.token);
    await checkHibernation(base, secrets.token);
  } finally {
    try {
      // `wrangler delete` asks before it deletes, and the answer goes in on standard input.
      wrangler(dir, ["delete", "--name", NAME], [secrets.ring, secrets.token], "y\n");
      console.log(`deleted ${NAME}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

await main();
