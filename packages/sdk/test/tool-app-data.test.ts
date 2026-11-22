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
