import assert from "node:assert/strict";
import type { EgressPolicy } from "@buildanagent/harness/credentials";
import {
  confirmPolicy,
  pauseSandbox,
  resumeSandbox,
  type Sandbox,
  type SandboxPolicy,
  SandboxPolicyMismatchError,
  SandboxSecretUnresolvedError,
  SandboxUnavailableError,
} from "@buildanagent/harness/sandbox";
import {
  compileE2BEgress,
  E2B_PROVISION_LABEL,
  type E2BSandboxOptions,
  e2bSandbox,
} from "@buildanagent/harness/sandbox/e2b";
import {
  EGRESS_DENIED_TARGETS,
  type EgressFactory,
  runEgressConformance,
  runPortabilityConformance,
  runSandboxConformance,
  type SandboxFactory,
  sandboxConformanceCases,
} from "@buildanagent/harness/testing";
import { test } from "vitest";
import { bytes, FakeE2B, type FakeE2BOptions } from "./fake-e2b.js";

// The E2B backend against an in-process fake of the SDK (fake-e2b.ts), which plays E2B's firewall and egress proxy as
// its docs describe. Nothing here reaches E2B. The opt-in live run on a real account is test/live/e2b-live.ts.
const ROOT = "/home/user/workspace";
const SECRET_VALUE = "ghp_e2bfakesecretvalue0123456789abcdefghij";
const API_KEY = "e2b_fakeapikey0123456789abcdef";
const decoder = new TextDecoder();
const never = () => new AbortController().signal;

const policyFor = (allow: readonly string[]): SandboxPolicy => ({
  readRoots: [ROOT],
  writeRoots: [ROOT],
  network: { allow: [...allow], deny: [] },
});

const curl = (url: string, ...extra: string[]) => [
  "curl",
  "-sS",
  ...extra,
  "-o",
  "/dev/null",
  "-w",
  "%{http_code}",
  "--max-time",
  "5",
  url,
];

/** A fake and a client on it. */
function setup(fakeOptions: FakeE2BOptions = {}, clientOptions: Omit<E2BSandboxOptions, "sdk"> = {}) {
  const fake = new FakeE2B(fakeOptions);
  const client = e2bSandbox({ sdk: fake.sdk, ...clientOptions });
  return { fake, client };
}

/** Runs `curl` in the sandbox and says whether the host answered. */
async function reaches(sandbox: Sandbox, url: string, ...extra: string[]): Promise<boolean> {
  const result = await sandbox.exec(curl(url, ...extra), { env: {}, signal: never() });
  return !("denied" in result) && result.exitCode === 0 && result.stdout === "200";
}

const codeOf = (error: unknown) => (error as { code?: string }).code;
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

const githubPolicy: EgressPolicy = {
  allow: ["registry.npmjs.org"],
  routes: [
    {
      kind: "header",
      route: "github",
      host: "api.github.com",
      methods: ["GET"],
      header: "authorization",
      credential: "GITHUB_TOKEN",
    },
  ],
};
const githubAllow = ["registry.npmjs.org", "api.github.com"];

// The conformance suites, run on the fake.

const network = {
  allowed: "allowed.test",
  blocked: "blocked.test",
  command: (host: string) => curl(`https://${host}/`),
};
const sandboxFactory: SandboxFactory = () => ({ client: setup().client, root: ROOT });

for (const conformance of sandboxConformanceCases(sandboxFactory, { network })) {
  test(`E2B on the fake: ${conformance.name}`, async (context) => {
    const outcome = await conformance.run();
    if (outcome !== undefined) context.skip(outcome.skipped);
  });
}

/** Provisions a sandbox that allows `allowed.test` only, and probes a URL with curl inside it. */
const egressFactory: EgressFactory = async () => {
  const { client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor(["allowed.test"]));
  return {
    probe: async (url) => ({ allowed: await reaches(sandbox, url), detail: url }),
    allowedUrl: "https://allowed.test/",
    dispose: () => sandbox.dispose(),
  };
};

test("E2B passes the portability suite's sandbox and egress seams, skipping only the cases with no fake to run", async () => {
  const report = await runPortabilityConformance({
    sandbox: { factory: sandboxFactory, options: { network } },
    egress: egressFactory,
  });
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.skipped.map((skip) => skip.name).sort(), [
    "sandbox: a symlink in the workspace that points outside it is denied for reads and writes",
    "sandbox: an abort and a timeout end the command's whole process tree, and exec settles",
  ]);
  const sandbox = await runSandboxConformance(sandboxFactory, { network });
  assert.deepEqual(sandbox.failed, []);
  const egress = await runEgressConformance(egressFactory);
  assert.deepEqual(egress.failed, []);
  assert.equal(egress.passed.length, EGRESS_DENIED_TARGETS.length + 2);
});

// Egress is deny-all by default, and allowOut is exactly the policy's hosts.

test("a sandbox is created with allowOut exactly the policy's hosts, every other address denied and no DNS server", async () => {
  const { fake, client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor(["allowed.test", "example.org"]));
  const [create] = fake.log.creates;
  assert.deepEqual(create?.opts.network, {
    allowOut: ["allowed.test", "example.org"],
    denyOut: ["0.0.0.0/0"],
    dnsServers: [],
  });
  assert.equal(create?.opts.lifecycle.onTimeout, "kill");
  assert.equal(create?.opts.timeoutMs, 15 * 60 * 1000);
  assert.equal(create?.template, "base");
  await sandbox.dispose();
});

test("a policy with no hosts reaches nothing, a package registry and E2B's DNS server included", async () => {
  const { client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor([]));
  for (const url of [
    "https://registry.npmjs.org/",
    "https://pypi.org/simple/",
    "http://8.8.8.8/",
    "https://1.1.1.1/",
    "http://example.com/",
  ]) {
    assert.equal(await reaches(sandbox, url), false, url);
  }
  await sandbox.dispose();
});

test("an allowed domain opens only that name: not its subdomains, its parent, other ports or the default DNS server", async () => {
  const { client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor(["api.example.com"]));
  assert.equal(await reaches(sandbox, "https://api.example.com/"), true);
  for (const url of [
    "https://evil.api.example.com/",
    "https://example.com/",
    "https://api.example.com:8443/",
    "http://8.8.8.8:53/",
    "https://registry.npmjs.org/",
  ]) {
    assert.equal(await reaches(sandbox, url), false, url);
  }
  await sandbox.dispose();
});

test("provision refuses what E2B would widen: a wildcard, an address, a range, a port, upper case and a deny list", async () => {
  const { fake, client } = setup();
  for (const entry of [
    "*",
    "*.example.com",
    "0.0.0.0/0",
    "169.254.169.254",
    "8.8.8.8",
    "::/0",
    "[::1]",
    "example.com:8443",
    "Example.com",
    "",
  ]) {
    const error = await rejection(client.provision({ root: ROOT }, policyFor([entry])));
    assert.equal(codeOf(error), "invalid_sandbox_options", entry);
    assert.ok(!String((error as Error).message).includes(entry) || entry === "", `the message must not quote ${entry}`);
  }
  const deny = await rejection(
    client.provision(
      { root: ROOT },
      { ...policyFor(["example.com"]), network: { allow: ["example.com"], deny: ["x.example.com"] } },
    ),
  );
  assert.equal(codeOf(deny), "invalid_sandbox_options");
  assert.equal(fake.log.creates.length, 0, "nothing is created for a refused policy");
});

test("provision refuses a workspace outside the write roots, and roots that aren't absolute or normal", async () => {
  const { fake, client } = setup();
  const cases: [string, SandboxPolicy][] = [
    ["/elsewhere", policyFor([])],
    [ROOT, { ...policyFor([]), writeRoots: ["relative"] }],
    [ROOT, { ...policyFor([]), readRoots: ["/a/../b"] }],
    ["/", { ...policyFor([]), writeRoots: ["/"] }],
  ];
  for (const [root, policy] of cases) {
    assert.equal(codeOf(await rejection(client.provision({ root }, policy))), "invalid_sandbox_options", root);
  }
  assert.equal(fake.log.creates.length, 0);
});

// Credentials go in as placeholders, E2B's proxy resolves them outside the sandbox, and a missing secret fails provisioning.

test("an egress route becomes a rule on its host whose header is the secret's placeholder, never its value", async () => {
  const { fake, client } = setup(
    { secrets: { github_token: SECRET_VALUE } },
    { egress: githubPolicy, unscopedInjection: true, schemes: { GITHUB_TOKEN: "Bearer" } },
  );
  const sandbox = await client.provision({ root: ROOT }, policyFor(githubAllow));
  const network = fake.log.creates[0]?.opts.network;
  assert.deepEqual(network?.allowOut, ["registry.npmjs.org", "api.github.com"]);
  assert.deepEqual(network?.rules, {
    "api.github.com": [{ transform: { headers: { authorization: `Bearer ${"$"}{e2b.secrets.github_token}` } } }],
  });
  assert.deepEqual(fake.log.exists, ["github_token"]);
  assert.equal(await reaches(sandbox, "https://api.github.com/user"), true);
  const received = fake.log.received.at(-1);
  assert.equal(
    received?.headers.authorization,
    `Bearer ${SECRET_VALUE}`,
    "the host outside the sandbox got the credential",
  );
  await sandbox.dispose();
});

test("no credential value crosses into the sandbox: not in the create request, a command, its environment or a file", async () => {
  const { fake, client } = setup(
    { secrets: { github_token: SECRET_VALUE } },
    { egress: githubPolicy, unscopedInjection: true, apiKey: API_KEY },
  );
  const sandbox = await client.provision({ root: ROOT, files: { "README.md": "hello" } }, policyFor(githubAllow));
  await reaches(sandbox, "https://api.github.com/user");
  const printed = await sandbox.exec(["env"], { env: { LANG: "C.UTF-8" }, signal: never() });
  assert.ok(!("denied" in printed));
  const everything = JSON.stringify({
    creates: fake.log.creates.map(({ template, opts }) => ({
      template,
      network: opts.network,
      metadata: opts.metadata,
    })),
    runs: fake.log.runs,
    writes: fake.log.writes.map((write) => ({ path: write.path, data: decoder.decode(write.data) })),
    printed,
  });
  assert.ok(!everything.includes(SECRET_VALUE), "a secret's value reached the sandbox");
  assert.ok(!everything.includes(API_KEY), "the E2B API key reached the sandbox");
  assert.ok(!JSON.stringify(fake.log.creates.map(({ opts }) => opts.network)).includes(SECRET_VALUE));
  await sandbox.dispose();
});

test("a secret that doesn't exist fails provisioning with a typed error naming it, and no sandbox is created", async () => {
  const { fake, client } = setup({ secrets: {} }, { egress: githubPolicy, unscopedInjection: true });
  const error = await rejection(client.provision({ root: ROOT }, policyFor(githubAllow)));
  assert.ok(error instanceof SandboxSecretUnresolvedError);
  assert.equal(error.code, "sandbox_secret_unresolved");
  assert.equal(error.secret, "github_token");
  assert.equal(error.credential, "GITHUB_TOKEN");
  assert.equal(error.backend, "e2b");
  assert.match(error.message, /github_token/);
  assert.equal(fake.log.creates.length, 0);
  assert.deepEqual(fake.held(), []);
});

test("without the check, E2B would have sent the request with the header silently dropped", async () => {
  // This plays what the check prevents: the fake's proxy forwards the request and drops the unresolved header, the
  // sandbox's own header of that name included, as E2B's secrets page documents.
  const fake = new FakeE2B({ secrets: { github_token: SECRET_VALUE } });
  const client = e2bSandbox({ sdk: fake.sdk, egress: githubPolicy, unscopedInjection: true });
  const sandbox = await client.provision({ root: ROOT }, policyFor(githubAllow));
  fake.deleteSecret("github_token");
  assert.equal(await reaches(sandbox, "https://api.github.com/user", "-H", "Authorization: Bearer forged"), true);
  assert.equal(fake.log.received.at(-1)?.headers.authorization, undefined);
  await sandbox.dispose();
  // The next provision finds the secret gone and refuses.
  assert.ok(
    (await rejection(client.provision({ root: ROOT }, policyFor(githubAllow)))) instanceof SandboxSecretUnresolvedError,
  );
});

test("a secrets API that can't answer fails provisioning as unavailable, and creates nothing", async () => {
  const { fake, client } = setup(
    { existsFails: true, secrets: { github_token: SECRET_VALUE } },
    { egress: githubPolicy, unscopedInjection: true },
  );
  const error = await rejection(client.provision({ root: ROOT }, policyFor(githubAllow)));
  assert.ok(error instanceof SandboxUnavailableError);
  assert.equal(fake.log.creates.length, 0);
});

test("a credential is injected only on HTTPS to its own host, not on plain HTTP and not on another allowed host", async () => {
  const { fake, client } = setup(
    { secrets: { github_token: SECRET_VALUE } },
    { egress: githubPolicy, unscopedInjection: true },
  );
  const sandbox = await client.provision({ root: ROOT }, policyFor(githubAllow));
  await reaches(sandbox, "http://api.github.com/");
  await reaches(sandbox, "https://registry.npmjs.org/");
  for (const request of fake.log.received) assert.equal(request.headers.authorization, undefined, request.host);
  await sandbox.dispose();
});

test("compileE2BEgress refuses what E2B can't scope: a git route, a route without unscopedInjection, ports and bad names", () => {
  const fill = (name: string) => `\${e2b.secrets.${name}}`;
  const refused = (policy: EgressPolicy, extra: object = {}) => {
    try {
      compileE2BEgress(policy, { fill, unscopedInjection: true, ...extra });
      return undefined;
    } catch (error) {
      return codeOf(error);
    }
  };
  const header = githubPolicy.routes[0];
  assert.ok(header !== undefined);
  assert.equal(refused(githubPolicy, { unscopedInjection: false }), "invalid_egress_options");
  assert.equal(
    refused({
      allow: [],
      routes: [
        {
          kind: "git",
          route: "git",
          host: "github.com",
          repositories: ["a/b"],
          fetch: true,
          credential: "GITHUB_TOKEN",
        },
      ],
    }),
    "invalid_egress_options",
  );
  assert.equal(refused({ allow: ["example.com:8443"], routes: [] }), "invalid_egress_options");
  assert.equal(refused({ allow: ["*.example.com"], routes: [] }), "invalid_egress_options");
  assert.equal(refused({ allow: ["169.254.169.254"], routes: [] }), "invalid_egress_options");
  assert.equal(refused({ allow: [], routes: [{ ...header, host: "api.github.com:444" }] }), "invalid_egress_options");
  assert.equal(refused(githubPolicy, { secretName: () => "sec_github" }), "invalid_egress_options");
  assert.equal(refused(githubPolicy, { secretName: () => "a{b}" }), "invalid_egress_options");
  assert.equal(refused({ allow: [], routes: [header, { ...header, route: "github2" }] }), "invalid_egress_options");
  // A pasted token is refused by the shared checks, whatever field holds it.
  assert.equal(refused({ allow: [SECRET_VALUE], routes: [] }), "invalid_egress_options");
  assert.equal(
    refused({ allow: [], routes: [{ ...header, secret: SECRET_VALUE } as never] }),
    "invalid_egress_options",
  );
});

test("an egress policy whose hosts aren't exactly the policy's network.allow is refused before anything is created", async () => {
  const { fake, client } = setup(
    { secrets: { github_token: SECRET_VALUE } },
    { egress: githubPolicy, unscopedInjection: true },
  );
  for (const allow of [["api.github.com"], [...githubAllow, "extra.example.com"]]) {
    assert.equal(
      codeOf(await rejection(client.provision({ root: ROOT }, policyFor(allow)))),
      "invalid_sandbox_options",
    );
  }
  assert.equal(fake.log.creates.length, 0);
});

// The read-back: what E2B reports must be what was asked for.

const widenings: [string, FakeE2BOptions, string][] = [
  ["a provider that drops the deny-all", { reported: (n) => ({ ...(n as object), denyOut: [] }) }, "network.allow"],
  [
    "a provider that adds a host",
    { reported: (n) => ({ ...(n as object), allowOut: ["allowed.test", "x.test"] }) },
    "network.allow",
  ],
  [
    "a provider that opens its default DNS server",
    { reported: (n) => ({ ...(n as object), dnsServers: undefined }) },
    "network.allow",
  ],
  [
    "a provider that denies a range besides all traffic",
    { reported: (n) => ({ ...(n as object), denyOut: ["0.0.0.0/0", "10.0.0.0/8"] }) },
    "network.deny",
  ],
  [
    "a provider that tunnels through a proxy",
    { reported: (n) => ({ ...(n as object), egressProxy: { address: "proxy.example:1080" } }) },
    "egress.proxy",
  ],
  [
    "a provider that adds a rule",
    {
      reported: (n) => ({
        ...(n as object),
        rules: { "allowed.test": [{ transform: { headers: { authorization: SECRET_VALUE } } }] },
      }),
    },
    "egress.rules",
  ],
];

for (const [label, fakeOptions, field] of widenings) {
  test(`${label} fails provisioning with sandbox_policy_mismatch in ${field}, and the sandbox is killed`, async () => {
    const { fake, client } = setup(fakeOptions);
    const error = await rejection(client.provision({ root: ROOT }, policyFor(["allowed.test"])));
    assert.ok(error instanceof SandboxPolicyMismatchError, String(error));
    assert.equal(error.field, field);
    assert.ok(!error.message.includes(SECRET_VALUE) && !error.message.includes("x.test"));
    assert.deepEqual(fake.held(), [], "the mismatched sandbox is killed");
  });
}

test("a rule E2B reports with a value in place of the placeholder fails the read-back", async () => {
  const { fake, client } = setup(
    {
      secrets: { github_token: SECRET_VALUE },
      reported: (n) => ({
        ...(n as object),
        rules: { "api.github.com": [{ transform: { headers: { authorization: SECRET_VALUE } } }] },
      }),
    },
    { egress: githubPolicy, unscopedInjection: true },
  );
  const error = await rejection(client.provision({ root: ROOT }, policyFor(githubAllow)));
  assert.equal((error as SandboxPolicyMismatchError).field, "egress.rules");
  assert.deepEqual(fake.held(), []);
});

test("a provider that applies a wider network than it was sent is caught, because its report is read, not the request", async () => {
  const { fake, client } = setup({ applied: (sent) => ({ ...sent, denyOut: [] }) });
  const error = await rejection(client.provision({ root: ROOT }, policyFor(["allowed.test"])));
  assert.equal((error as SandboxPolicyMismatchError).field, "network.allow");
  assert.deepEqual(fake.held(), []);
});

// A sandbox that fails or is disposed is never left running.

test("a create whose reply is lost is swept by its label and killed", async () => {
  const { fake, client } = setup({ createFails: "after" });
  const error = await rejection(client.provision({ root: ROOT }, policyFor([])));
  assert.ok(error instanceof SandboxUnavailableError);
  assert.equal(fake.log.lists, 1);
  assert.deepEqual(fake.held(), []);
  const label = fake.log.creates[0]?.opts.metadata[E2B_PROVISION_LABEL];
  assert.match(label ?? "", /^[0-9a-f]{32}$/);
});

test("a create that fails outright leaves nothing, and a failed sweep still throws unavailable", async () => {
  for (const options of [{ createFails: "before" }, { createFails: "after", listFails: true }] as const) {
    const { client } = setup(options);
    assert.ok((await rejection(client.provision({ root: ROOT }, policyFor([])))) instanceof SandboxUnavailableError);
  }
});

test("a manifest write or a read-back that fails kills the new sandbox", async () => {
  for (const options of [{ writeFails: true }, { infoFails: true }] as const) {
    const { fake, client } = setup(options);
    const error = await rejection(client.provision({ root: ROOT, files: { "a.txt": "a" } }, policyFor([])));
    assert.ok(error instanceof Error);
    assert.deepEqual(fake.held(), [], JSON.stringify(options));
  }
});

test("dispose tries a failed kill again, and rejects when the kill never succeeds", async () => {
  const twice = setup({ killFailures: 2 });
  const sandbox = await twice.client.provision({ root: ROOT }, policyFor([]));
  await sandbox.dispose();
  assert.deepEqual(twice.fake.held(), []);
  assert.equal(twice.fake.log.kills.length, 3);

  const stuck = setup({ killFailures: 10 });
  const kept = await stuck.client.provision({ root: ROOT }, policyFor([]));
  const error = await rejection(kept.dispose());
  assert.equal(codeOf(error), "sandbox_io_failed");
  assert.equal(await rejection(kept.dispose()), error, "a second dispose gets the first one's outcome");
});

test("a paused sandbox that is disposed is killed, and a resume reattaches only after its secrets are checked", async () => {
  const { fake, client } = setup(
    { secrets: { github_token: SECRET_VALUE } },
    { egress: githubPolicy, unscopedInjection: true },
  );
  const policy = policyFor(githubAllow);
  const sandbox = await client.provision({ root: ROOT }, policy);
  await sandbox.writeFile("kept.txt", bytes("kept"));
  await pauseSandbox(client, sandbox);
  assert.equal(codeOf(await rejection(sandbox.readFile("kept.txt"))), "invalid_sandbox_options");
  fake.deleteSecret("github_token");
  const missing = await rejection(resumeSandbox(client, sandbox.id ?? "", policy));
  assert.ok(missing instanceof SandboxSecretUnresolvedError);
  assert.deepEqual(fake.log.connects, [], "a resume whose secret is gone doesn't wake the sandbox");
  assert.equal(fake.vms.get(sandbox.id ?? "")?.state, "paused");
  await sandbox.dispose();
  assert.deepEqual(fake.held(), []);
});

test("a resume of a sandbox with no recorded workspace pauses it again and throws", async () => {
  const { fake, client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor([]));
  const vm = fake.vms.get(sandbox.id ?? "");
  assert.ok(vm !== undefined);
  delete vm.metadata["buildanagent-root"];
  await pauseSandbox(client, sandbox);
  assert.equal(codeOf(await rejection(resumeSandbox(client, vm.id, policyFor([])))), "invalid_sandbox_options");
  assert.equal(vm.state, "paused");
  await sandbox.dispose();
});

test("a resumed sandbox's read-back is checked, and a wider one throws without killing it", async () => {
  const { fake, client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor(["allowed.test"]));
  const error = await rejection(resumeSandbox(client, sandbox.id ?? "", policyFor(["allowed.test", "x.test"])));
  assert.equal((error as SandboxPolicyMismatchError).field, "network.allow");
  assert.deepEqual(fake.held(), [sandbox.id]);
  await sandbox.dispose();
});

// What a command and a file call can't do.

test("the E2B API key is refused in a command, its environment and a file, and the message never quotes it", async () => {
  const { fake, client } = setup({}, { apiKey: API_KEY });
  const sandbox = await client.provision({ root: ROOT }, policyFor([]));
  const attempts = [
    () => sandbox.exec(["echo", `key=${API_KEY}`], { env: {}, signal: never() }),
    () => sandbox.exec(["env"], { env: { E2B_API_KEY: API_KEY }, signal: never() }),
    () => sandbox.writeFile("leak.txt", bytes(`token ${API_KEY}`)),
  ];
  for (const attempt of attempts) {
    const error = await rejection(attempt());
    assert.equal(codeOf(error), "invalid_sandbox_options");
    assert.ok(!String((error as Error).message).includes(API_KEY));
  }
  assert.ok(!JSON.stringify(fake.log.runs).includes(API_KEY));
  await sandbox.dispose();
});

test("a command's environment values travel in envs and never on its command line", async () => {
  const { fake, client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor([]));
  await sandbox.exec(["env"], { env: { MARKER: "value-on-the-wire" }, signal: never() });
  const run = fake.log.runs.at(-1);
  assert.equal(run?.envs.MARKER, "value-on-the-wire");
  assert.ok(!run?.cmd.includes("value-on-the-wire"));
  assert.match(run?.cmd ?? "", /exec 'env'$/);
  await sandbox.dispose();
});

test("quoting holds: an argument with quotes, $ and ; runs as one word and starts nothing else", async () => {
  const { client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor([]));
  const word = `it's $(touch /tmp/x); "quoted" \`id\``;
  const result = await sandbox.exec(["echo", word], { env: {}, signal: never() });
  assert.ok(!("denied" in result));
  assert.equal(result.stdout, `${word}\n`);
  assert.equal(
    codeOf(await rejection(sandbox.exec(["echo", "a\0b"], { env: {}, signal: never() }))),
    "invalid_sandbox_options",
  );
  assert.equal(
    codeOf(await rejection(sandbox.exec(["env"], { env: { "A;B": "1" }, signal: never() }))),
    "invalid_sandbox_options",
  );
  await sandbox.dispose();
});

test("a timeout and an abort kill the command in E2B, so nothing keeps running", async () => {
  const { fake, client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor([]));
  const vm = fake.vms.get(sandbox.id ?? "");
  const timed = await sandbox.exec(["sleep", "30"], { env: {}, signal: never(), timeoutMs: 50 });
  assert.ok(!("denied" in timed) && timed.timedOut === true && timed.exitCode === 124);
  assert.equal(vm?.processes.size, 0, "the timed-out command still runs");
  const controller = new AbortController();
  const aborted = rejection(sandbox.exec(["sleep", "30"], { env: {}, signal: controller.signal }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort(new Error("stop"));
  assert.match(String(await aborted), /stop/);
  assert.equal(vm?.processes.size, 0, "the aborted command still runs");
  await sandbox.dispose();
});

test("output past the cap is cut and flagged", async () => {
  const { client } = setup();
  const sandbox = await client.provision({ root: ROOT }, policyFor([]));
  const result = await sandbox.exec(["echo", "0123456789"], { env: {}, signal: never(), maxOutputBytes: 4 });
  assert.ok(!("denied" in result));
  assert.equal(result.stdout, "0123");
  assert.equal(result.truncated, true);
  await sandbox.dispose();
});

test("the client claims all three stops for a microVM, and a sandbox's stops come from the confirmed read-back", async () => {
  const { client } = setup();
  assert.equal(client.tier, "microvm");
  assert.deepEqual([...client.stops].sort(), ["exfiltration", "hostile_process", "mistakes"]);
  assert.deepEqual(client.capabilities, ["resume", "pause"]);
  const sandbox = await client.provision({ root: ROOT }, policyFor(["allowed.test"]));
  assert.deepEqual([...(sandbox.stops ?? [])].sort(), ["exfiltration", "hostile_process", "mistakes"]);
  const error = await rejection(confirmPolicy(client, sandbox, policyFor(["allowed.test", "x.test"])));
  assert.equal(codeOf(error), "sandbox_policy_mismatch");
});

test("a missing e2b package or an sdk without the needed calls makes the backend unavailable", async () => {
  const missing = e2bSandbox({
    sdk: () => Promise.reject(Object.assign(new Error("Cannot find package 'e2b'"), { code: "ERR_MODULE_NOT_FOUND" })),
  });
  assert.ok((await rejection(missing.provision({ root: ROOT }, policyFor([])))) instanceof SandboxUnavailableError);
  const empty = e2bSandbox({ sdk: {} as never });
  assert.ok((await rejection(empty.provision({ root: ROOT }, policyFor([])))) instanceof SandboxUnavailableError);
  assert.equal(codeOf(rejection(Promise.resolve())), undefined);
  assert.throws(() => e2bSandbox({ timeoutMs: 10 }), /timeoutMs/);
  assert.throws(() => e2bSandbox({ template: "" }), /template/);
});
