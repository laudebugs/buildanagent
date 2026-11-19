// One attempt at a guarded refund, run by test/crash.test.ts in its own Node process, which the test may kill.
//
// `node effect-process.ts <base url> <tool call id> <now ms> <reconcile: yes|no>` runs one `guardedWrite()`. Its effect
// store and the fake payment API both live in the test process, behind loopback HTTP, so they outlive this process,
// as a durable store and a real API would. It prints one JSON line: the outcome, and how often `run` and `reconcile`
// were called.
//
// It imports the package's source by relative path, so it needs no `source` condition.
import { type EffectClaim, type EffectRecord, type EffectStore, guardedWrite, writeOutcome } from "../../src/index.js";

const [base = "", toolCallId = "", nowArg = "", reconcileArg = ""] = process.argv.slice(2);
const now = Number(nowArg);

// This process runs outside Vitest's offline setup, so it refuses every request that would leave loopback itself.
const loopbackFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "127.0.0.1")
    return Promise.reject(new Error(`network disabled in the crash test: ${url.hostname}`));
  return loopbackFetch(input, init);
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** An effect store whose records live in the test process, behind HTTP. */
const store: EffectStore = {
  begin: (record) => call<EffectClaim>("/store/begin", record),
  takeOver: (record) => call<EffectClaim>("/store/take-over", record),
  settle: (record) => call<boolean>("/store/settle", record),
  get: async (key) => (await call<{ record?: EffectRecord }>(`/store/get?key=${key}`)).record,
};

const counts = { run: 0, reconcile: 0 };
const REFUND = { orderId: 4417, amount: 250 };

const outcome = await guardedWrite({
  store,
  scope: { tenant: "user-1", session: "session-1", branch: "main", toolCallId },
  businessKey: `refund:${REFUND.orderId}`,
  operation: "refund_create",
  input: REFUND,
  dedupe: "idempotency_key",
  leaseMs: 60_000,
  now: () => now,
  run: async (key) => {
    counts.run++;
    return call<{ id: string }>("/api/refunds", { key, ...REFUND });
  },
  toOutcome: (refund) =>
    writeOutcome({ kind: "applied", operation: "refund_create", next: `Tell the user refund ${refund.id} is issued` }),
  ...(reconcileArg === "yes"
    ? {
        reconcile: async (key: string) => {
          counts.reconcile++;
          const { found } = await call<{ found?: { id: string } }>(`/api/refunds?key=${key}`);
          return found === undefined
            ? ("not_found" as const)
            : writeOutcome({
                kind: "applied",
                operation: "refund_create",
                next: `Tell the user ${found.id} is issued`,
              });
        },
      }
    : {}),
});

process.stdout.write(`${JSON.stringify({ outcome, counts })}\n`);
