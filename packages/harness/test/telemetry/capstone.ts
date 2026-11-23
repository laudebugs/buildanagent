// A small session that exercises every span the projection makes: a model call that asks for two tools, one that runs
// and one that waits for a person, the approval, and a closing model call. The clock and the ids are deterministic, so
// the log, and the spans projected from it, are the same bytes on every run.
import { createModel, type Model, type PriceCatalog } from "@buildanagent/gateway";
import { createPermissionPipeline } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import { createApprovals, openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool, hmacSigner } from "@buildanagent/sdk";
import { fixedClock, ScriptedModel, sequentialIds } from "@buildanagent/sdk/testing";
import { memoryBackend } from "../session/memory-backend.js";
import { KEY } from "../session/session-helpers.js";

const SOURCE = "https://provider.test/pricing";
const CATALOG: PriceCatalog = {
  models: [
    {
      provider: "scripted",
      id: "priced",
      rates: [
        { uncachedInput: 3, cacheRead: 0.3, cacheWrite: { "5m": 3.75, "1h": 6 }, output: 15, upToInputTokens: null },
      ],
      contextWindow: 200_000,
      maxOutputTokens: 4000,
      asOf: "2026-11-01",
      sources: { rates: SOURCE, contextWindow: SOURCE, maxOutputTokens: SOURCE },
    },
  ],
};

const USAGE = { uncachedInput: 1000, cacheRead: 400, cacheWrite: { "5m": 100, "1h": 0 }, output: 200, reasoning: 0 };
const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

/** The secret text the tests look for in the spans: it is in the prompt, a tool's arguments and a tool's result. */
export const SECRETS = {
  prompt: "my customer is Ada Lovelace",
  argument: "order-o1-secret",
  result: "receipt-77 issued",
} as const;

function registry() {
  const tools = createToolRegistry();
  tools.register({
    name: "lookup",
    source: "builtin",
    definition: defineTool({
      name: "lookup",
      description: "Looks up a customer.",
      inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
      async execute(input: { id: number }) {
        return { content: [{ type: "text", text: `customer ${input.id}` }] };
      },
    }) as never,
  });
  tools.register({
    name: "refund",
    source: "builtin",
    definition: defineTool({
      name: "refund",
      description: "Refunds an order.",
      inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
      async execute() {
        return { content: [{ type: "text", text: SECRETS.result }] };
      },
    }) as never,
  });
  return tools;
}

function harnessFor(steps: ConstructorParameters<typeof ScriptedModel>[0], priced: boolean) {
  const adapter = new ScriptedModel(steps);
  const model = createModel({
    adapter,
    id: priced ? "priced" : "scripted-model",
    ...(priced ? { catalog: CATALOG } : {}),
    retries: 0,
  }) as Model;
  const tools = registry();
  const pipeline = createPermissionPipeline(
    {
      mode: "default",
      interactive: true,
      policyVersion: "p1",
      allow: [{ tool: "lookup" }],
      ask: [{ tool: "refund" }],
    },
    tools,
  );
  return createHarness({
    registry: tools,
    model,
    system: "You triage tickets.",
    pipeline,
    signer: hmacSigner({ keys: { k1: KEY_BYTES }, current: "k1" }),
  });
}

/**
 * Runs the capstone session offline and returns its entries in log order. `priced` picks a model the catalog prices;
 * the other model has no price, so its cost is unknown.
 */
export async function capstoneEntries(priced = true): Promise<SessionEntry[]> {
  const backend = memoryBackend();
  const clock = fixedClock("2026-11-22T10:00:00.000Z", 250);
  const newId = sequentialIds("e");
  const session = await openSession({
    store: backend.store,
    index: backend.index,
    lock: backend.lock,
    key: KEY,
    now: () => new Date(clock.now()),
    newId,
  });
  const first = harnessFor(
    [
      {
        content: [
          { type: "text", text: "Checking the customer, then refunding." },
          { type: "tool_call", callId: "c1", name: "lookup", input: { id: 7 } },
          { type: "tool_call", callId: "c2", name: "refund", input: { orderId: SECRETS.argument } },
        ],
        usage: USAGE,
      },
    ],
    priced,
  );
  await runTurn(session, first, { input: SECRETS.prompt, clock, newId });
  const approvals = createApprovals(first);
  const [waiting] = await approvals.pending(session);
  const second = harnessFor([{ content: [{ type: "text", text: "Refund issued." }], usage: USAGE }], priced);
  await createApprovals(second).resolve(
    session,
    [{ requestId: waiting?.request.id as string, decision: "allow", by: "ada" }],
    { clock, newId },
  );
  await session.close();
  const found: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) found.push(entry);
  return found;
}
