---
name: google-adk
description: Use when writing, reviewing or testing TypeScript that imports `@google/adk` (LlmAgent, Runner, InMemoryRunner, FunctionTool, session state and its user:/app:/temp: prefixes, callbacks, BasePlugin, outputSchema, outputKey, requireConfirmation, the graph Workflow, a BaseLlm test subclass). Gives the verified 2.5.0 setup, the confirm-and-resume flow, the gotchas from our fact-check, and how to test offline with a scripted BaseLlm.
---

# Google ADK for TypeScript (`@google/adk@2.5.0`, `@google/genai@2.32.0`)

An `LlmAgent` holds the model, instruction, tools and callbacks; a `Runner` drives it over a session and yields every event. ADK is Python-first, so its docs undersell the TypeScript port (they deny it `requireConfirmation`) and oversell it (they promise `outputSchema` enforcement it lacks). Full reference: [`docs/reference/google-adk/guide.md`](../../../docs/reference/google-adk/guide.md); findings: [`fact-check.md`](../../../docs/reference/google-adk/fact-check.md); verified examples: [`verify/google-adk/examples/`](../../../verify/google-adk/examples/).

## When to use it

Choose ADK for Gemini-first agents and graph workflows in Node.js, if you will re-validate structured output and check each "Python only" docs tag against the `.d.ts`. Choose the Vercel AI SDK for the thinnest loop across providers, the OpenAI Agents SDK for guardrails, handoffs and approvals that survive a restart, and LangChain.js for ready-made middleware ([feature table](../../../docs/comparison/feature-table.md#choose-by-the-safety-work-you-want-to-own)). TypeScript 2.5.0 lacks 14 Python features, among them LiteLLM (so no Ollama or vLLM), context caching and session rewind ([gaps](../../../docs/comparison/typescript-gaps.md#google-adk-the-port-trails-python-by-14-features-but-the-docs-undersell-it-by-15)).

## Minimal setup

```bash
pnpm add @google/adk @google/genai zod   # in this repo: pnpm only, exact pins
export GEMINI_API_KEY=...                # a model string such as "gemini-flash-latest" resolves to Gemini
```

```ts
import type { Context, Event } from "@google/adk";
import { FunctionTool, InMemoryRunner, LlmAgent, REQUEST_CONFIRMATION_FUNCTION_CALL_NAME } from "@google/adk";
import type { Content } from "@google/genai";
import { z } from "zod";

const lookupCustomer = new FunctionTool({
  name: "lookup_customer", description: "Look up the current customer's plan.",
  parameters: z.object({}),                                   // identity comes from state, never from the model
  execute: (_args, ctx?: Context) => ({ customerId: ctx?.state.get<string>("user:customer_id"), plan: "pro" }),
});
const escalate = new FunctionTool({
  name: "escalate_to_human", description: "Escalate the ticket to a human.",
  parameters: z.object({ reason: z.string() }),
  requireConfirmation: true,                                  // or a predicate over the arguments
  execute: () => ({ status: "escalated" }),
});
const Triage = z.object({ category: z.enum(["billing", "bug", "other"]), escalated: z.boolean(), summary: z.string() });
const agent = new LlmAgent({
  name: "triage", model: "gemini-flash-latest",               // or a BaseLlm instance
  instruction: "Look up the customer, then triage. Escalate billing disputes.",
  tools: [lookupCustomer, escalate], outputSchema: Triage, outputKey: "triage",
});
const runner = new InMemoryRunner({ agent, appName: "support" });
const { id: sessionId } = await runner.sessionService.createSession({
  appName: "support", userId: "ada", state: { "user:customer_id": "cust-42" },
});
const send = async (newMessage: Content) => {
  const events: Event[] = [];
  for await (const e of runner.runAsync({ userId: "ada", sessionId, newMessage })) events.push(e);
  return events;
};
const first = await send({ role: "user", parts: [{ text: "I was charged twice." }] });
const ask = first.flatMap((e) => e.content?.parts ?? []).find((p) => p.functionCall?.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME);
if (ask) {
  const response = { confirmed: true };                       // false: the tool never runs
  await send({ role: "user", parts: [{ functionResponse: { id: ask.functionCall?.id, name: REQUEST_CONFIRMATION_FUNCTION_CALL_NAME, response } }] });
}
const stored = await runner.sessionService.getSession({ appName: "support", userId: "ada", sessionId });
console.log(Triage.parse(stored?.state.triage));              // re-validate: ADK only logs a violation
```

The setup trims the capstone [`08-triage-agent.ts`](../../../verify/google-adk/examples/08-triage-agent.ts) and swaps its scripted model for a model string.

## Patterns that hold (verified)

- **`runAsync` yields events as they happen:** the function call, the tool response, then the final answer, which `isFinalResponse(event)` detects. ADK prepends `Your internal name is "<name>"` to your instruction.
- **`FunctionTool` parameters are a zod object** that becomes the Gemini declaration. A non-object return comes back as `{ result }`. Invalid arguments skip the body and reach the model as `{ error }`, and the run continues (F14).
- **State keys carry their scope:** an unprefixed key lives in one session, `user:` spans a user's sessions, `app:` spans every user, and `temp:` lasts one invocation. Tools write with `ctx.state.set`; outside a run, append an event whose `actions` carry a `stateDelta`. `getSession` returns a copy, so mutating it changes nothing.
- **Callbacks are `LlmAgent` options:** `beforeAgentCallback`, `afterAgentCallback`, and the same pairs for `Model` and `Tool`. A before-callback that returns a value replaces the step; a `beforeToolCallback` returning an object blocks the tool, and the model receives that object.
- **Plugins extend `BasePlugin`** and register with `new InMemoryRunner({ …, plugins })`. Their hooks run first, and a hook that returns a value pre-empts the agent's callback.
- **`outputSchema` becomes `responseSchema`,** and `outputKey` stores the parsed object. With tools, ADK offers a `set_model_response` tool instead and turns its arguments into the answer.
- **`requireConfirmation` pauses before the body** with a long-running `adk_request_confirmation` call. `{ confirmed: true }` runs the tool once with the original arguments; `false` returns `{ error: "This tool call is rejected." }`. The pause lives in session events, so the answer can come in a later request. After the resume the model sees a `functionResponse` named after the original tool (the error object on reject), so script the next step by `functionResponse.name`.
- **`Workflow` graphs** wire `node()` functions, agents and tools with edges from `"START"`; each output is the next input. `createEvent({ route })` picks a branch, `JoinNode` collects `{ nodeName: output }`, and `RequestInput` pauses until the next user message.
- **`RunConfig.maxLlmCalls` defaults to 500** (guide §11). Lower it, and pick a persistent session service before launch.

## Gotchas (from the fact-check)

- **`requireConfirmation` exists** although the confirmation page tells TypeScript users to build approval by hand in `execute` (F2). A `requireConfirmation` tool used directly as a graph node does not pause; use `RequestInput` inside a `Workflow`. A confirmation for a call id ADK never issued runs nothing, and the tool asks again (F15).
- **`outputSchema` is only logged.** Non-JSON or invalid JSON lands in `outputKey` with no error event, and an agent without `outputKey` never checks at all. Parse the stored value with your own zod schema (F10).
- **`Workflow` is experimental:** constructing one logs a warning, but the `.d.ts` has no tag, so your editor stays silent (F8). `SequentialAgent`, `ParallelAgent` and `LoopAgent` are deprecated, and a `Workflow` cannot yet be an `LlmAgent` sub-agent (F13). Pin the minor version either way.
- **Callback and plugin parameter names differ.** Agent callbacks take `({ tool, args, context })` and `({ context, request })`; plugin hooks take `({ tool, toolArgs, toolContext })` and `({ callbackContext, llmRequest })` (F12). Hooks take one object: the docs' positional `beforeAgentCallback(agent, context)` gets `context === undefined` (F1).
- **"Python only" tags are often wrong for TypeScript.** 152 of the docs' 261 support tags list Python but not TypeScript, yet 2.5.0 ships 15 of those features, including `App` plugins (F9), `runLive`, resumability and `DatabaseSessionService`. Check the `.d.ts` before you rule a feature out.
- **Tool calls from one model turn run in sequence,** unlike Python. Merge slow, independent lookups into one tool (F11).
- **Copied doc code breaks in three ways:** `import type` on a runtime helper such as `createEvent` (F3), `Event`/`createEvent` imported from `@google/genai` instead of `@google/adk` (F4), and a plain function in `tools` instead of a `FunctionTool` (F6).

## Test offline

ADK ships no fake model, so subclass `BaseLlm`: [`verify/google-adk/examples/lib/check.ts`](../../../verify/google-adk/examples/lib/check.ts) has `ScriptedLlm`, a function from `(request, callNumber)` to an `LlmResponse`, plus `callTool(name, args)`, `say(text)`, `afterTool(req)`, `lastParts(req)`, `offered(req)` (the tool names on a request, including ADK's own `set_model_response` when the agent has an `outputSchema`), `turn(runner, sid, msg, userId = "u1")`, `calls(events)` and `responses(events)`. `turn()` defaults to user `u1`, so match the `userId` your session was created with. Pass the instance as the agent's `model`, and assert on `model.requests`, which holds copies because ADK mutates requests between steps. For an agent with tools and `outputSchema`, script the final turn as `callTool("set_model_response", {…})`; that call ends the run, and `outputKey` holds its arguments. Function-only `Workflow` graphs need no model.

Run one new file offline, without touching committed results, from `verify/google-adk`: `node scripts/run-examples.mjs <dir> --only <name>`. The runner skips type-checking and prints only the outcome, so also run `pnpm exec tsc --noEmit -p .` and `pnpm exec biome check --write <file>`, and run the file with tsx to see its output. Run the verified examples with:

```bash
pnpm --filter @buildanagent/verify-google-adk test
```
