// App data (`app`): the caller's trusted facts reach each tool as `ctx.app`, typed per run, and never reach the model,
// an event or a saved context.
import assert from "node:assert/strict";
import {
  continueRun,
  defineTool,
  nestedRunDepth,
  type RunOptions,
  type RunResult,
  run,
  type ToolContext,
} from "@buildanagent/sdk";
import { test } from "vitest";
import { pendingOf, processSigner } from "./resume-helpers.js";
import { determinism, drive, scripted, text, toolCall } from "./run-helpers.js";

const SYSTEM = "You look customers up.";

interface Session {
  readonly customerId: string;
}

/** A lookup whose schema declares no identity field: the customer comes from `ctx.app`. */
function lookupTool(seen: string[] = []) {
  return defineTool<{ topic: string }, unknown, Session>({
    name: "lookup_customer",
    description: "Look up the signed-in customer's plan.",
    inputSchema: { type: "object", properties: { topic: { type: "string" } } },
    async execute(_input, ctx) {
      seen.push(ctx.app.customerId);
      return { content: [{ type: "text", text: "plan: pro" }] };
    },
  });
}

/** The text of every tool result in a run's messages. */
function toolTexts(result: RunResult): string[] {
  return result.messages.flatMap((m) =>
    m.role === "tool" ? m.content.map((c) => (c.type === "text" ? c.text : "")) : [],
  );
}

test("a tool reads the app data the caller passed, and the model's own customerId changes nothing", async () => {
  const seen: string[] = [];
  const { model, adapter } = scripted([toolCall("lookup_customer", { customerId: "cust-999" }), text("Done.")]);
  const { result } = await drive(
    run({
      model,
      system: SYSTEM,
      input: "Plan?",
      tools: [lookupTool(seen)],
      app: { customerId: "cust-1" },
      ...determinism(),
    }),
  );
  assert.equal(result.stopReason, "done");
  assert.deepEqual(seen, ["cust-1"], "the lookup answered for the caller's customer, not the model's");
  assert.deepEqual(toolTexts(result), ["plan: pro"]);
  assert.ok(!JSON.stringify(adapter.calls).includes("cust-1"), "no recorded request holds the app data");
});

test("a run whose tools declare app data must pass it, with the declared type", () => {
  const { model } = scripted([]);
  const base = { model, system: SYSTEM, input: "Plan?", tools: [lookupTool()], ...determinism() };
  const never = (_options: unknown) => undefined;
  // Type-only checks: none of these runs starts.
  never(() => run({ ...base, app: { customerId: "cust-1" } }));
  // @ts-expect-error: the tool declares app data, so a run without `app` does not compile.
  never(() => run({ ...base }));
  // @ts-expect-error: `app` has the wrong type for the tool.
  never(() => run({ ...base, app: { customerId: 7 } }));
  // @ts-expect-error: `app` lacks the declared field.
  never(() => run({ ...base, app: { other: "x" } }));
  // A typed tool beside an untyped one still needs `app`, with the declared type, and `null` is no value of it.
  const plain = defineTool({
    name: "plain",
    description: "Declares no app type.",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      return { content: [] };
    },
  });
  const mixed = { model, system: SYSTEM, input: "Plan?", ...determinism() };
  never(() => run({ ...mixed, tools: [lookupTool(), plain], app: { customerId: "cust-1" } }));
  never(() => run({ ...mixed, tools: [plain, lookupTool()], app: { customerId: "cust-1" } }));
  // @ts-expect-error: the typed tool needs `app` even beside an untyped one.
  never(() => run({ ...mixed, tools: [lookupTool(), plain] }));
  // @ts-expect-error: the untyped tool listed first does not hide the typed one.
  never(() => run({ ...mixed, tools: [plain, lookupTool()] }));
  // @ts-expect-error: `app` has the wrong type, beside an untyped tool.
  never(() => run({ ...mixed, tools: [lookupTool(), plain], app: { customerId: 7 } }));
  // @ts-expect-error: `null` is not a `Session`, so a visitor who isn't signed in cannot reach the tool.
  never(() => run({ ...mixed, tools: [lookupTool()], app: null }));
  // @ts-expect-error: the same for `undefined`.
  never(() => run({ ...mixed, tools: [lookupTool()], app: undefined }));
  // @ts-expect-error: a resume with a typed and an untyped tool must pass `app`.
  never(() => continueRun({ system: SYSTEM, messages: [] }, { model, tools: [lookupTool(), plain] }));
  // Tools that declare unrelated app types cannot share a run.
  const other = defineTool<object, unknown, { tenant: number }>({
    name: "other",
    description: "Reads another type.",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      return { content: [] };
    },
  });
  // @ts-expect-error: one run has one app type, and these two are unrelated.
  never(() => run({ ...base, tools: [lookupTool(), other], app: { customerId: "cust-1" } }));
  // `continueRun()` has the same rule.
  const context = { system: SYSTEM, messages: [] };
  never(() => continueRun(context, { model, tools: [lookupTool()], app: { customerId: "cust-1" } }));
  // @ts-expect-error: a resume with typed tools must pass `app` too.
  never(() => continueRun(context, { model, tools: [lookupTool()] }));
  // With explicit type arguments, `A` is not inferred and stays `unknown`, so the check does not apply.
  never(() => run<unknown>({ ...base }));
  // A run whose tools declare none takes no app data, and may still pass some.
  never(() => run({ model, system: SYSTEM, input: "Hi.", ...determinism() }));
  never(() => run({ model, system: SYSTEM, input: "Hi.", app: { anything: true }, ...determinism() }));
});

test("the app data is in no event and no saved context, and continueRun() without it gives tools undefined", async () => {
  const secret = "cust-secret-42";
  const { model } = scripted([toolCall("lookup_customer", {}), text("Done.")]);
  const { events, result } = await drive(
    run({
      model,
      system: SYSTEM,
      input: "Plan?",
      tools: [lookupTool()],
      app: { customerId: secret },
      ...determinism(),
    }),
  );
  assert.equal(result.stopReason, "done");
  assert.ok(!JSON.stringify(events).includes(secret), "no event holds the app data");
  assert.ok(!JSON.stringify(result.context).includes(secret), "the saved context holds none");
  const seen: unknown[] = [];
  const probe = defineTool({
    name: "probe",
    description: "Reports its app data.",
    inputSchema: { type: "object", properties: {} },
    async execute(_input, ctx: ToolContext) {
      seen.push(ctx.app);
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
  const next = scripted([toolCall("probe", {}), text("Done.")]);
  const continued = await drive(
    // `continueRun()` is given no `app`, so the probe sees undefined.
    continueRun(
      {
        ...result.context,
        messages: [...result.context.messages, { role: "user", content: [{ type: "text", text: "Again." }] }],
      },
      { model: next.model, tools: [probe], ...determinism() },
    ),
  );
  assert.equal(continued.result.stopReason, "done");
  assert.deepEqual(seen, [undefined]);
});

test("two overlapping runs with different app data each see their own", async () => {
  const seen: string[] = [];
  const tool = defineTool<{ topic: string }, unknown, Session>({
    name: "lookup_customer",
    description: "Look up the signed-in customer's plan.",
    inputSchema: { type: "object", properties: { topic: { type: "string" } } },
    async execute(_input, ctx) {
      // Yield so the two runs interleave, then read the app data after the other has had its turn.
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(ctx.app.customerId);
      return { content: [{ type: "text", text: ctx.app.customerId }] };
    },
  });
  const start = (customerId: string) =>
    drive(
      run({
        model: scripted([toolCall("lookup_customer", {}), text("Done.")]).model,
        system: SYSTEM,
        input: "Plan?",
        tools: [tool],
        app: { customerId },
        ...determinism(),
      }),
    );
  const [one, two] = await Promise.all([start("cust-A"), start("cust-B")]);
  assert.deepEqual(toolTexts(one.result), ["cust-A"]);
  assert.deepEqual(toolTexts(two.result), ["cust-B"]);
  assert.deepEqual([...seen].sort(), ["cust-A", "cust-B"]);
});

test("a nested run sees no app data unless the tool passes it on", async () => {
  const childSaw: unknown[] = [];
  const child = defineTool({
    name: "probe",
    description: "Reports its app data.",
    inputSchema: { type: "object", properties: {} },
    async execute(_input, ctx: ToolContext) {
      childSaw.push(ctx.app);
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
  const delegating = (pass: boolean) =>
    defineTool<Record<string, never>, unknown, Session>({
      name: "delegate",
      description: "Hands the task to a sub-agent.",
      inputSchema: { type: "object", properties: {} },
      async execute(_input, ctx) {
        const options: RunOptions & { input: string; system: string } = {
          model: scripted([toolCall("probe", {}), text("Sub done.")]).model,
          system: SYSTEM,
          input: "Sub-task.",
          tools: [child],
          ...(pass ? { app: ctx.app } : {}),
          ...nestedRunDepth(ctx),
          ...determinism(),
          idGenerator: () => `child-${childSaw.length}`,
        };
        await drive(run(options));
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
  for (const pass of [false, true]) {
    const { model } = scripted([toolCall("delegate", {}), text("Top done.")]);
    await drive(
      run({
        model,
        system: SYSTEM,
        input: "Go.",
        tools: [delegating(pass)],
        app: { customerId: "cust-1" },
        ...determinism(),
      }),
    );
  }
  assert.deepEqual(childSaw, [undefined, { customerId: "cust-1" }]);
});

test("a call approved after a pause runs as the caller whose app data the resuming process passes back", async () => {
  const seen: unknown[] = [];
  const refund = defineTool<{ reason: string }, unknown, Session>({
    name: "refund",
    description: "Refund the signed-in customer's last order.",
    inputSchema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    effect: { kind: "write" },
    async execute(_input, ctx) {
      seen.push(ctx.app.customerId);
      return { content: [{ type: "text", text: "refunded" }] };
    },
  });
  const options = {
    system: SYSTEM,
    tools: [refund],
    signer: processSigner(),
    interceptors: { beforeToolCall: () => ({ decision: "ask" as const, reason: "A person approves refunds." }) },
    ...determinism(),
  };
  const first = await drive(
    run({
      ...options,
      model: scripted([toolCall("refund", { reason: "late" })]).model,
      input: "Refund me.",
      app: { customerId: "cust-1" },
    }),
  );
  assert.equal(first.result.stopReason, "awaiting_approval");
  assert.deepEqual(seen, [], "nothing runs before a person answers");
  const [request] = pendingOf(first.result);
  assert.ok(request);
  // The caller stores the original caller's app beside the context, as JSON like the context itself.
  const stored = JSON.stringify({ context: first.result.context, app: { customerId: "cust-1" } });
  const approverSession: Session = { customerId: "support-lead-9" };
  const resolve = (app: Session) => {
    const { context } = JSON.parse(stored) as { context: typeof first.result.context };
    const allow = { requestId: request.id, decision: "allow" as const, by: approverSession.customerId };
    return drive(
      continueRun(context, { ...options, model: scripted([text("Refunded.")]).model, resolutions: [allow], app }),
    );
  };
  const asOriginal = await resolve((JSON.parse(stored) as { app: Session }).app);
  assert.equal(asOriginal.result.stopReason, "done");
  assert.deepEqual(seen, ["cust-1"], "the refund ran for the customer who asked");
  // The SDK does not bind `app` to the request, so a resume that passes the approver's own session runs as the approver.
  // This is why the README tells callers to store the original `app` and pass it back.
  await resolve(approverSession);
  assert.deepEqual(seen, ["cust-1", "support-lead-9"]);
});
