// The opt-in live run of the Vercel Sandbox backend on a real Vercel account. It never runs in CI or under `pnpm test`:
// it does nothing unless HARNESS_VERCEL_LIVE=1 is set, and the owner runs it by hand.
//
//   HARNESS_VERCEL_LIVE=1 pnpm --filter @buildanagent/harness live:vercel-sandbox
//
// `@vercel/sandbox` finds its own credentials: the VERCEL_OIDC_TOKEN that `vercel env pull` writes for a linked
// project. This script never reads, prints or passes them on. The credential it injects is a canary it makes itself, a
// random value that is worth nothing, and it prints only check names and outcomes, with the canary scrubbed from every
// message. Each sandbox and snapshot it makes is deleted before it exits, and Vercel stops any sandbox it lost after ten
// minutes.
import { randomBytes } from "node:crypto";
import { Snapshot } from "@vercel/sandbox";
import type { EgressPolicy } from "../src/credentials/egress-policy.js";
import { resumeSandbox, snapshotSandbox } from "../src/sandbox/policy.js";
import type { ExecResult, Sandbox, SandboxPolicy } from "../src/sandbox/types.js";
import { vercelSandbox, vercelSandboxSdk } from "../src/sandbox/vercel/index.js";
import { runSandboxConformance } from "../src/testing/sandbox-conformance.js";

if (process.env.HARNESS_VERCEL_LIVE !== "1") {
  console.log("vercel-live: skipped; set HARNESS_VERCEL_LIVE=1 to run it against your Vercel account");
  process.exit(0);
}

const ROOT = "/vercel/sandbox/live";
const PREFIX = "harness-live-canary-";
const CANARY = `Bearer ${PREFIX}${randomBytes(16).toString("hex")}`;
const TEN_MINUTES = 10 * 60 * 1000;
const never = () => new AbortController().signal;
const scrub = (text: string) => text.replaceAll(CANARY, "[CANARY]").replaceAll(CANARY.slice(7), "[CANARY]");

const ECHO: EgressPolicy = {
  allow: ["example.com"],
  routes: [
    {
      kind: "header",
      route: "echo",
      host: "httpbin.org",
      methods: ["GET"],
      header: "authorization",
      credential: "LIVE_CANARY",
    },
  ],
};

const policy = (allow: readonly string[]): SandboxPolicy => ({
  readRoots: [ROOT],
  writeRoots: [ROOT],
  network: { allow, deny: [] },
});

const results: { name: string; ok: boolean; detail: string }[] = [];

async function check(name: string, body: () => Promise<string | undefined>): Promise<void> {
  try {
    const failure = await body();
    results.push({ name, ok: failure === undefined, detail: failure ?? "" });
  } catch (error) {
    results.push({
      name,
      ok: false,
      detail: scrub(error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
    });
  }
  const last = results[results.length - 1];
  console.log(`${last?.ok ? "PASS" : "FAIL"} ${name}${last?.detail ? ` (${last.detail})` : ""}`);
}

const exitOf = (result: ExecResult) => ("denied" in result ? -1 : result.exitCode);
const outOf = (result: ExecResult) => ("denied" in result ? "" : result.stdout);
const curl = (sandbox: Sandbox, args: string[]) =>
  sandbox.exec(["curl", "--silent", "--show-error", "--fail", "--max-time", "15", ...args], {
    env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    signal: never(),
    timeoutMs: 30_000,
  });

async function credentialChecks(sandbox: Sandbox): Promise<void> {
  await check("an allowed host is reached", async () => {
    const code = exitOf(await curl(sandbox, ["-o", "/dev/null", "https://example.com/"]));
    return code === 0 ? undefined : `curl exited ${code}`;
  });
  await check("a host the policy doesn't name is refused", async () => {
    const code = exitOf(await curl(sandbox, ["-o", "/dev/null", "https://example.org/"]));
    return code !== 0 ? undefined : "example.org was reached";
  });
  await check("the cloud metadata address is refused", async () => {
    const code = exitOf(await curl(sandbox, ["-o", "/dev/null", "http://169.254.169.254/latest/meta-data/"]));
    return code !== 0 ? undefined : "169.254.169.254 answered";
  });
  await check(
    "the firewall injects the credential on the route's method, and the output comes back scrubbed",
    async () => {
      const out = outOf(await curl(sandbox, ["https://httpbin.org/headers"]));
      if (out.includes(PREFIX)) return "the echoed credential reached the host unscrubbed";
      return /"Authorization":\s*"\[REDACTED\]"/.test(out) ? undefined : "no injected Authorization header came back";
    },
  );
  await check("a method the route doesn't list is refused", async () => {
    const code = exitOf(await curl(sandbox, ["-X", "POST", "-o", "/dev/null", "https://httpbin.org/post"]));
    return code !== 0 ? undefined : "a POST got through";
  });
  await check("the canary is in no variable or file inside the VM", async () => {
    const env = await sandbox.exec(["env"], { env: {}, signal: never() });
    if (outOf(env).includes(PREFIX)) return "a variable holds the canary";
    const grep = await sandbox.exec(["grep", "-rlsF", PREFIX, "/vercel", "/tmp", "/etc", "/home", "/root"], {
      env: { PATH: "/usr/bin:/bin" },
      signal: never(),
      timeoutMs: 120_000,
    });
    return exitOf(grep) === 1 ? undefined : `grep found it or failed (${exitOf(grep)})`;
  });
}

async function lifecycleChecks(client: ReturnType<typeof vercelSandbox>, sandbox: Sandbox): Promise<void> {
  await check("a command past its timeout ends with 124", async () => {
    const result = await sandbox.exec(["sleep", "30"], { env: {}, signal: never(), timeoutMs: 2000 });
    return exitOf(result) === 124 ? undefined : `exit ${exitOf(result)}`;
  });
  await check("a snapshot resumes into a sandbox that keeps its files", async () => {
    await sandbox.writeFile("kept.txt", new TextEncoder().encode("kept"));
    const id = await snapshotSandbox(client, sandbox);
    try {
      const resumed = await resumeSandbox(client, id, policy(["example.com", "httpbin.org"]));
      try {
        const kept = new TextDecoder().decode(await resumed.readFile("kept.txt"));
        return kept === "kept" ? undefined : "the file changed";
      } finally {
        await resumed.dispose();
      }
    } finally {
      // The snapshot outlives both sandboxes, so the run deletes it too.
      await (await Snapshot.get({ snapshotId: id.slice("snapshot:".length) })).delete();
    }
  });
}

async function main(): Promise<void> {
  const sdk = vercelSandboxSdk();
  const options = { sdk, timeoutMs: TEN_MINUTES };
  const client = vercelSandbox({ ...options, egress: ECHO, secret: async () => CANARY });
  const sandbox = await client.provision({ root: ROOT }, policy(["example.com", "httpbin.org"]));
  try {
    await check("provision read the firewall back and claims all three stops", async () =>
      sandbox.stops?.length === 3 ? undefined : `stops: ${sandbox.stops?.join(", ")}`,
    );
    await credentialChecks(sandbox);
    await lifecycleChecks(client, sandbox);
  } finally {
    await sandbox.dispose();
  }
  await check("a disposed sandbox is deleted", async () => {
    const found = await sdk.get({ name: sandbox.id ?? "" }).then(
      () => true,
      () => false,
    );
    return found ? "the sandbox still exists" : undefined;
  });
  await check("a policy with no host reaches nothing", async () => {
    const closed = await vercelSandbox(options).provision({ root: ROOT }, policy([]));
    try {
      const code = exitOf(await curl(closed, ["-o", "/dev/null", "https://example.com/"]));
      return code !== 0 ? undefined : "example.com was reached";
    } finally {
      await closed.dispose();
    }
  });
  await check("the sandbox conformance suite passes on real VMs", async () => {
    const report = await runSandboxConformance(() => ({ client: vercelSandbox(options), root: ROOT }), {
      network: {
        allowed: "example.com",
        blocked: "example.org",
        command: (host) => ["curl", "--silent", "--fail", "--max-time", "15", "-o", "/dev/null", `https://${host}/`],
      },
    });
    return report.failed.length === 0 ? undefined : report.failed.map((entry) => entry.name).join("; ");
  });
  const failed = results.filter((result) => !result.ok);
  console.log(`vercel-live: ${results.length - failed.length} passed, ${failed.length} failed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main().catch((error: unknown) => {
  console.log(
    `vercel-live: stopped: ${scrub(error instanceof Error ? `${error.name}: ${error.message}` : String(error))}`,
  );
  process.exitCode = 1;
});
