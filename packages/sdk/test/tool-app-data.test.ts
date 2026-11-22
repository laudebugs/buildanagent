// App data (`app`): the caller's trusted facts reach each tool as `ctx.app`, typed per run, and never reach the model,
// an event or a saved context.
import assert from "node:assert/strict";
import {
  type AgentEvent,
  canonicalInputHash,
  continueRun,
  defineTool,
  isSdkError,
  nestedRunDepth,
  type RunOptions,
  type RunResult,
  run,
  type ToolContext,
  type ToolDefinition,
} from "@buildanagent/sdk";
import { test } from "vitest";
import { pendingOf, processSigner, roundTrip } from "./resume-helpers.js";
import { determinism, drive, scripted, text, toolCall } from "./run-helpers.js";

const SYSTEM = "You look customers up.";

interface Session {
  readonly customerId: string;
}

/** A tool that does nothing and declares `A` as its app type. */
function declaring<A>() {
  return defineTool<object, unknown, A>({
    name: "declaring",
    description: "Declares an app type.",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      return { content: [] };
    },
  });
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
  // The `app` must have both declared types, so one with only `customerId` is refused and one with both compiles.
  // @ts-expect-error: `app` lacks the `tenant` field that `other` declares.
  never(() => run({ ...base, tools: [lookupTool(), other], app: { customerId: "cust-1" } }));
  never(() => run({ ...base, tools: [lookupTool(), other], app: { customerId: "cust-1", tenant: 7 } }));
  // Types that cannot both hold leave no `app` that compiles, which shows the two tools cannot share a run.
  const text_ = declaring<string>();
  const count = declaring<number>();
  // @ts-expect-error: no value is both a string and a number.
  never(() => run({ ...mixed, tools: [text_, count], app: "x" }));
  // A tool may declare a union, such as a session that is signed in or anonymous, and the whole union is the type.
  type Visitor = { kind: "user"; id: string } | { kind: "anon" };
  const visitorTool = declaring<Visitor>();
  const visitor: Visitor = { kind: "anon" };
  never(() => run({ ...mixed, tools: [visitorTool], app: visitor }));
  never(() => run({ ...mixed, tools: [visitorTool, plain], app: { kind: "user", id: "u1" } }));
  // @ts-expect-error: a value outside the union is refused.
  never(() => run({ ...mixed, tools: [visitorTool], app: { kind: "bot" } }));
  // A declared type that includes `undefined` accepts it, because the tool says it can be absent.
  const maybe = declaring<Session | undefined>();
  never(() => run({ ...mixed, tools: [maybe], app: undefined }));
  // A tools list held in a variable, not written in the call, has the same rule.
  const held: readonly ToolDefinition<unknown, unknown, Session>[] = [lookupTool()];
  never(() => run({ ...mixed, tools: held, app: { customerId: "cust-1" } }));
  // @ts-expect-error: `app` is still required for a list held in a variable.
  never(() => run({ ...mixed, tools: held }));
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

/** A refund tool that records the app it ran for, a gate that asks, and the options both phases share. */
function refundSetup() {
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
  return { seen, options };
}

/** Pauses a refund for `app`, and returns what a resume needs: the stored context and the request. */
async function pausedRefund(options: ReturnType<typeof refundSetup>["options"], app: Session) {
  const first = await drive(
    run({ ...options, model: scripted([toolCall("refund", { reason: "late" })]).model, input: "Refund me.", app }),
  );
  assert.equal(first.result.stopReason, "awaiting_approval");
  const [request] = pendingOf(first.result);
  assert.ok(request);
  return { context: first.result.context, request, events: first.events };
}

const asApprover = (request: { id: string }) => ({
  requestId: request.id,
  decision: "allow" as const,
  by: "support-lead-9",
});

test("a call approved after a pause runs for the caller whose app data the resume passes back", async () => {
  const { seen, options } = refundSetup();
  const { context, request } = await pausedRefund(options, { customerId: "cust-1" });
  assert.deepEqual(seen, [], "nothing runs before a person answers");
  const resumed = await drive(
    continueRun(roundTrip(context), {
      ...options,
      model: scripted([text("Refunded.")]).model,
      resolutions: [asApprover(request)],
      app: { customerId: "cust-1" },
    }),
  );
  assert.equal(resumed.result.stopReason, "done");
  assert.deepEqual(seen, ["cust-1"], "the refund ran for the customer who asked, though a lead approved it");
});

test("a resume with other app data is refused with app_mismatch before the approved call runs", async () => {
  const { seen, options } = refundSetup();
  const { context, request } = await pausedRefund(options, { customerId: "cust-1" });
  const started = continueRun(roundTrip(context), {
    ...options,
    model: scripted([text("Refunded.")]).model,
    resolutions: [asApprover(request)],
    app: { customerId: "support-lead-9" },
  });
  const events: AgentEvent[] = [];
  const collected = (async () => {
    for await (const event of started) events.push(event);
  })();
  await assert.rejects(started.result, (error) => isSdkError(error) && error.code === "app_mismatch");
  await collected.catch(() => undefined);
  assert.deepEqual(seen, [], "the refund never ran");
  const rejected = events.find((event) => event.type === "resolution_rejected");
  assert.equal(rejected?.type === "resolution_rejected" ? rejected.cause : undefined, "app_mismatch");
});

test("a resume with no app data is refused too, even when the types say it must pass some", async () => {
  const { seen, options } = refundSetup();
  const { context, request } = await pausedRefund(options, { customerId: "cust-1" });
  const started = continueRun(roundTrip(context), {
    ...options,
    model: scripted([text("Refunded.")]).model,
    resolutions: [asApprover(request)],
    // The compiler refuses a missing `app` here, so the test bypasses it, as untyped code can.
  } as never);
  await assert.rejects(started.result, (error) => isSdkError(error) && error.code === "app_mismatch");
  assert.deepEqual(seen, []);
});

test("the same app with its keys in another order is the same app, and the request holds a hash, not the app", async () => {
  const { seen, options } = refundSetup();
  const app = { customerId: "cust-1", region: "eu" };
  const { context, request } = await pausedRefund(options as never, app as Session);
  assert.equal(request.appHash, await canonicalInputHash(app));
  assert.ok(!JSON.stringify(context).includes("cust-1"), "the stored context holds no app data");
  const reordered = { region: "eu", customerId: "cust-1" };
  const resumed = await drive(
    continueRun(roundTrip(context), {
      ...options,
      model: scripted([text("Refunded.")]).model,
      resolutions: [asApprover(request)],
      app: reordered,
    }),
  );
  assert.equal(resumed.result.stopReason, "done");
  assert.deepEqual(seen, ["cust-1"]);
});

test("a pause signed without app data binds none, so a resume of it takes any app", async () => {
  const seen: unknown[] = [];
  const refund = defineTool<{ reason: string }>({
    name: "refund",
    description: "Refund.",
    inputSchema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    effect: { kind: "write" },
    async execute(_input, ctx) {
      seen.push(ctx.app);
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
    run({ ...options, model: scripted([toolCall("refund", { reason: "late" })]).model, input: "Refund me." }),
  );
  const [request] = pendingOf(first.result);
  assert.ok(request && !("appHash" in request), "no app data, no binding");
  const resumed = await drive(
    continueRun(roundTrip(first.result.context), {
      ...options,
      model: scripted([text("Refunded.")]).model,
      resolutions: [{ requestId: request.id, decision: "allow" }],
      app: { anything: true },
    }),
  );
  assert.equal(resumed.result.stopReason, "done");
  assert.deepEqual(seen, [{ anything: true }]);
});
