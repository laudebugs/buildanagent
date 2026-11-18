---
name: openai-agents-sdk
description: Use when writing, reviewing or testing TypeScript that imports `@openai/agents` (Agent, run, Runner, tool, handoffs, guardrails, needsApproval, RunState, sessions, outputType, SandboxAgent, ScriptedModel). Gives the verified setup, the approval-and-resume flow, the gotchas from our fact-check, and how to test offline with ScriptedModel.
---

# OpenAI Agents SDK (`@openai/agents@0.21.0`)

The SDK runs an in-process loop with handoffs, input/output/tool guardrails, approvals that survive a restart, and sessions. Any `ModelProvider` can drive it, but tracing exports every run to OpenAI by default. Full reference: [`docs/reference/openai-agents-sdk/guide.md`](../../../docs/reference/openai-agents-sdk/guide.md); verified examples: [`verify/openai-agents-sdk/examples/`](../../../verify/openai-agents-sdk/examples/).

## When to use it

Choose it for multi-agent workflows that need guardrails, handoffs and approvals a person can grant hours later. Choose the Vercel AI SDK for the thinnest provider-neutral loop, and Pi to own the whole harness ([comparison](../../../docs/comparison/deep-comparison.md)).

## Minimal setup

```bash
pnpm add @openai/agents zod   # in this repo: pnpm only, exact pins
export OPENAI_AGENTS_DISABLE_TRACING=1   # unless you want runs exported to OpenAI
```

```ts
import { Agent, RunState, Runner, tool } from "@openai/agents";
import { z } from "zod";

const escalate = tool({
  name: "escalate", description: "Escalate to on-call",
  parameters: z.object({ reason: z.string() }),
  needsApproval: async () => true,
  execute: async () => "escalated",
});
const Triage = z.object({ category: z.enum(["bug", "billing", "question"]), summary: z.string() });
const agent = new Agent({ name: "Triage", instructions: "Classify the ticket.", tools: [escalate], outputType: Triage });
const runner = new Runner({ tracingDisabled: true });

const first = await runner.run(agent, "Checkout fails for user@example.com");
if (first.interruptions.length) {
  const state = await RunState.fromString(agent, JSON.stringify(first.state)); // store anywhere, resume later
  state.reject(state.getInterruptions()[0]);                                   // or state.approve(...)
  const done = await runner.run(agent, state);
  console.log(done.finalOutput?.category);                                     // typed by outputType; T | undefined
}
```

## Patterns that hold (verified)

- **A run returns `finalOutput` and `lastAgent`**; `instructions` become the system instructions. Only `name` is required.
- **`tool()` parameters are Zod-parsed** before `execute()`, and the result goes back in the next request.
- **`needsApproval` pauses the run** with `interruptions`; `RunState` serialises to JSON; `approve()` runs the tool once, `reject()` never, and the model still finishes.
- **Guardrails:** input guardrails run for the first agent, output guardrails for the last; tripwires throw `InputGuardrailTripwireTriggered` / `OutputGuardrailTripwireTriggered`. Set `runInParallel: false` so a tripped input guardrail stops the run before any model call:

  ```ts
  const noInjection: InputGuardrail = {           // InputGuardrail is exported by @openai/agents
    name: "No injection", runInParallel: false,
    execute: async ({ input }) => ({              // input: string | ModelItem[]
      outputInfo: null,
      tripwireTriggered: /ignore previous instructions/i.test(JSON.stringify(input)),
    }),
  };
  new Agent({ name: "Triage", inputGuardrails: [noInjection] });
  ```
- **Handoffs** are tools; the specialist answers and becomes `lastAgent`.
- **`maxTurns` defaults to 10** and throws `MaxTurnsExceededError` with the run `state`.
- **A Zod `outputType`** yields a typed `finalOutput`; invalid output throws `ModelBehaviorError`.
- **`MemorySession`** carries history between runs: `run(agent, input, { session })`.

## Gotchas (from the fact-check)

- **Tracing is on** in Node.js, Deno and Bun and exports model calls, tool calls, handoffs and guardrails to OpenAI. Disable it with `OPENAI_AGENTS_DISABLE_TRACING=1` or `new Runner({ tracingDisabled: true })`.
- **Handoff tool names keep the agent name's case:** "Refund Agent" becomes `transfer_to_Refund_Agent`, not the documented `transfer_to_refund_agent`. Set `toolNameOverride` if you match on names.
- **Hosted tools, tool search, server-side sessions and compaction sessions** need OpenAI's Responses API.
- **Sandbox agents expose `exec_command`, `write_stdin` and `view_image` as ordinary function tools.** A test model must deny them by name.
- **Keep paused `RunState` on the server**; the restored state is trusted.
- **Undocumented items:** the `compaction_item_created` stream event and the `InvalidToolInputError` and `SystemError` classes.

## Test offline

Use `ScriptedModel` from `@openai/agents/testing`: `new ScriptedModel([step, step, …])`, one step per model call, each step an array of items such as `functionCall(name, args, { callId })` (the `callId` is required) or `assistantMessage(text)`. For a Zod `outputType`, script the final step as `assistantMessage(JSON.stringify({...}))`. Attach it with `new Agent({ …, model })`, run with `new Runner({ tracingDisabled: true })`, assert on `model.calls` (each has `.request.input`), and finish with `model.assertComplete()`.

Run one new file offline, without touching committed results, from `verify/openai-agents-sdk`: `node scripts/run-examples.mjs <dir> --only <name>`. The runner prints only the outcome, so run the file with tsx to see its output. Run the verified examples with:

```bash
pnpm --filter @agent-speak/verify-openai-agents-sdk test
```
