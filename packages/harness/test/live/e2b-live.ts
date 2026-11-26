// The opt-in live run of the E2B backend on a real E2B account. It never runs in CI or under `pnpm test`: it is not a
// `*.test.ts` file, and it exits at once unless HARNESS_E2B_LIVE=1. Run it from the repository root with
//
//   E2B_API_KEY=… pnpm --filter @buildanagent/harness e2b:live
//
// The script never reads, prints or passes the API key: it checks only that the variable is set, and the SDK reads it.
// It creates one throwaway secret with a random value, not a real credential, checks that E2B injects it, and deletes
// it at the end. Every sandbox it provisions is checked to be gone before it exits. It prints one line per check.
import { randomBytes } from "node:crypto";
import { Sandbox, Secret } from "e2b";
import { e2bSandbox } from "../../src/sandbox/e2b/index.js";
import { SandboxSecretUnresolvedError } from "../../src/sandbox/errors.js";
import type { Sandbox as HarnessSandbox, SandboxClient, SandboxPolicy } from "../../src/sandbox/types.js";
import { runEgressConformance } from "../../src/testing/egress-conformance.js";
import { runSandboxConformance } from "../../src/testing/sandbox-conformance.js";

const ROOT = "/home/user/workspace";
// Any public address works in place of DNS, because E2B routes an allowed name by its Host header or SNI.
const ANY_PUBLIC_ADDRESS = "1.1.1.1";

if (process.env.HARNESS_E2B_LIVE !== "1") {
  console.error("Set HARNESS_E2B_LIVE=1 to run the live E2B checks; they create sandboxes on your account.");
  process.exit(2);
}
if ((process.env.E2B_API_KEY ?? "") === "") {
  console.error("Set E2B_API_KEY; the script checks only that it is set and never reads it.");
  process.exit(2);
}

const sdk = { Sandbox, Secret };
const provisioned = new Set<string>();
const failures: string[] = [];

/** Records each sandbox a client provisions, so the run can check that every one was killed. */
function tracked(client: SandboxClient): SandboxClient & { last?: HarnessSandbox } {
  const wrapped: SandboxClient & { last?: HarnessSandbox } = {
    tier: client.tier,
    stops: client.stops,
    ...(client.capabilities === undefined ? {} : { capabilities: client.capabilities }),
    async provision(manifest, policy) {
      const sandbox = await client.provision(manifest, policy);
      if (sandbox.id !== undefined) provisioned.add(sandbox.id);
      wrapped.last = sandbox;
      return sandbox;
    },
    ...(client.resume === undefined ? {} : { resume: client.resume.bind(client) }),
  };
  return wrapped;
}

const curl = (url: string, host: string) => [
  "curl",
  "-sS",
  "-o",
  "/dev/null",
  "-w",
  "%{http_code}",
  "--max-time",
  "15",
  "--resolve",
  `${host}:443:${ANY_PUBLIC_ADDRESS}`,
  "--resolve",
  `${host}:80:${ANY_PUBLIC_ADDRESS}`,
  url,
];

function report(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail === "" ? "" : ` (${detail})`}`);
  if (!ok) failures.push(name);
}

async function conformance(): Promise<void> {
  const client = tracked(e2bSandbox({ sdk }));
  const result = await runSandboxConformance(() => ({ client, root: ROOT }), {
    network: {
      allowed: "example.com",
      blocked: "example.org",
      command: (host) => curl(`https://${host}/`, host),
    },
    processTree: {
      command: ["sh", "-c", "sleep 30 & echo $! > pid; wait"],
      isAlive: async (pid) => {
        const sandbox = client.last;
        if (sandbox === undefined) return false;
        const probe = await sandbox.exec(["kill", "-0", String(pid)], {
          env: { PATH: "/usr/bin:/bin" },
          signal: new AbortController().signal,
        });
        return !("denied" in probe) && probe.exitCode === 0;
      },
    },
  });
  for (const failed of result.failed) report(`sandbox conformance: ${failed.name}`, false, failed.error);
  report(
    "sandbox conformance",
    result.failed.length === 0,
    `${result.passed.length} passed, ${result.skipped.length} skipped`,
  );
}

async function egress(): Promise<void> {
  const client = tracked(e2bSandbox({ sdk }));
  const result = await runEgressConformance(async () => {
    const sandbox = await client.provision(
      { root: ROOT },
      { readRoots: [ROOT], writeRoots: [ROOT], network: { allow: ["example.com"], deny: [] } },
    );
    return {
      probe: async (url) => {
        const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
        const result = await sandbox.exec(curl(url, host), {
          env: { PATH: "/usr/bin:/bin" },
          signal: new AbortController().signal,
        });
        const allowed = !("denied" in result) && result.exitCode === 0 && /^[1-5][0-9][0-9]$/.test(result.stdout);
        return { allowed, detail: "denied" in result ? "denied" : `exit ${result.exitCode}` };
      },
      allowedUrl: "https://example.com/",
      dispose: () => sandbox.dispose(),
    };
  });
  for (const failed of result.failed) report(`egress conformance: ${failed.name}`, false, failed.error);
  report("egress conformance", result.failed.length === 0, `${result.passed.length} passed`);
}

async function injection(secretName: string, value: string): Promise<void> {
  const route = {
    kind: "header",
    route: "echo",
    host: "httpbin.org",
    methods: ["GET"],
    header: "x-harness-live",
    credential: "HARNESS_LIVE_TOKEN",
  } as const;
  const client = tracked(
    e2bSandbox({
      sdk,
      egress: { allow: [], routes: [route] },
      unscopedInjection: true,
      secretName: () => secretName,
    }),
  );
  const policy: SandboxPolicy = {
    readRoots: [ROOT],
    writeRoots: [ROOT],
    network: { allow: ["httpbin.org"], deny: [] },
  };
  const sandbox = await client.provision({ root: ROOT }, policy);
  try {
    const printed = await sandbox.exec(["env"], {
      env: { PATH: "/usr/bin:/bin" },
      signal: new AbortController().signal,
    });
    report(
      "the throwaway secret is not in the sandbox's environment",
      !("denied" in printed) && !printed.stdout.includes(value),
    );
    // httpbin echoes the request's headers, so the throwaway value comes back into the sandbox here, by design.
    const echoed = await sandbox.exec(
      [
        "curl",
        "-sS",
        "--max-time",
        "15",
        "--resolve",
        `httpbin.org:443:${ANY_PUBLIC_ADDRESS}`,
        "https://httpbin.org/headers",
      ],
      { env: { PATH: "/usr/bin:/bin" }, signal: new AbortController().signal },
    );
    report("E2B injects the secret on HTTPS to its host", !("denied" in echoed) && echoed.stdout.includes(value));
    const plain = await sandbox.exec(
      [
        "curl",
        "-sS",
        "--max-time",
        "15",
        "--resolve",
        `httpbin.org:80:${ANY_PUBLIC_ADDRESS}`,
        "http://httpbin.org/headers",
      ],
      { env: { PATH: "/usr/bin:/bin" }, signal: new AbortController().signal },
    );
    report("E2B adds nothing on plain HTTP", !("denied" in plain) && !plain.stdout.includes(value));
  } finally {
    await sandbox.dispose();
  }
}

async function unresolved(): Promise<void> {
  const route = {
    kind: "header",
    route: "echo",
    host: "httpbin.org",
    methods: ["GET"],
    header: "x-harness-live",
    credential: "HARNESS_LIVE_TOKEN",
  } as const;
  const missing = `buildanagent-missing-${randomBytes(8).toString("hex")}`;
  const client = tracked(
    e2bSandbox({ sdk, egress: { allow: [], routes: [route] }, unscopedInjection: true, secretName: () => missing }),
  );
  const outcome = await client
    .provision({ root: ROOT }, { readRoots: [ROOT], writeRoots: [ROOT], network: { allow: ["httpbin.org"], deny: [] } })
    .then(
      async (sandbox) => {
        await sandbox.dispose();
        return undefined;
      },
      (error: unknown) => error,
    );
  report(
    "a secret that doesn't exist fails provisioning with SandboxSecretUnresolvedError",
    outcome instanceof SandboxSecretUnresolvedError && outcome.secret === missing,
  );
}

async function leaks(): Promise<void> {
  const alive: string[] = [];
  for (const id of provisioned) {
    const info = await Sandbox.getInfo(id).catch(() => undefined);
    if (info !== undefined && info.state === "running") alive.push(id);
  }
  report("every sandbox the run provisioned is gone", alive.length === 0, `${provisioned.size} provisioned`);
}

const secretName = `buildanagent-live-${randomBytes(8).toString("hex")}`;
const value = `live-${randomBytes(24).toString("hex")}`;
await Secret.create(secretName, value);
try {
  await unresolved();
  await injection(secretName, value);
  await egress();
  await conformance();
} catch (error) {
  // The message of an SDK error names a request, never the API key or the secret's value.
  report("the run finished", false, error instanceof Error ? error.name : "unknown error");
} finally {
  await Secret.destroy(secretName).catch(() => report("the throwaway secret was deleted", false));
  await leaks();
}
console.log(failures.length === 0 ? "\nAll live checks passed." : `\n${failures.length} live checks failed.`);
process.exit(failures.length === 0 ? 0 : 1);
