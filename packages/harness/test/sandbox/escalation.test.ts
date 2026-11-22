// Sandbox escalation: a denial is a host-side state transition. Under `never` it reaches the model as an error result
// and nothing is written; under `on-request` it becomes a signed request, and an allow reruns the command once under a
// policy widened by exactly the denial. Every edge of the transition table is tested, the illegal ones included, and
// every check on an answer fails closed. The sandbox is the in-memory fake, so no test runs a program or reaches a host.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isHarnessError } from "@buildanagent/harness";
import * as sandboxModule from "@buildanagent/harness/sandbox";
import {
  ESCALATION_EVENTS,
  ESCALATION_STATES,
  ESCALATION_TOOL,
  ESCALATION_TRANSITIONS,
  type EscalationResult,
  type EscalationRun,
  type EscalationState,
  escalation,
  nextEscalationState,
  type SandboxClient,
  type SandboxDenial,
  type SandboxPolicy,
} from "@buildanagent/harness/sandbox";
import { createHarness } from "@buildanagent/harness/server";
import {
  createApprovals,
  openSession,
  quorumOf,
  runTurn,
  type SessionEntry,
  type SessionStore,
} from "@buildanagent/harness/session";
import type { FakeSandboxClient } from "@buildanagent/harness/testing";
import { createToolRegistry, toolSearchTool } from "@buildanagent/harness/tools";
import { createPendingRequest, defineTool, hmacSigner, type Resolution, verifyResolution } from "@buildanagent/sdk";
import { describe, test } from "vitest";
import { codeCallHarness } from "../permissions/code-call-fixture.js";
import { type Backend, KEY, memoryBackend } from "../session/session-helpers.js";
import { BASE_POLICY, ESCALATION_KEYS, escalationHarness, ROOT } from "./escalation-fixture.js";

const ENV = { PATH: "/usr/bin", HOME: "/tmp/escalation-home" };
const signal = () => new AbortController().signal;
const open = (backend: Backend, store: SessionStore = backend.store) =>
  openSession({ store, index: backend.index, lock: backend.lock, key: KEY });

async function entriesOf(backend: Backend): Promise<SessionEntry[]> {
  const found: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) found.push(entry);
  return found;
}

const typesOf = (entries: readonly SessionEntry[]) => entries.map((entry) => entry.type);
const allow = (requestId: string, by = "ada"): Resolution => ({ requestId, decision: "allow", by });

// Every edge a behavioural test walks, as `from->to`, and the settlements the crash tests reach.
const walked = new Set<string>();
function track(states: readonly EscalationState[]): void {
  for (let index = 1; index < states.length; index += 1) walked.add(`${states[index - 1]}->${states[index]}`);
}

function expectStatus<S extends EscalationResult["status"]>(
  result: EscalationResult,
  status: S,
): Extract<EscalationResult, { status: S }> {
  assert.equal(result.status, status, `expected ${status}, got ${result.status}: ${JSON.stringify(result.states)}`);
  track(result.states);
  return result as Extract<EscalationResult, { status: S }>;
}

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<Error> {
  let caught: unknown;
  await promise.catch((error: unknown) => {
    caught = error;
  });
  assert.ok(isHarnessError(caught), `expected a HarnessError ${code}, got ${String(caught)}`);
  assert.equal(caught.code, code);
  return caught;
}

/** A fake client that also records the policy each sandbox was provisioned with. */
function spied(client: FakeSandboxClient) {
  const policies: SandboxPolicy[] = [];
  const wrapped: SandboxClient = {
    tier: client.tier,
    stops: client.stops,
    provision(manifest, policy) {
      policies.push(policy);
      return client.provision(manifest, policy);
    },
  };
  return { client: wrapped, policies };
}

/** A client whose every command is refused with `denial`, as a backend that reports the same refusal each time. */
function refusingClient(denial: SandboxDenial) {
  const policies: SandboxPolicy[] = [];
  let execs = 0;
  const client: SandboxClient = {
    tier: "os",
    stops: ["mistakes"],
    async provision(_manifest, policy) {
      policies.push(policy);
      return {
        async exec() {
          execs += 1;
          return { denied: denial };
        },
        async readFile() {
          return new Uint8Array();
        },
        async writeFile() {},
        async dispose() {},
      };
    },
  };
  return { client, policies, execs: () => execs };
}

const probe = (host = "example.com") => ["net-probe", host];

function runOf(client: SandboxClient, extra: Partial<EscalationRun> = {}): EscalationRun {
  const command = extra.command ?? probe();
  return {
    tool: "run",
    input: { command: [...command] },
    command,
    env: ENV,
    signal: signal(),
    client,
    manifest: { root: ROOT },
    policy: BASE_POLICY,
    ...extra,
  };
}

const resolveWith = (client: SandboxClient, extra = {}) => ({
  client,
  manifest: { root: ROOT },
  env: ENV,
  signal: signal(),
  ...extra,
});

/** Runs a denied probe under `on-request` in a fresh session, and returns the waiting escalation. */
async function paused(backend: Backend, options: Parameters<typeof escalationHarness>[0] = {}, extra = {}) {
  const fixture = await escalationHarness(options);
  const spy = spied(fixture.client);
  const machine = escalation({ approvalPolicy: "on-request", approvals: fixture.approvals });
  const session = await open(backend);
  const asked = expectStatus(await machine.run(session, runOf(spy.client, extra)), "awaiting_approval");
  return { ...fixture, spy, machine, session, asked };
}

describe("the transition table", () => {
  const listed = (from: EscalationState, event: string) =>
    ESCALATION_TRANSITIONS.some((edge) => edge.from === from && edge.event === event);

  test("every listed edge moves to its state", () => {
    for (const edge of ESCALATION_TRANSITIONS) assert.equal(nextEscalationState(edge.from, edge.event), edge.to);
  });

  test("every pair of a state and an event the table does not list throws invalid_escalation", () => {
    let illegal = 0;
    for (const state of ESCALATION_STATES) {
      for (const event of ESCALATION_EVENTS) {
        if (listed(state, event)) continue;
        illegal += 1;
        assert.throws(
          () => nextEscalationState(state, event),
          (error: unknown) => isHarnessError(error) && error.code === "invalid_escalation",
        );
      }
    }
    assert.equal(illegal, ESCALATION_STATES.length * ESCALATION_EVENTS.length - ESCALATION_TRANSITIONS.length);
  });

  test("no edge reaches approved except a verified allow from requested, and no edge reaches rerun except from approved", () => {
    const into = (state: EscalationState) => ESCALATION_TRANSITIONS.filter((edge) => edge.to === state);
    assert.deepEqual(
      into("approved").map(({ from, event }) => [from, event]),
      [["requested", "allowed"]],
    );
    assert.deepEqual(
      into("rerun").map(({ from, event }) => [from, event]),
      [["approved", "started"]],
    );
    // The illegal shortcuts, named one by one.
    for (const [from, event] of [
      ["requested", "started"],
      ["denied", "allowed"],
      ["denied", "started"],
      ["sandboxed", "asked"],
      ["sandboxed", "allowed"],
    ] as const) {
      assert.throws(() => nextEscalationState(from, event));
    }
  });

  test("rerun leads only to done, so no edge goes from rerun back to requested or denied", () => {
    const out = ESCALATION_TRANSITIONS.filter((edge) => edge.from === "rerun");
    assert.ok(out.length > 0 && out.every((edge) => edge.to === "done"));
    for (const event of ["asked", "denied", "allowed", "waiting", "started", "returned"] as const) {
      assert.throws(() => nextEscalationState("rerun", event));
    }
  });

  test("done is final, every state is reachable from sandboxed, and the table can't be changed", () => {
    assert.ok(!ESCALATION_TRANSITIONS.some((edge) => edge.from === "done"));
    const reached = new Set<EscalationState>(["sandboxed"]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const edge of ESCALATION_TRANSITIONS) {
        if (reached.has(edge.from) && !reached.has(edge.to)) {
          reached.add(edge.to);
          grew = true;
        }
      }
    }
    assert.deepEqual([...reached].sort(), [...ESCALATION_STATES].sort());
    assert.ok(Object.isFrozen(ESCALATION_TRANSITIONS) && ESCALATION_TRANSITIONS.every(Object.isFrozen));
  });

  test("the machine exposes the same table", async () => {
    const { approvals } = await escalationHarness();
    assert.equal(escalation({ approvalPolicy: "never", approvals }).transitions, ESCALATION_TRANSITIONS);
  });
});

describe("under never", () => {
  test("a denial reaches the model as an error result, and no approval entry is written", async () => {
    const backend = memoryBackend();
    const session = await open(backend);
    let outcome: EscalationResult | undefined;
    const fixture = await escalationHarness({
      steps: [
        { content: [{ type: "tool_call", callId: "c1", name: "run", input: { command: probe() } }] },
        { content: [{ type: "text", text: "The host is closed." }] },
      ],
      onRun: async (input) => {
        outcome = await machine.run(session, runOf(fixture.client, { command: input.command, toolCallId: "c1" }));
        return outcome.result;
      },
    });
    const machine = escalation({ approvalPolicy: "never", approvals: fixture.approvals });
    const turn = await runTurn(session, fixture.harness, { input: "probe example.com" });
    assert.equal(turn.stopReason, "done");
    const denied = expectStatus(outcome as EscalationResult, "denied");
    assert.deepEqual(denied.states, ["sandboxed", "denied", "done"]);
    const entries = await entriesOf(backend);
    const result = entries.find((entry) => entry.type === "tool_result" && entry.callId === "c1");
    assert.ok(result?.type === "tool_result" && result.isError);
    assert.match(JSON.stringify(result.content), /refused a network of example\.com.*never/);
    assert.ok(!typesOf(entries).includes("approval_requested"), "no approval entry is written");
    assert.equal(fixture.client.execs.length, 1);
    await session.close();
  });

  test("a denial from host code writes nothing at all", async () => {
    const backend = memoryBackend();
    const { approvals, client } = await escalationHarness();
    const session = await open(backend);
    const denied = expectStatus(
      await escalation({ approvalPolicy: "never", approvals }).run(session, runOf(client)),
      "denied",
    );
    assert.equal(denied.result.isError, true);
    assert.deepEqual(await entriesOf(backend), []);
    await session.close();
  });

  test("a command the sandbox allows runs once and ends ran", async () => {
    const backend = memoryBackend();
    const { approvals, client } = await escalationHarness();
    const session = await open(backend);
    const ran = expectStatus(
      await escalation({ approvalPolicy: "on-request", approvals }).run(
        session,
        runOf(client, { command: ["echo", "hi"] }),
      ),
      "ran",
    );
    assert.deepEqual(ran.states, ["sandboxed", "done"]);
    assert.equal(ran.exec.stdout, "hi\n");
    assert.deepEqual(await entriesOf(backend), []);
    await session.close();
  });
});

describe("under on-request", () => {
  test("a denial writes a signed approval_requested entry before the result returns, which only the machine lists", async () => {
    const backend = memoryBackend();
    const { asked, session, harness, approvals, machine } = await paused(backend);
    assert.deepEqual(asked.states, ["sandboxed", "denied", "requested"]);
    const entries = await entriesOf(backend);
    assert.deepEqual(typesOf(entries), ["session_header", "env_stamp", "approval_requested"]);
    const entry = entries[2];
    assert.ok(entry?.type === "approval_requested");
    assert.deepEqual(entry.request, asked.pending);
    assert.equal(entry.request.tool, ESCALATION_TOOL);
    assert.equal(entry.request.callId, asked.escalationId);
    const record = entry.input as { denial: SandboxDenial; policy: SandboxPolicy };
    assert.deepEqual(record.denial, { kind: "network", target: "example.com", reason: record.denial.reason });
    assert.deepEqual(record.policy, BASE_POLICY);
    const check = await verifyResolution(asked.pending, allow(asked.pending.id), {
      signer: harness.signer as NonNullable<typeof harness.signer>,
      call: { callId: asked.escalationId, tool: ESCALATION_TOOL, input: entry.input },
    });
    assert.ok(check.ok, "the request verifies with the harness's key ring");
    assert.deepEqual(asked.widened.network.allow, ["example.com"]);
    assert.deepEqual(
      (await machine.pending(session)).map((waiting) => waiting.escalationId),
      [asked.escalationId],
    );
    assert.deepEqual(await approvals.pending(session), [], "a turn's approvals don't list it");
    await rejectsWith(approvals.resolve(session, [allow(asked.pending.id)]), "approval_not_pending");
    await session.close();
  });

  test("after an allow the command reruns once with the policy widened by exactly the denial, and a replay runs nothing", async () => {
    const backend = memoryBackend();
    const { asked, session, machine, spy, client } = await paused(backend);
    const before = (await entriesOf(backend)).length;
    const ran = expectStatus(await machine.resolve(session, allow(asked.pending.id), resolveWith(spy.client)), "ran");
    assert.deepEqual(ran.states, ["requested", "approved", "rerun", "done"]);
    assert.equal(ran.rerun, true);
    assert.equal(ran.exec.stdout, "reached example.com\n");
    assert.equal(client.execs.length, 2, "the first run and the one rerun");
    assert.deepEqual(spy.policies, [BASE_POLICY, { ...BASE_POLICY, network: { allow: ["example.com"], deny: [] } }]);
    const added = (await entriesOf(backend)).slice(before);
    assert.deepEqual(typesOf(added), ["approval_resolved", "permission_decision", "tool_result"]);
    const result = added[2];
    assert.ok(result?.type === "tool_result" && result.tool === ESCALATION_TOOL && result.trust === "untrusted");
    assert.deepEqual(await machine.pending(session), []);
    await rejectsWith(
      machine.resolve(session, allow(asked.pending.id), resolveWith(spy.client)),
      "approval_not_pending",
    );
    assert.equal(client.execs.length, 2, "still once");
    await session.close();
  });

  test("the widened policy lasts for the one rerun: the same command asks again afterwards", async () => {
    const backend = memoryBackend();
    const { asked, session, machine, spy, client } = await paused(backend);
    expectStatus(await machine.resolve(session, allow(asked.pending.id), resolveWith(spy.client)), "ran");
    const again = expectStatus(await machine.run(session, runOf(spy.client)), "awaiting_approval");
    assert.notEqual(again.escalationId, asked.escalationId);
    assert.deepEqual(spy.policies.at(-1), BASE_POLICY);
    assert.deepEqual(BASE_POLICY.network.allow, [], "the base policy never changed");
    assert.equal(client.execs.length, 3);
    await session.close();
  });

  test("a second denial after the rerun returns to the model and does not escalate again", async () => {
    const backend = memoryBackend();
    const { approvals } = await escalationHarness();
    const refusing = refusingClient({ kind: "network", target: "example.com", reason: "closed" });
    const machine = escalation({ approvalPolicy: "on-request", approvals });
    const session = await open(backend);
    const asked = expectStatus(await machine.run(session, runOf(refusing.client)), "awaiting_approval");
    const denied = expectStatus(
      await machine.resolve(session, allow(asked.pending.id), resolveWith(refusing.client)),
      "denied",
    );
    assert.deepEqual(denied.states, ["requested", "approved", "rerun", "done"]);
    assert.equal(denied.rerun, true);
    assert.equal(denied.result.isError, true);
    assert.match(denied.reason, /no one is asked again/);
    assert.equal(refusing.execs(), 2);
    const entries = await entriesOf(backend);
    assert.equal(typesOf(entries).filter((type) => type === "approval_requested").length, 1);
    assert.equal(typesOf(entries).at(-1), "tool_result");
    assert.deepEqual(await machine.pending(session), []);
    await session.close();
  });

  test("a person's deny ends the escalation with no rerun", async () => {
    const backend = memoryBackend();
    const { asked, session, machine, spy, client } = await paused(backend);
    const denied = expectStatus(
      await machine.resolve(
        session,
        { requestId: asked.pending.id, decision: "deny", reason: "not that host", by: "ada" },
        resolveWith(spy.client),
      ),
      "denied",
    );
    assert.deepEqual(denied.states, ["requested", "done"]);
    assert.match(denied.reason, /not that host/);
    assert.equal(client.execs.length, 1);
    await session.close();
  });

  test("a deny rule added after the pause wins over the allow", async () => {
    const backend = memoryBackend();
    const { asked, session, client } = await paused(backend);
    const later = await escalationHarness({ deny: [{ tool: "run", reason: "commands are off" }] });
    const machine = escalation({ approvalPolicy: "on-request", approvals: later.approvals });
    const denied = expectStatus(await machine.resolve(session, allow(asked.pending.id), resolveWith(client)), "denied");
    assert.deepEqual(denied.states, ["requested", "approved", "done"]);
    assert.match(denied.reason, /commands are off/);
    assert.equal(client.execs.length, 1, "no rerun");
    await session.close();
  });

  test("a denial that can't be widened goes back with nothing written: the root, an untidy path, a wildcard, a closed host", async () => {
    const policyWithDeny: SandboxPolicy = { ...BASE_POLICY, network: { allow: [], deny: ["evil.example"] } };
    const cases: Array<[SandboxDenial, SandboxPolicy]> = [
      [{ kind: "filesystem_read", target: "/", reason: "outside" }, BASE_POLICY],
      [{ kind: "filesystem_write", target: "/work/../etc", reason: "outside" }, BASE_POLICY],
      [{ kind: "filesystem_read", target: "relative/path", reason: "outside" }, BASE_POLICY],
      [{ kind: "network", target: "*.example.com", reason: "closed" }, BASE_POLICY],
      [{ kind: "network", target: "https://example.com/", reason: "closed" }, BASE_POLICY],
      [{ kind: "network", target: "evil.example", reason: "closed" }, policyWithDeny],
    ];
    for (const [denial, policy] of cases) {
      const backend = memoryBackend();
      const { approvals } = await escalationHarness();
      const refusing = refusingClient(denial);
      const session = await open(backend);
      const denied = expectStatus(
        await escalation({ approvalPolicy: "on-request", approvals }).run(session, runOf(refusing.client, { policy })),
        "denied",
      );
      assert.deepEqual(denied.states, ["sandboxed", "denied", "done"]);
      assert.match(denied.reason, /can't be widened/);
      assert.deepEqual(await entriesOf(backend), [], `nothing written for ${denial.target}`);
      await session.close();
    }
  });

  test("a tool input that names sandbox settings changes nothing: the rerun's policy is the record's plus the denial", async () => {
    const backend = memoryBackend();
    const input = {
      command: probe(),
      sandbox: "danger-full-access",
      policy: { writeRoots: ["/"] },
      network: { allow: ["*"] },
      escalate: true,
    };
    const { asked, session, machine, spy } = await paused(backend, {}, { input });
    expectStatus(await machine.resolve(session, allow(asked.pending.id), resolveWith(spy.client)), "ran");
    assert.deepEqual(spy.policies.at(-1), { ...BASE_POLICY, network: { allow: ["example.com"], deny: [] } });
    await session.close();
  });

  test("a filesystem denial widens the read or write roots by that one path", async () => {
    const backend = memoryBackend();
    const fixture = await escalationHarness();
    const spy = spied(fixture.client);
    const machine = escalation({ approvalPolicy: "on-request", approvals: fixture.approvals });
    const session = await open(backend);
    const asked = expectStatus(
      await machine.run(session, runOf(spy.client, { command: ["write", "/data/out.txt", "hi"] })),
      "awaiting_approval",
    );
    assert.deepEqual(asked.denial.kind, "filesystem_write");
    const ran = expectStatus(await machine.resolve(session, allow(asked.pending.id), resolveWith(spy.client)), "ran");
    assert.equal(ran.exec.exitCode, 0);
    assert.deepEqual(spy.policies.at(-1), { ...BASE_POLICY, writeRoots: [ROOT, "/data/out.txt"] });
    await session.close();
  });
  test("a rerun's long output comes back whole, and the log keeps a clipped copy that fits one entry", async () => {
    const backend = memoryBackend();
    const big = "x".repeat(100_000);
    const extra = { command: ["cat", "/data/big.txt"], manifest: { root: ROOT, files: { "/data/big.txt": big } } };
    const { asked, session, machine, spy } = await paused(backend, {}, extra);
    const ran = expectStatus(
      await machine.resolve(session, allow(asked.pending.id), resolveWith(spy.client, { manifest: extra.manifest })),
      "ran",
    );
    assert.equal(ran.exec.stdout, big);
    const stored = (await entriesOf(backend)).at(-1);
    assert.ok(stored?.type === "tool_result" && stored.content[0]?.type === "text");
    assert.ok(stored.content[0].text.length < 9_000 && stored.content[0].text.includes("[output cut]"));
    await session.close();
  });
});

describe("granular", () => {
  test("a rule decides per denial kind and tool, and a denial no rule allows goes back with nothing written", async () => {
    const backend = memoryBackend();
    const { approvals, client } = await escalationHarness();
    const machine = escalation({
      approvalPolicy: "granular",
      approvals,
      granular: [
        { kind: "filesystem_write", escalate: "never" },
        { kind: "network", tool: "run", escalate: "on-request" },
      ],
    });
    const session = await open(backend);
    const write = expectStatus(
      await machine.run(session, runOf(client, { command: ["write", "/data/x", "hi"] })),
      "denied",
    );
    assert.match(write.reason, /No escalation rule/);
    const otherTool = expectStatus(await machine.run(session, runOf(client, { tool: "fetch" })), "denied");
    assert.deepEqual(otherTool.states, ["sandboxed", "denied", "done"]);
    assert.deepEqual(await entriesOf(backend), []);
    const network = expectStatus(await machine.run(session, runOf(client)), "awaiting_approval");
    const ran = expectStatus(await machine.resolve(session, allow(network.pending.id), resolveWith(client)), "ran");
    assert.equal(ran.rerun, true);
    await session.close();
  });

  test("the options are checked: rules only with granular, at least one rule, a known policy, approvals from createApprovals()", async () => {
    const { approvals } = await escalationHarness();
    const refused = (options: unknown, code = "invalid_escalation") =>
      assert.throws(
        () => escalation(options as Parameters<typeof escalation>[0]),
        (error: unknown) => isHarnessError(error) && error.code === code,
      );
    refused({ approvalPolicy: "granular", approvals });
    refused({ approvalPolicy: "granular", approvals, granular: [] });
    refused({ approvalPolicy: "granular", approvals, granular: [{ escalate: "always" }] });
    refused({ approvalPolicy: "granular", approvals, granular: [{ kind: "process", escalate: "never" }] });
    refused({ approvalPolicy: "on-request", approvals, granular: [{ escalate: "on-request" }] });
    refused({ approvalPolicy: "untrusted", approvals });
    refused({ approvalPolicy: "on-request", approvals: { pending: approvals.pending, resolve: approvals.resolve } });
    const bare = createHarness({
      registry: createToolRegistry(),
      model: (await escalationHarness()).harness.model,
      system: "",
    });
    refused({ approvalPolicy: "on-request", approvals: createApprovals(bare) }, "approval_unavailable");
    const unsigned = createHarness({ ...bare, signer: hmacSigner(ESCALATION_KEYS) });
    refused({ approvalPolicy: "on-request", approvals: createApprovals(unsigned) });
    assert.equal(escalation({ approvalPolicy: "never", approvals: createApprovals(bare) }).approvalPolicy, "never");
  });
});

describe("who may approve the rerun", () => {
  test("a hook's allow covers the rerun", async () => {
    const backend = memoryBackend();
    const { asked, session, machine, spy, client } = await paused(backend);
    const ran = expectStatus(
      await machine.resolve(session, allow(asked.pending.id, "hook:workspace-policy"), resolveWith(spy.client)),
      "ran",
    );
    assert.equal(ran.rerun, true);
    assert.equal(client.execs.length, 2);
    await session.close();
  });

  test("a classifier's allow does not: it is refused with nothing written, and a person can still allow", async () => {
    const backend = memoryBackend();
    const { asked, session, machine, spy, client } = await paused(backend);
    const before = (await entriesOf(backend)).length;
    const error = await rejectsWith(
      machine.resolve(session, allow(asked.pending.id, "classifier:guard"), resolveWith(spy.client)),
      "approval_refused",
    );
    assert.match(error.message, /classifier/);
    assert.equal((await entriesOf(backend)).length, before, "nothing written");
    assert.equal(client.execs.length, 1, "no rerun");
    assert.equal((await machine.pending(session)).length, 1, "still waiting");
    expectStatus(await machine.resolve(session, allow(asked.pending.id), resolveWith(spy.client)), "ran");
    await session.close();
  });
});

describe("an answer fails closed", () => {
  /** Appends a later approval_requested entry for the escalation, as a tampered log would hold it. */
  async function forge(session: Awaited<ReturnType<typeof open>>, request: unknown, input: unknown) {
    await session.append([
      {
        id: "forged",
        parentId: session.head(),
        timestamp: "2026-11-22T00:00:00.000Z",
        origin: "harness",
        type: "approval_requested",
        request: request as never,
        input,
      },
    ]);
  }

  async function refused(
    backend: Backend,
    fixture: Awaited<ReturnType<typeof paused>>,
    resolution: Resolution,
    extra = {},
    code = "approval_refused",
  ) {
    const before = (await entriesOf(backend)).length;
    const error = await rejectsWith(
      fixture.machine.resolve(fixture.session, resolution, resolveWith(fixture.spy.client, extra)),
      code,
    );
    assert.equal((await entriesOf(backend)).length, before, "nothing was written");
    assert.equal(fixture.client.execs.length, 1, "nothing reran");
    return error;
  }

  const recordOf = async (backend: Backend) =>
    (await entriesOf(backend)).find((entry) => entry.type === "approval_requested")?.input as Record<string, unknown>;

  test("a forged signature is refused, and the error holds neither the signature nor the key", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend);
    const signature = `${fixture.asked.pending.signature.slice(0, -2)}AA`;
    await forge(fixture.session, { ...fixture.asked.pending, signature }, await recordOf(backend));
    const error = await refused(backend, fixture, allow(fixture.asked.pending.id));
    assert.match(error.message, /signature_invalid/);
    assert.ok(!error.message.includes(signature) && !error.message.includes(fixture.asked.pending.signature));
    assert.ok(!error.message.includes(Buffer.from(ESCALATION_KEYS.keys.e1).toString("base64url")));
    await fixture.session.close();
  });

  test("a request signed under a key the ring lacks is refused", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend);
    const record = await recordOf(backend);
    const stranger = hmacSigner({ keys: { x9: new Uint8Array(32).fill(7) }, current: "x9" });
    const { pending } = fixture.asked;
    const request = await createPendingRequest(
      { kind: "approval", callId: pending.callId, tool: ESCALATION_TOOL, input: record },
      stranger,
      { generateId: () => pending.id },
    );
    await forge(fixture.session, request, record);
    assert.match((await refused(backend, fixture, allow(pending.id))).message, /signature_invalid/);
    await fixture.session.close();
  });

  test("a record whose denial or policy was edited is refused, so no one can widen what was approved", async () => {
    for (const edit of [
      { denial: { kind: "filesystem_write", target: "/etc", reason: "outside" } },
      { policy: { ...BASE_POLICY, writeRoots: ["/"] } },
    ]) {
      const backend = memoryBackend();
      const fixture = await paused(backend);
      await forge(fixture.session, fixture.asked.pending, { ...(await recordOf(backend)), ...edit });
      assert.match((await refused(backend, fixture, allow(fixture.asked.pending.id))).message, /input_changed/);
      await fixture.session.close();
    }
  });

  test("a request bound to one caller's host context is refused for another, and the right caller can resolve it", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend, {}, { hostContext: { user: "ada" } });
    const id = fixture.asked.pending.id;
    assert.match(
      (await refused(backend, fixture, allow(id), { hostContext: { user: "eve" } })).message,
      /app_mismatch/,
    );
    await refused(backend, fixture, allow(id));
    expectStatus(
      await fixture.machine.resolve(
        fixture.session,
        allow(id),
        resolveWith(fixture.spy.client, { hostContext: { user: "ada" } }),
      ),
      "ran",
    );
    await fixture.session.close();
  });

  test("an answer from the requester, a request that doesn't wait and a workspace with another root are refused", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend);
    const id = fixture.asked.pending.id;
    await refused(backend, fixture, allow(id, "ada"), { requesterId: "ada" }, "approver_is_requester");
    await refused(backend, fixture, allow("no-such-request"), {}, "approval_not_pending");
    await refused(backend, fixture, allow(id), { manifest: { root: "/" } }, "invalid_escalation");
    await fixture.session.close();
  });

  test("an approval the quorum policy lets expire never reruns", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend, { quorum: { evaluate: () => "expired" } });
    const denied = expectStatus(
      await fixture.machine.resolve(fixture.session, allow(fixture.asked.pending.id), resolveWith(fixture.spy.client)),
      "denied",
    );
    assert.deepEqual(denied.states, ["requested", "done"]);
    assert.match(denied.reason, /expired/);
    const answers = (await entriesOf(backend)).filter((entry) => entry.type === "approval_resolved");
    assert.ok(answers.some((entry) => entry.type === "approval_resolved" && entry.resolution.by === "policy"));
    assert.equal(fixture.client.execs.length, 1);
    await fixture.session.close();
  });

  test("a quorum of two waits after one approver and reruns after a second, distinct one", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend, { quorum: quorumOf(2) });
    const id = fixture.asked.pending.id;
    const waiting = expectStatus(
      await fixture.machine.resolve(fixture.session, allow(id, "ada"), resolveWith(fixture.spy.client)),
      "awaiting_approval",
    );
    assert.deepEqual(waiting.states, ["requested", "requested"]);
    assert.equal(fixture.client.execs.length, 1);
    expectStatus(
      await fixture.machine.resolve(fixture.session, allow(id, "grace"), resolveWith(fixture.spy.client)),
      "ran",
    );
    assert.equal(fixture.client.execs.length, 2);
    await fixture.session.close();
  });
});

describe("a crash", () => {
  /** A store that refuses the first append holding an entry of `type`, as a crash before that entry was durable would. */
  function crashingOn(store: SessionStore, type: SessionEntry["type"]): SessionStore {
    let failing = true;
    return new Proxy(store, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property !== "append") return typeof value === "function" ? value.bind(target) : value;
        return (async (key, entries, options) => {
          if (failing && entries.some((entry) => entry.type === type)) {
            failing = false;
            throw new Error("the disk is full");
          }
          return target.append(key, entries, options);
        }) satisfies SessionStore["append"];
      },
    });
  }

  const resultOf = async (backend: Backend, id: string) =>
    (await entriesOf(backend)).filter((entry) => entry.type === "tool_result" && entry.callId === id);

  test("a rerun that started and lost its result never runs again, and is settled as one that may have run", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend);
    await fixture.session.close();
    const crashed = await open(backend, crashingOn(backend.store, "tool_result"));
    await assert.rejects(
      fixture.machine.resolve(crashed, allow(fixture.asked.pending.id), resolveWith(fixture.spy.client)),
    );
    await crashed.close();
    assert.equal(fixture.client.execs.length, 2, "the rerun ran before its result was lost");
    const session = await open(backend);
    assert.deepEqual(await fixture.machine.pending(session), []);
    await rejectsWith(
      fixture.machine.resolve(session, allow(fixture.asked.pending.id), resolveWith(fixture.spy.client)),
      "approval_not_pending",
    );
    const settled = await resultOf(backend, fixture.asked.escalationId);
    assert.equal(settled.length, 1);
    assert.match(JSON.stringify(settled[0]), /may have run/);
    walked.add("settled:rerun");
    assert.equal(fixture.client.execs.length, 2, "never run again");
    await session.close();
  });

  test("an answer written before the rerun started settles as never run, and nothing reruns", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend);
    await fixture.session.close();
    const crashed = await open(backend, crashingOn(backend.store, "permission_decision"));
    await assert.rejects(
      fixture.machine.resolve(crashed, allow(fixture.asked.pending.id), resolveWith(fixture.spy.client)),
    );
    await crashed.close();
    const session = await open(backend);
    assert.deepEqual(await fixture.machine.pending(session), []);
    await rejectsWith(
      fixture.machine.resolve(session, allow(fixture.asked.pending.id), resolveWith(fixture.spy.client)),
      "approval_not_pending",
    );
    const settled = await resultOf(backend, fixture.asked.escalationId);
    assert.equal(settled.length, 1);
    assert.match(JSON.stringify(settled[0]), /never ran/);
    walked.add("settled:requested");
    assert.equal(fixture.client.execs.length, 1);
    await session.close();
  });

  test("a rebuilt context leaves the escalation's result out, so the model never reads an unmatched result", async () => {
    const backend = memoryBackend();
    const { asked, session, machine, spy } = await paused(backend);
    expectStatus(await machine.resolve(session, allow(asked.pending.id), resolveWith(spy.client)), "ran");
    const context = await session.toContext();
    assert.ok(!JSON.stringify(context.messages).includes(asked.escalationId));
    await session.close();
  });
});

describe("no tool or model output can widen the sandbox", () => {
  const WIDENING =
    /sandbox|polic|network|allow_?list|deny_?list|escalat|writ(e|able)_?roots?|read_?roots?|permission|unsafe|danger|bypass|privilege/i;

  /** Every property name in a JSON schema, at any depth. */
  function fieldsOf(schema: unknown, found: string[] = []): string[] {
    if (typeof schema !== "object" || schema === null) return found;
    for (const [key, value] of Object.entries(schema)) {
      if (key === "properties" && typeof value === "object" && value !== null) found.push(...Object.keys(value));
      fieldsOf(value, found);
    }
    return found;
  }

  test("no tool schema in the registry has a field that widens the sandbox", async () => {
    const { registry } = await escalationHarness();
    registry.register({
      name: "tool_search",
      source: "builtin",
      definition: toolSearchTool(registry, { activated: new Set() }) as never,
    });
    const codeCalls = (await codeCallHarness()).harness.registry;
    const tools = [...registry.list(), ...codeCalls.list()];
    assert.ok(tools.length >= 8);
    for (const tool of tools) {
      const fields = fieldsOf(tool.definition.inputSchema);
      const widening = fields.filter((field) => WIDENING.test(field));
      assert.deepEqual(widening, [], `${tool.canonicalName} has a field that could widen the sandbox`);
    }
  });

  test("no registered tool can be named sandbox.escalation, so no model call's result is taken for an escalation's", () => {
    const definition = defineTool({
      name: "x",
      description: "A tool.",
      inputSchema: { type: "object" },
      async execute() {
        return { content: [] };
      },
    }) as never;
    for (const source of ["builtin", "extension", "client"] as const) {
      assert.throws(
        () => createToolRegistry().register({ name: ESCALATION_TOOL, source, definition }),
        (error: unknown) => isHarnessError(error) && error.code === "invalid_tool_registration",
      );
    }
    const mcp = createToolRegistry().register({ name: ESCALATION_TOOL, source: "mcp:sandbox", definition });
    assert.notEqual(mcp.canonicalName, ESCALATION_TOOL);
  });

  test("the scan catches a field that would widen the sandbox", () => {
    const schema = { type: "object", properties: { command: {}, options: { properties: { writableRoots: {} } } } };
    assert.deepEqual(
      fieldsOf(schema).filter((field) => WIDENING.test(field)),
      ["writableRoots"],
    );
  });

  test("the widening code is reached only from the escalation runner, and the sandbox entry does not export it", () => {
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const files = (readdirSync(src, { recursive: true }) as string[]).filter((file) => file.endsWith(".ts"));
    const importers = files.filter((file) =>
      /from "\.\/widen\.js"|sandbox\/widen\.js"/.test(readFileSync(join(src, file), "utf8")),
    );
    assert.deepEqual(importers.map((file) => relative(src, join(src, file))).sort(), [
      join("sandbox", "escalation.ts"),
      join("session", "escalation-log.ts"),
    ]);
    // The log reader imports only the shape check, never the function that widens.
    assert.doesNotMatch(readFileSync(join(src, "session", "escalation-log.ts"), "utf8"), /widenPolicy/);
    const runners = files.filter((file) => /escalation\.js"/.test(readFileSync(join(src, file), "utf8")));
    assert.deepEqual(
      runners.map((file) => relative(src, join(src, file))),
      [join("sandbox", "index.ts")],
    );
    assert.ok(!("widenPolicy" in sandboxModule));
  });
});

// Runs last: every edge of the table was walked by a test above, by the machine itself.
test("every edge of the table is walked by the machine", () => {
  const missing = ESCALATION_TRANSITIONS.filter((edge) =>
    edge.event === "settled" ? !walked.has(`settled:${edge.from}`) : !walked.has(`${edge.from}->${edge.to}`),
  );
  assert.deepEqual(missing, [], "every edge is walked");
});
