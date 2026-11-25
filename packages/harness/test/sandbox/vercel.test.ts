// The Vercel Sandbox backend, offline, against an in-process fake of `@vercel/sandbox`: the portability suite's sandbox
// and egress seams, then a test for each rule that keeps a credential outside the VM, keeps egress closed to what the
// policy names, and never leaves a sandbox running.
import assert from "node:assert/strict";
import type { EgressPolicy } from "@buildanagent/harness/credentials";
import {
  resumeSandbox,
  type Sandbox,
  type SandboxPolicy,
  SandboxPolicyMismatchError,
  SandboxUnavailableError,
  snapshotSandbox,
} from "@buildanagent/harness/sandbox";
import {
  checkVercelNetworkPolicy,
  VERCEL_DENIED_SUBNETS,
  type VercelSandboxInstance,
  type VercelSandboxOptions,
  VercelSecretError,
  vercelSandbox,
} from "@buildanagent/harness/sandbox/vercel";
import { type EgressFactory, runPortabilityConformance } from "@buildanagent/harness/testing";
import type { NetworkPolicy, Sandbox as VercelSdkSandbox } from "@vercel/sandbox";
import { describe, test } from "vitest";
import { type FakeVercel, type FakeVercelOptions, fakeVercel, sentIntoVms } from "./fake-vercel.js";

const ROOT = "/vercel/sandbox/ws";
const SECRET = "Bearer ghp_live_value_that_must_stay_outside_0123456789";
const never = () => new AbortController().signal;
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const bytes = (value: string) => new TextEncoder().encode(value);

// The real class must fit the interface the backend takes, so the default client and the fake are interchangeable.
const _real: VercelSandboxInstance = null as unknown as VercelSdkSandbox;
void _real;

function names(): () => string {
  let next = 0;
  return () => `harness-test-${++next}`;
}

function policy(allow: readonly string[] = [], root = ROOT): SandboxPolicy {
  return { readRoots: [root], writeRoots: [root], network: { allow, deny: [] } };
}

function backend(fake: FakeVercel, options: Omit<VercelSandboxOptions, "sdk"> = {}) {
  return vercelSandbox({ sdk: fake.sdk, name: names(), ...options });
}

const GITHUB: EgressPolicy = {
  allow: [],
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

async function withGithub(options: FakeVercelOptions = {}) {
  const fake = fakeVercel(options);
  const client = backend(fake, { egress: GITHUB, secret: async () => SECRET });
  const sandbox = await client.provision({ root: ROOT }, policy(["api.github.com"]));
  return { fake, client, sandbox };
}

/** Runs `command` and returns its finished result, failing on a denial. */
async function run(sandbox: Sandbox, command: string[], env: Record<string, string> = {}) {
  const result = await sandbox.exec(command, { env, signal: never() });
  assert.ok(!("denied" in result), "the command must not be denied");
  return result;
}

const rejection = (work: Promise<unknown>) =>
  work.then(
    () => undefined,
    (error: unknown) => error,
  );

describe("the portability suite's sandbox and egress seams", () => {
  const vercelEgress: EgressFactory = async () => {
    const fake = fakeVercel();
    const sandbox = await backend(fake).provision({ root: ROOT }, policy(["allowed.example.invalid"]));
    return {
      allowedUrl: "https://allowed.example.invalid/",
      probe: async (url) => {
        const result = await sandbox.exec(["net-probe", url], { env: {}, signal: never() });
        const reached = !("denied" in result) && result.exitCode === 0;
        return { allowed: reached, detail: "denied" in result ? result.denied.reason : result.stderr };
      },
      dispose: () => sandbox.dispose(),
    };
  };

  test("the Vercel backend passes every case but the process tree, which needs a real VM", async () => {
    const report = await runPortabilityConformance({
      sandbox: {
        factory: () => {
          const fake = fakeVercel();
          return { client: backend(fake), root: ROOT, symlink: (link, target) => fake.symlink(link, target) };
        },
        options: {
          network: {
            allowed: "allowed.test",
            blocked: "blocked.test",
            command: (host) => ["net-probe", `https://${host}/`],
          },
        },
      },
      egress: vercelEgress,
    });
    assert.deepEqual(report.failed, []);
    assert.deepEqual(
      report.skipped.map((entry) => entry.name),
      ["sandbox: an abort and a timeout end the command's whole process tree, and exec settles"],
    );
    assert.ok(report.passed.length >= 25, `expected at least 25 passing cases, got ${report.passed.length}`);
  });

  test("the persistent backend also passes the pause case", async () => {
    const report = await runPortabilityConformance({
      sandbox: () => {
        const fake = fakeVercel();
        return { client: backend(fake, { persistent: true }), root: ROOT };
      },
    });
    assert.deepEqual(report.failed, []);
  });
});

describe("no credential value enters the sandbox", () => {
  test("the credential reaches only the firewall's transform rule, never a command, a file or the create call's other fields", async () => {
    const { fake, sandbox } = await withGithub();
    await sandbox.writeFile("notes.txt", bytes("hello"));
    await run(sandbox, ["env"], { ALPHA: "1" });
    await sandbox.readFile("notes.txt");
    await sandbox.readBack?.();
    await sandbox.dispose();
    assert.ok(sentIntoVms(fake.calls).every((sent) => !sent.includes("ghp_live_value")));
    const create = fake.calls.find((call) => call.kind === "create");
    assert.ok(create?.kind === "create");
    assert.equal(
      create.params.networkPolicy !== "deny-all" && JSON.stringify(create.params.networkPolicy).includes(SECRET),
      true,
    );
    assert.equal("env" in create.params, false, "the create call sets no environment");
  });

  test("the handle serializes to its id only", async () => {
    const { sandbox } = await withGithub();
    assert.equal(JSON.stringify(sandbox), JSON.stringify({ id: "harness-test-1" }));
    assert.deepEqual(Object.keys(sandbox), ["id"]);
    await sandbox.dispose();
  });

  test("a command whose arguments, variables or working directory hold the credential is refused before it runs", async () => {
    const { fake, sandbox } = await withGithub();
    const before = fake.calls.length;
    for (const attempt of [
      () => sandbox.exec(["echo", SECRET], { env: {}, signal: never() }),
      () => sandbox.exec(["env"], { env: { TOKEN: SECRET }, signal: never() }),
      () => sandbox.exec(["echo"], { env: {}, signal: never(), cwd: `x${SECRET}` }),
      () => sandbox.writeFile("leak.txt", bytes(`token=${SECRET}`)),
      () => sandbox.readFile(`a${SECRET}`),
    ]) {
      const error = await rejection(attempt());
      assert.equal((error as { code?: string }).code, "invalid_sandbox_options");
      assert.ok(!String((error as Error).message).includes("ghp_live_value"));
    }
    assert.equal(fake.calls.length, before, "nothing reached the VM");
    await sandbox.dispose();
  });

  test("the token after the header's scheme is guarded on its own, in a command and in a file", async () => {
    const { sandbox } = await withGithub();
    const token = SECRET.slice("Bearer ".length);
    const command = await rejection(sandbox.exec(["curl", "-u", `x:${token}`], { env: {}, signal: never() }));
    assert.equal((command as { code?: string }).code, "invalid_sandbox_options");
    const file = await rejection(sandbox.writeFile("t.txt", bytes(token)));
    assert.equal((file as { code?: string }).code, "invalid_sandbox_options");
    await sandbox.dispose();
  });

  test("a file a process saved with an echoed credential reads back redacted", async () => {
    const { fake, sandbox } = await withGithub();
    const vm = fake.live()[0];
    assert.ok(vm !== undefined);
    vm.files.set(`${ROOT}/saved.json`, { kind: "file", data: bytes(`{"authorization":"${SECRET}","raw":"${SECRET.slice(7)}"}`) });
    const read = text(await sandbox.readFile("saved.json"));
    assert.equal(read, '{"authorization":"[REDACTED]","raw":"[REDACTED]"}');
    await sandbox.dispose();
  });

  test("a credential a service echoes back is scrubbed from the command's output", async () => {
    const { sandbox } = await withGithub();
    const echoed = await run(sandbox, ["net-probe", "https://api.github.com/user"]);
    assert.ok("stdout" in echoed);
    assert.ok(echoed.stdout.includes("[REDACTED]"), "the injected header came back, redacted");
    assert.ok(!echoed.stdout.includes("ghp_live_value"));
    await sandbox.dispose();
  });

  test("a credential that can't be read fails provisioning with its name and never its value, before any sandbox is made", async () => {
    for (const secret of [
      async () => {
        throw new Error(`vault said ${SECRET}`);
      },
      async () => "",
      async () => "Bearer one\r\nx-other: two",
    ]) {
      const fake = fakeVercel();
      const error = await rejection(
        backend(fake, { egress: GITHUB, secret }).provision({ root: ROOT }, policy(["api.github.com"])),
      );
      assert.ok(error instanceof VercelSecretError, String(error));
      assert.equal(error.code, "egress_secret_unresolved");
      assert.equal(error.credential, "GITHUB_TOKEN");
      assert.match(error.message, /GITHUB_TOKEN/);
      assert.ok(!error.message.includes("ghp_live_value") && !error.message.includes("Bearer one"));
      assert.equal(error.cause, undefined);
      assert.equal(fake.calls.length, 0, "no sandbox was created");
    }
  });

  test("a failed create's error quotes neither the request nor the credential", async () => {
    const fake = fakeVercel({ fail: new Set(["create"]) });
    const error = await rejection(
      backend(fake, { egress: GITHUB, secret: async () => SECRET }).provision(
        { root: ROOT },
        policy(["api.github.com"]),
      ),
    );
    assert.ok(error instanceof SandboxUnavailableError);
    assert.ok(!error.message.includes("ghp_live_value"), error.message);
    assert.equal(error.cause, undefined);
  });

  test("a resume reads the credential again and applies it through update, never through the VM", async () => {
    const fake = fakeVercel();
    let value = SECRET;
    const client = backend(fake, { egress: GITHUB, secret: async () => value });
    const sandbox = await client.provision({ root: ROOT }, policy(["api.github.com"]));
    value = "Bearer rotated_value_0123456789abcdef";
    const resumed = await resumeSandbox(client, sandbox.id ?? "", policy(["api.github.com"]));
    const update = fake.calls.find((call) => call.kind === "update");
    assert.ok(update?.kind === "update" && JSON.stringify(update.policy).includes("rotated_value"));
    assert.ok(sentIntoVms(fake.calls).every((sent) => !sent.includes("rotated_value")));
    assert.equal(resumed.id, sandbox.id);
    await sandbox.dispose();
  });
});

describe("egress is closed to everything the policy doesn't name", () => {
  test("a policy with no host compiles to deny-all", async () => {
    const fake = fakeVercel();
    const sandbox = await backend(fake).provision({ root: ROOT }, policy([]));
    const create = fake.calls.find((call) => call.kind === "create");
    assert.ok(create?.kind === "create");
    assert.equal(create.params.networkPolicy, "deny-all");
    const probe = await run(sandbox, ["net-probe", "https://example.com/"]);
    assert.notEqual("exitCode" in probe && probe.exitCode, 0);
    await sandbox.dispose();
  });

  test("the firewall allows exactly the policy's hosts and denies the private ranges", async () => {
    const fake = fakeVercel();
    const sandbox = await backend(fake).provision({ root: ROOT }, policy(["a.example.com", "b.example.com"]));
    const create = fake.calls.find((call) => call.kind === "create");
    assert.ok(create?.kind === "create");
    assert.deepEqual(create.params.networkPolicy, {
      allow: { "a.example.com": [], "b.example.com": [] },
      subnets: { deny: [...VERCEL_DENIED_SUBNETS] },
    });
    for (const blocked of [
      "https://c.example.com/",
      "https://sub.a.example.com/",
      "https://169.254.169.254/",
      "https://[::1]/",
    ]) {
      const probe = await run(sandbox, ["net-probe", blocked]);
      assert.ok("exitCode" in probe && probe.exitCode !== 0, blocked);
    }
    await sandbox.dispose();
  });

  test("a wildcard, a port, an upper-case host, an address and a git route are refused before anything is made", async () => {
    const cases: [VercelSandboxOptions["egress"], string[]][] = [
      [{ allow: ["*.example.com"], routes: [] }, ["*.example.com"]],
      [{ allow: ["example.com:8443"], routes: [] }, ["example.com:8443"]],
      [{ allow: ["Example.com"], routes: [] }, ["Example.com"]],
      [{ allow: ["169.254.169.254"], routes: [] }, ["169.254.169.254"]],
      [
        {
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
        },
        ["github.com"],
      ],
    ];
    for (const [egress, allow] of cases) {
      const fake = fakeVercel();
      const error = await rejection(
        backend(fake, { ...(egress === undefined ? {} : { egress }), secret: async () => SECRET }).provision(
          { root: ROOT },
          policy(allow),
        ),
      );
      assert.equal((error as { code?: string }).code, "invalid_egress_options", JSON.stringify(allow));
      assert.equal(fake.calls.length, 0);
    }
  });

  test("the policy's hosts must be the egress policy's hosts, so a route can't widen the allowlist", async () => {
    const fake = fakeVercel();
    const client = backend(fake, { egress: GITHUB, secret: async () => SECRET });
    for (const allow of [[], ["api.github.com", "extra.example.com"], ["example.com"]]) {
      const error = await rejection(client.provision({ root: ROOT }, policy(allow)));
      assert.equal((error as { code?: string }).code, "invalid_sandbox_options");
    }
    assert.equal(fake.calls.length, 0);
  });

  test("two routes on one host, and a host both allowed and denied, are refused", async () => {
    const two: EgressPolicy = {
      allow: [],
      routes: [
        {
          kind: "header",
          route: "a",
          host: "api.example.com",
          methods: ["GET"],
          header: "authorization",
          credential: "A_TOKEN",
        },
        {
          kind: "header",
          route: "b",
          host: "api.example.com",
          methods: ["POST"],
          header: "x-api-key",
          credential: "B_TOKEN",
        },
      ],
    };
    const error = await rejection(
      backend(fakeVercel(), { egress: two, secret: async () => SECRET }).provision(
        { root: ROOT },
        policy(["api.example.com"]),
      ),
    );
    assert.equal((error as { code?: string }).code, "invalid_egress_options");
    const both = { ...policy(["a.example.com"]), network: { allow: ["a.example.com"], deny: ["a.example.com"] } };
    const conflict = await rejection(backend(fakeVercel()).provision({ root: ROOT }, both));
    assert.equal((conflict as { code?: string }).code, "invalid_sandbox_options");
  });

  test("a route-only host takes only the route's methods, and a host also in allow passes the rest without a credential", async () => {
    const { fake, sandbox } = await withGithub();
    const create = fake.calls.find((call) => call.kind === "create");
    assert.ok(create?.kind === "create" && typeof create.params.networkPolicy === "object");
    const rules = (create.params.networkPolicy.allow as Record<string, unknown[]>)["api.github.com"];
    assert.deepEqual(rules, [
      { match: { method: ["GET"] }, transform: [{ headers: { authorization: SECRET } }] },
      { response: { statusCode: 403 } },
    ]);
    const post = await run(sandbox, ["net-probe", "https://api.github.com/user", "POST"]);
    assert.ok("exitCode" in post && post.exitCode !== 0, "a POST to a GET route is refused");
    await sandbox.dispose();

    const tunnelled = fakeVercel();
    const both: EgressPolicy = { allow: ["api.github.com"], routes: GITHUB.routes };
    const open = await backend(tunnelled, { egress: both, secret: async () => SECRET }).provision(
      { root: ROOT },
      policy(["api.github.com"]),
    );
    const sent = tunnelled.calls.find((call) => call.kind === "create");
    assert.ok(sent?.kind === "create" && typeof sent.params.networkPolicy === "object");
    assert.equal((sent.params.networkPolicy.allow as Record<string, unknown[]>)["api.github.com"]?.length, 1);
    const plain = await run(open, ["net-probe", "https://api.github.com/user", "POST"]);
    assert.ok(
      "exitCode" in plain && plain.exitCode === 0 && plain.stdout === "{}",
      "the POST passes, with no credential",
    );
    await open.dispose();
  });

  test("checkVercelNetworkPolicy refuses subnets.allow, allow-all, a wildcard and a forwarding rule", () => {
    const refused: NetworkPolicy[] = [
      "allow-all",
      { allow: ["a.example.com"], subnets: { allow: ["10.0.0.0/8"] } },
      { allow: ["*.example.com"] },
      { allow: { "*": [] } },
      { allow: { "a.example.com": [{ forwardURL: "https://proxy.example.com/" }] } },
    ];
    for (const candidate of refused) {
      assert.throws(() => checkVercelNetworkPolicy(candidate), { code: "invalid_egress_options" });
    }
    checkVercelNetworkPolicy("deny-all");
    checkVercelNetworkPolicy({ allow: { "a.example.com": [] }, subnets: { deny: ["10.0.0.0/8"] } });
  });
});

describe("the read-back catches a provider that widens or drops what was sent", () => {
  const widened: [string, (reported: NetworkPolicy) => NetworkPolicy | undefined, string][] = [
    ["allow-all", () => "allow-all", "network.allow"],
    [
      "subnets.allow",
      (r) => (typeof r === "object" ? { ...r, subnets: { ...r.subnets, allow: ["0.0.0.0/0"] } } : r),
      "network.allow",
    ],
    [
      "an extra domain",
      (r) => (typeof r === "object" ? { ...r, allow: { ...(r.allow as object), "evil.example.com": [] } } : r),
      "network.allow",
    ],
    [
      "a wildcard domain",
      (r) => (typeof r === "object" ? { ...r, allow: { ...(r.allow as object), "*": [] } } : r),
      "network.allow",
    ],
    [
      "a dropped credential rule",
      (r) => (typeof r === "object" ? { ...r, allow: { "api.github.com": [] } } : r),
      "settings",
    ],
    [
      "a credential rule on another host",
      (r) =>
        typeof r === "object"
          ? {
              ...r,
              allow: {
                ...(r.allow as object),
                "evil.example.com": [{ transform: [{ headers: { authorization: "<redacted>" } }] }],
              },
            }
          : r,
      "settings",
    ],
    ["missing denied ranges", (r) => (typeof r === "object" ? { allow: r.allow ?? [] } : r), "settings"],
    ["no policy at all", () => undefined, "readBack"],
  ];
  for (const [what, report, field] of widened) {
    test(`${what} throws sandbox_policy_mismatch naming ${field}, and the sandbox is deleted`, async () => {
      const fake = fakeVercel({ report });
      const client = backend(fake, { egress: GITHUB, secret: async () => SECRET });
      const error = await rejection(client.provision({ root: ROOT }, policy(["api.github.com"])));
      assert.ok(error instanceof SandboxPolicyMismatchError, String(error));
      assert.equal(error.field, field);
      assert.ok(!error.message.includes("evil") && !error.message.includes("ghp_live_value"));
      assert.deepEqual(fake.live(), [], "no sandbox is left");
    });
  }
});

describe("the file calls keep to the roots", () => {
  test("a path outside the roots, one that climbs out, a protected file and a symlink that leads out are denied", async () => {
    const fake = fakeVercel();
    const sandbox = await backend(fake).provision({ root: ROOT }, policy());
    fake.symlink(`${ROOT}/out`, "/etc");
    const denied = async (work: Promise<unknown>, kind: string) => {
      const error = await rejection(work);
      assert.equal((error as { code?: string }).code, "sandbox_denied");
      assert.equal((error as { denial?: { kind: string } }).denial?.kind, kind);
    };
    await denied(sandbox.writeFile("/etc/passwd", bytes("x")), "filesystem_write");
    await denied(sandbox.writeFile("../../../etc/x", bytes("x")), "filesystem_write");
    await denied(sandbox.writeFile(".git/hooks/pre-commit", bytes("x")), "filesystem_write");
    await denied(sandbox.writeFile(".bashrc", bytes("x")), "filesystem_write");
    await denied(sandbox.writeFile("out/x", bytes("x")), "filesystem_write");
    await denied(sandbox.readFile("out/passwd"), "filesystem_read");
    const cwd = await sandbox.exec(["echo"], { env: {}, signal: never(), cwd: "out" });
    assert.ok("denied" in cwd);
    await sandbox.dispose();
  });

  test("a VM whose realpath answers outside the roots is denied too", async () => {
    const fake = fakeVercel({ realpath: (resolved) => (resolved.endsWith("/trap") ? "/etc/trap" : resolved) });
    const sandbox = await backend(fake).provision({ root: ROOT }, policy());
    const error = await rejection(sandbox.writeFile("trap", bytes("x")));
    assert.equal((error as { code?: string }).code, "sandbox_denied");
    await sandbox.dispose();
  });

  test("a workspace outside every root and a relative root are refused before anything is made", async () => {
    const fake = fakeVercel();
    const client = backend(fake);
    assert.equal(
      ((await rejection(client.provision({ root: "/elsewhere" }, policy()))) as { code: string }).code,
      "invalid_sandbox_options",
    );
    assert.equal(
      ((await rejection(client.provision({ root: ROOT }, policy([], "relative/root")))) as { code: string }).code,
      "invalid_sandbox_options",
    );
    assert.equal(fake.calls.length, 0);
  });
});

describe("a command runs with only its own variables, never as root", () => {
  test("each command runs as env -i with its variables, and no command asks for sudo", async () => {
    const fake = fakeVercel();
    const sandbox = await backend(fake).provision({ root: ROOT }, policy());
    await run(sandbox, ["-n", "x"], {});
    await run(sandbox, ["echo", "hi"], { ALPHA: "1" });
    const runs = fake.calls.filter((call) => call.kind === "run");
    assert.ok(runs.every((call) => call.kind === "run" && call.params.sudo === false));
    const echo = runs.find((call) => call.kind === "run" && call.params.args.includes("hi"));
    assert.ok(echo?.kind === "run");
    assert.equal(echo.params.cmd, "env");
    assert.deepEqual(echo.params.args, ["-i", "--", "ALPHA=1", "echo", "hi"]);
    await sandbox.dispose();
  });

  test("the create call sets a timeout, leaves persistence off and never asks for an environment", async () => {
    const fake = fakeVercel();
    const sandbox = await backend(fake).provision({ root: ROOT }, policy());
    const create = fake.calls.find((call) => call.kind === "create");
    assert.ok(create?.kind === "create");
    assert.equal(create.params.timeout, 30 * 60 * 1000);
    assert.equal(create.params.persistent, false);
    assert.equal("env" in create.params, false);
    await sandbox.dispose();
  });
});

describe("a sandbox that fails or is disposed is never left running", () => {
  const failures: [string, FakeVercelOptions][] = [
    ["a create that fails after Vercel made the sandbox", { failCreateAfterMaking: true }],
    ["a failure making the roots", { fail: new Set(["mkdir"]) }],
    ["a failure writing the manifest", { fail: new Set(["write"]) }],
  ];
  for (const [what, options] of failures) {
    test(`${what} deletes the sandbox`, async () => {
      const fake = fakeVercel(options);
      const error = await rejection(backend(fake).provision({ root: ROOT, files: { "a.txt": "a" } }, policy()));
      assert.ok(error instanceof Error);
      assert.equal(fake.vms.size, 1, "Vercel made one sandbox");
      assert.deepEqual(fake.live(), [], "and it was deleted");
    });
  }

  test("dispose kills the commands still running, stops and deletes the sandbox", async () => {
    const fake = fakeVercel();
    const sandbox = await backend(fake).provision({ root: ROOT }, policy());
    const running = rejection(sandbox.exec(["sleep", "30"], { env: {}, signal: never() }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sandbox.dispose();
    assert.equal(((await running) as { code?: string }).code, "sandbox_disposed");
    const kinds = fake.calls.map((call) => call.kind);
    assert.ok(kinds.includes("kill"));
    assert.ok(kinds.indexOf("kill") < kinds.indexOf("delete"));
    assert.deepEqual(fake.live(), []);
  });

  test("a stop that fails still deletes, and a delete that fails rejects dispose with what to do", async () => {
    const stopFails = fakeVercel({ fail: new Set(["stop"]) });
    const first = await backend(stopFails).provision({ root: ROOT }, policy());
    await first.dispose();
    assert.deepEqual(stopFails.live(), []);

    const deleteFails = fakeVercel({ fail: new Set(["delete"]) });
    const second = await backend(deleteFails).provision({ root: ROOT }, policy());
    const error = await rejection(second.dispose());
    assert.equal((error as { code?: string }).code, "sandbox_io_failed");
    assert.match((error as Error).message, /delete it in the Vercel dashboard/);
    assert.equal(await rejection(second.dispose()), error, "a second dispose gets the same answer");
  });

  test("a timeout and an abort kill the command", async () => {
    const fake = fakeVercel();
    const sandbox = await backend(fake).provision({ root: ROOT }, policy());
    const timed = await sandbox.exec(["sleep", "30"], { env: {}, signal: never(), timeoutMs: 50 });
    assert.ok("exitCode" in timed && timed.exitCode === 124 && timed.timedOut === true);
    const controller = new AbortController();
    const aborted = rejection(sandbox.exec(["sleep", "30"], { env: {}, signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort(new Error("stop"));
    assert.equal(((await aborted) as Error).message, "stop");
    assert.equal(fake.calls.filter((call) => call.kind === "kill").length, 2);
    const run = fake.calls.find((call) => call.kind === "run" && call.params.args.includes("sleep"));
    assert.ok(run?.kind === "run" && run.params.timeoutMs === 5050, "Vercel holds a backstop past the host's timeout");
    await sandbox.dispose();
  });

  test("a snapshot resumes into a new sandbox that keeps the files and is deleted on its own dispose", async () => {
    const fake = fakeVercel();
    const client = backend(fake);
    const sandbox = await client.provision({ root: ROOT }, policy());
    await sandbox.writeFile("kept.txt", bytes("kept"));
    const id = await snapshotSandbox(client, sandbox);
    assert.match(id, /^snapshot:/);
    const resumed = await resumeSandbox(client, id, policy());
    assert.equal(text(await resumed.readFile("kept.txt")), "kept");
    await resumed.dispose();
    await sandbox.dispose();
    assert.deepEqual(fake.live(), []);
  });
});
