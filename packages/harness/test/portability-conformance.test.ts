// The unified eight-seam portability conformance suite run against every local implementation:
// SessionStore (jsonlStore), SessionLock (fileLock with off-host lease expiry), Scheduler (processScheduler),
// KeyStore (fileKeyStore), SandboxClient (fakeSandbox), EgressPolicy (startEgressProxy), Transport
// (webSocketTransport and stdioTransport over Web streams) and EffectStore (memoryEffectStore).
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { type AddressInfo, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryEffectStore } from "@buildanagent/agent-safety";
import { createModel, type Model } from "@buildanagent/gateway";
import { startEgressProxy } from "@buildanagent/harness/credentials";
import { createDispatcher, createHarness, stdioTransport, webSocketTransport } from "@buildanagent/harness/server";
import { memoryStore, processScheduler } from "@buildanagent/harness/session";
import { fileKeyStore, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import {
  type EgressFactory,
  fakeSandbox,
  type KeyStoreFactory,
  type LockFactory,
  PORTABILITY_SEAMS,
  type PortabilityTarget,
  portabilityConformanceCases,
  runEgressConformance,
  runPortabilityConformance,
  runTransportConformance,
  type SchedulerFactory,
  type StoreFactory,
  type TransportFactory,
} from "@buildanagent/harness/testing";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { type ClientMessage, decode, encode, type ServerMessage } from "@buildanagent/protocol";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { afterAll, describe, test } from "vitest";
import { MemorySocket } from "./server/memory-websocket.js";
import { memoryBackend } from "./session/session-helpers.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const START = Date.parse("2026-11-24T00:00:00.000Z");

function manualSchedulerFactory(): SchedulerFactory {
  return () => {
    let time = START;
    let next = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const delivered: { sessionId: string; at: Date }[] = [];
    const scheduler = processScheduler({
      now: () => time,
      setTimer: (callback, ms) => {
        const id = next++;
        timers.set(id, { at: time + ms, callback });
        return id;
      },
      clearTimer: (timer) => {
        timers.delete(timer as number);
      },
    });
    scheduler.onWake((sessionId, at) => {
      delivered.push({ sessionId, at });
    });
    return {
      scheduler,
      now: () => new Date(time),
      delivered: () => [...delivered],
      async advanceTo(to) {
        const target = to.getTime();
        for (;;) {
          const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
          if (due === undefined) break;
          timers.delete(due[0]);
          time = Math.max(time, due[1].at);
          due[1].callback();
          await Promise.resolve();
        }
        time = target;
      },
    };
  };
}

const localStoreFactory: StoreFactory = () => {
  const dir = tempDir("harness-port-store-");
  return {
    store: jsonlStore({ dir }),
    tearLastLine: (key) => {
      appendFileSync(join(dir, key.userId, `${key.sessionId}.jsonl`), '{"id":"torn","parentId":"r1","seq":2,"time');
    },
  };
};

const localLockFactory: LockFactory = () => {
  const dir = tempDir("harness-port-lock-");
  let time = START;
  const leaseMs = 2_000;
  const noRenew = 1_999;
  // Disable background renewal timers in the lease-expiry test so advancing the clock expires the peer's lease cleanly.
  const quietScheduler = processScheduler({
    now: () => time,
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
  const local = fileLock({
    dir,
    leaseMs,
    renewMs: noRenew,
    now: () => time,
    host: "local-host",
    pid: 1001,
    isAlive: () => false,
    scheduler: quietScheduler,
  });
  const peer = fileLock({
    dir,
    leaseMs,
    renewMs: noRenew,
    now: () => time,
    host: "local-host",
    pid: 999999,
    isAlive: () => false,
    scheduler: quietScheduler,
  });
  return {
    lock: local,
    lease: {
      peer,
      leaseMs,
      staleness: "lease_and_dead_pid",
      advanceClock: (ms) => {
        time += ms;
      },
    },
  };
};

const localKeyStoreFactory: KeyStoreFactory = () => {
  const dir = tempDir("harness-port-keys-");
  return { store: fileKeyStore(join(dir, "keys.json")) };
};

/** Probes a target URL through the local HD15 proxy using HTTP CONNECT for https or proxy.fetch for http. */
function probeConnect(proxyUrl: string, hostPort: string): Promise<{ allowed: boolean; detail: string }> {
  const parsed = new URL(proxyUrl);
  return new Promise((resolve) => {
    const req = httpRequest({
      host: parsed.hostname,
      port: Number(parsed.port),
      method: "CONNECT",
      path: hostPort,
    });
    req.on("connect", (res, socket) => {
      socket.destroy();
      resolve({ allowed: res.statusCode === 200, detail: `CONNECT ${res.statusCode}` });
    });
    req.on("response", (res) => {
      res.resume();
      resolve({ allowed: res.statusCode === 200, detail: `HTTP ${res.statusCode}` });
    });
    req.on("error", (err) => {
      resolve({ allowed: false, detail: err.message });
    });
    req.end();
  });
}

const localEgressFactory: EgressFactory = async () => {
  const proxy = await startEgressProxy({
    allow: ["allowed.example.invalid"],
    log: () => undefined,
    resolve: async (host) => {
      if (host === "localhost") return ["127.0.0.1"];
      if (host === "metadata.google.internal") return ["169.254.169.254"];
      return ["93.184.216.34"];
    },
  });
  return {
    probe: async (targetUrl) => {
      const parsed = new URL(targetUrl);
      const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
      const authority = `${parsed.hostname}:${port}`;
      // Verify both CONNECT tunnel refusal and in-process proxy.fetch refusal fail closed.
      const connectResult = await probeConnect(proxy.url, authority);
      let fetchAllowed = true;
      try {
        await proxy.fetch(targetUrl);
      } catch {
        fetchAllowed = false;
      }
      return {
        allowed: connectResult.allowed || fetchAllowed,
        detail: `${connectResult.detail}, fetchAllowed=${fetchAllowed}`,
      };
    },
    dispose: () => proxy.close(),
  };
};

function makeDispatcher() {
  const adapter = new ScriptedModel([{ content: [{ type: "text", text: "ok" }] }]);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const harness = createHarness({
    registry: createToolRegistry(),
    model,
    system: "You run portability conformance checks.",
  });
  const backend = memoryBackend();
  return createDispatcher({
    harness,
    store: backend.store,
    index: backend.index,
    lock: backend.lock,
    userId: "alice",
  });
}

const webSocketTransportFactory: TransportFactory = () => {
  const dispatcher = makeDispatcher();
  const [serverSocket, clientSocket] = MemorySocket.pair();
  const done = webSocketTransport(dispatcher, serverSocket);
  return {
    send: (msg: ClientMessage) => {
      clientSocket.send(encode(msg));
    },
    onMessage: (listener) => {
      const handler = (event: { data: unknown }) => {
        listener(decode(String(event.data)) as ServerMessage);
      };
      clientSocket.addEventListener("message", handler);
      return () => clientSocket.removeEventListener("message", handler);
    },
    close: async () => {
      clientSocket.close();
      await done;
    },
  };
};

const stdioTransportFactory: TransportFactory = () => {
  const dispatcher = makeDispatcher();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const listeners = new Set<(message: ServerMessage) => void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const input = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
  });
  let buffer = "";
  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim() === "") continue;
        const parsed = decode(line) as ServerMessage;
        for (const listener of listeners) listener(parsed);
      }
    },
  });
  const done = stdioTransport(dispatcher, { input, output });
  let closed = false;

  return {
    send: (msg: ClientMessage) => {
      controller.enqueue(encoder.encode(`${encode(msg)}\n`));
    },
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: async () => {
      if (!closed) {
        closed = true;
        controller.close();
      }
      await done;
    },
  };
};

const LOCAL_TARGET: PortabilityTarget = {
  store: localStoreFactory,
  lock: localLockFactory,
  scheduler: manualSchedulerFactory(),
  keyStore: localKeyStoreFactory,
  sandbox: () => ({ client: fakeSandbox(), root: "/workspace" }),
  egress: localEgressFactory,
  transport: webSocketTransportFactory,
  effectStore: () => memoryEffectStore(),
};

describe("unified eight-seam portability conformance suite (local target)", () => {
  test("covers all eight portable seams", () => {
    assert.deepEqual(PORTABILITY_SEAMS, [
      "store",
      "lock",
      "scheduler",
      "keyStore",
      "sandbox",
      "egress",
      "transport",
      "effectStore",
    ]);
    const cases = portabilityConformanceCases(LOCAL_TARGET);
    for (const seam of PORTABILITY_SEAMS) {
      assert.ok(
        cases.some((c) => c.name.startsWith(`${seam}: `)),
        `expected at least one case for seam ${seam}`,
      );
    }
  });

  test("passes every local implementation across all eight seams with zero failures", async () => {
    const report = await runPortabilityConformance(LOCAL_TARGET);
    assert.deepEqual(report.failed, []);
    // Only the three OS-level fakeSandbox cases and offline allowlisted-host egress probe skip on LOCAL_TARGET.
    assert.deepEqual(
      report.skipped.map((entry) => entry.name),
      [
        "sandbox: an abort and a timeout end the command's whole process tree, and exec settles",
        "sandbox: a symlink in the workspace that points outside it is denied for reads and writes",
        "sandbox: the network is denied unless the host is on the allowlist",
        "egress: allows a host explicitly listed on EgressPolicy.allow",
      ],
    );
    assert.ok(report.passed.length >= 40, `expected >= 40 passing cases, got ${report.passed.length}`);
  });

  test("egress conformance also passes its allowlisted-host case with zero skips", async () => {
    const server = createTcpServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const report = await runEgressConformance(async () => {
        const proxy = await startEgressProxy({
          allow: [`allowed.test:${port}`],
          log: () => undefined,
          resolve: async (host) => {
            if (host === "allowed.test" || host === "localhost") return ["127.0.0.1"];
            if (host === "metadata.google.internal") return ["169.254.169.254"];
            return ["93.184.216.34"];
          },
          unsafeAllowAddresses: ["127.0.0.1"],
        });
        return {
          allowedUrl: `https://allowed.test:${port}/`,
          probe: async (targetUrl) => {
            const parsed = new URL(targetUrl);
            const targetPort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
            return probeConnect(proxy.url, `${parsed.hostname}:${targetPort}`);
          },
          dispose: () => proxy.close(),
        };
      });
      assert.deepEqual(report.failed, []);
      assert.deepEqual(report.skipped, []);
      assert.equal(report.passed.length, 11);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("stdioTransport over Web streams also passes transport conformance", async () => {
    const report = await runTransportConformance(stdioTransportFactory);
    assert.deepEqual(report.failed, []);
    assert.equal(report.passed.length, 3);
  });

  test("memoryStore passes store seam cleanly inside runPortabilityConformance", async () => {
    const report = await runPortabilityConformance({ store: () => ({ store: memoryStore() }) });
    assert.deepEqual(report.failed, []);
    assert.ok(report.passed.length > 0);
  });

  test("off-host lease-only lock passes lockConformanceCases after lease expiry", async () => {
    let time = START;
    const leaseMs = 5_000;
    const heldBy = new Map<string, { token: string; expiresAt: number }>();
    let seq = 0;
    const makeLock = () => ({
      async acquire(key: { userId: string; sessionId: string }) {
        const id = `${key.userId}:${key.sessionId}`;
        const existing = heldBy.get(id);
        if (existing !== undefined && existing.expiresAt >= time) return "would_block" as const;
        const token = `tok-${++seq}`;
        heldBy.set(id, { token, expiresAt: time + leaseMs });
        return {
          token,
          held: () => heldBy.get(id)?.token === token && (heldBy.get(id)?.expiresAt ?? 0) >= time,
          release: async () => {
            if (heldBy.get(id)?.token === token) heldBy.delete(id);
          },
        };
      },
    });
    const report = await runPortabilityConformance({
      lock: () => {
        heldBy.clear();
        return {
          lock: makeLock(),
          lease: {
            peer: makeLock(),
            leaseMs,
            staleness: "lease_only",
            advanceClock: (ms) => {
              time += ms;
            },
          },
        };
      },
    });
    assert.deepEqual(report.failed, []);
    assert.equal(report.skipped.length, 0);
    assert.equal(report.passed.length, 5);
  });
});
