// A crash between a write and its record, on our SDK and @buildanagent/agent-safety. The first attempt's record never
// settles, so the store keeps it as "started"; a later run reads that as `unknown`, asks the server under the same key
// and finds the write already there. The server sees one write. The book's Chapter 16 lists it beside the Vercel AI SDK.
import { effectKey, memoryEffectStore } from "@buildanagent/agent-safety";
import { run } from "@buildanagent/sdk";
import { type ChargeDeps, chargeTool, SCOPE, stateOf } from "./charge-tool.js";
import { check, scripted } from "./lib/check.js";
import { DECLINED_ORDER, startFakePayments } from "./lib/fake-payments.js";

const HOUR_MS = 3_600_000;
const ORDER = 42;
const payments = await startFakePayments();
const store = memoryEffectStore();
let clock = Date.parse("2026-11-22T10:00:00Z");
/** How many requests the server has seen; a function, so each check reads it anew. */
const requests = () => payments.posts.length;
const written = () => payments.writes.size;
const deps: ChargeDeps = { base: payments.base, store, now: () => clock };

/** One run that charges `order`, under a fresh tool call id; resolves with what the model read about the charge. */
async function charge(order: number, callId: string, withStore = store): Promise<string> {
  const call = { type: "tool_call", callId, name: "charge", input: { order } } as const;
  const { adapter, model } = scripted([{ content: [call] }, { content: [{ type: "text", text: "Done." }] }]);
  await run({
    model,
    system: "Charge orders.",
    tools: [chargeTool({ ...deps, store: withStore })],
    input: "Charge it.",
  }).result;
  const read = adapter.calls[1]?.context.messages.find((m) => m.role === "tool");
  return read?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
}
/** The effect key of a charge: with a business key it holds only the tenant and the order. */
const keyOf = (order: number) => effectKey({ ...SCOPE, toolCallId: "any" }, `charge:${order}`);

try {
  check((await charge(7, "call-1")).includes("took effect"), "a normal write reports applied");
  check(written() === 1, "the server wrote once");
  const repeat = await charge(7, "call-2");
  check(repeat.includes("took effect") && requests() === 1, "a repeat is answered from its record");
  check((await charge(DECLINED_ORDER, "call-3")).includes("did not take effect"), "a declined write is not_applied");
  await charge(DECLINED_ORDER, "call-4");
  check(payments.posts.filter((p) => p.order === DECLINED_ORDER).length === 1, "a decline is not sent again");

  // #region crash
  // The store's settle() never returns once the server has answered: the process died before it recorded the result.
  let reached!: () => void;
  const settleReached = new Promise<void>((done) => (reached = done));
  const dying = {
    ...store,
    settle: () => {
      reached();
      return new Promise<boolean>(() => {});
    },
  };
  void charge(ORDER, "call-5", dying);
  await settleReached;
  check(written() === 2, "the server had already written for order 42"); // book:note written
  check((await stateOf(store, await keyOf(ORDER))) === "unknown", "the record says started, so the state is unknown");
  // #endregion
  check((await charge(ORDER, "call-6")).includes("not known"), "while the lease is live a second run answers unknown");
  check(requests() === 3, "and sends nothing");

  // #region resume
  // The lease has lapsed. A fresh run, with a fresh call id, finds the record and asks the server before it writes.
  clock += HOUR_MS;
  check((await charge(ORDER, "call-7")).includes("took effect"), "the resume reconciles to applied"); // book:note resume
  check(payments.posts.filter((p) => p.order === ORDER).length === 1, "the server received one write for order 42");
  check((await stateOf(store, await keyOf(ORDER))) === "applied", "the record is settled as applied");
  // #endregion
} finally {
  await payments.close();
}
