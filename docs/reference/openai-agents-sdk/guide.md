# Building agents with the OpenAI Agents SDK: a provider-neutral loop whose defaults report to OpenAI

*Version `@openai/agents@0.22.0`, TypeScript, November 2026. **[verified: NN]** marks a claim asserted by example `NN` in [`verify/openai-agents-sdk/examples/`](../../../verify/openai-agents-sdk/examples/), run offline on the SDK's own `ScriptedModel`. Other claims cite their upstream page in [`source/`](source/), mirrored from git tag `v0.22.0`; [fact-check.md](fact-check.md) rates those pages.*

The OpenAI Agents SDK runs a small agent loop inside your Node.js process. The SDK ships the most complete set of control primitives of the SDKs in this repo: handoffs, three kinds of guardrails, human approval that survives a restart, and first-party test doubles. Any model provider can drive it, yet several defaults assume OpenAI's platform. Tracing exports every run to OpenAI unless you turn it off, and hosted tools, server-side sessions and tool search work only with OpenAI's Responses API. In this guide, I show how the SDK's loop and primitives fit together, and how to build a production agent on them. That agent gates risky tools with `needsApproval`, guards input before the model runs, and decides up front where its traces and sessions live.

## 1. The SDK is a library loop that you run and can re-point

`@openai/agents` bundles three packages, as its `package.json` dependencies show: `agents-core` (the loop, tools, guardrails, sessions), `agents-openai` (the OpenAI provider and its hosted tools) and `agents-realtime` (voice). A separate package, `agents-extensions`, adds an AI SDK model adapter (`models.mdx`). You call `run(agent, input)`, or `runner.run()` on a long-lived `Runner`, and the loop runs in your process (`running-agents.mdx`):
1. Call the current agent's model with the current input.
2. On a final output, return it. On a handoff, switch agents and keep the history. On tool calls, run the tools, append the results, and go back to step 1.
3. Throw `MaxTurnsExceededError` once `maxTurns` is reached.

The contrast with the other references explains the design. Claude's SDK spawns a CLI process that owns the loop, and Pi's SDK is a full harness with built-in file and shell tools. This SDK sits between them: an in-process loop like Pi's, but with no built-in tools that touch your machine unless you add them. Because model names resolve through a `ModelProvider`, `setDefaultModelProvider()` re-points every run at another provider, which is also how the test harness swaps in a scripted model (section 13).

## 2. Install, then decide where traces go

```bash
npm install @openai/agents zod
```

The SDK is MIT-licensed and needs only an OpenAI API key for OpenAI models (`quickstart.mdx`). Make one decision before your first run, though:

> **Gotcha.** Tracing is on by default in Node.js, Deno and Bun, and it exports each run's model calls, tool calls, handoffs and guardrails to OpenAI's Traces dashboard. It is off by default only in browsers and when `NODE_ENV=test` (`tracing.mdx`). Set `OPENAI_AGENTS_DISABLE_TRACING=1`, or pass `tracingDisabled: true` to `new Runner(...)`, unless you intend to send traces to OpenAI. **[verified: every example runs with tracing disabled]**

## 3. A run ends in `finalOutput` or a typed error

A minimal agent:

```ts
import { Agent, run } from "@openai/agents";

const agent = new Agent({ name: "Greeter", instructions: "Greet the user in one sentence." });
const result = await run(agent, "Say hello.");
console.log(result.finalOutput);
```

`finalOutput` holds the answer, `lastAgent` names the agent that produced it, and the agent's `instructions` reach the model as its system instructions. **[verified: 01]** The loop treats a model response as final when it contains text of the agent's output type and no tool calls (`running-agents.mdx`).

`maxTurns` defaults to 10, and the package's `DEFAULT_MAX_TURNS` agrees. Exceeding it throws `MaxTurnsExceededError`, which carries the run's `state`. **[verified: 08]** The SDK's other errors all extend `AgentsError`: `ModelBehaviorError`, `ModelRefusalError`, `ModelTimeoutError`, `GuardrailExecutionError`, `ToolTimeoutError`, `ToolCallError` and `UserError`. Three more exist only in the package: `InvalidToolInputError`, `InvalidToolOutputError` and `SystemError` (fact-check, Tier 3).

## 4. Sixteen agent options, all documented

`new Agent({...})` accepts 16 options, and `agents.mdx` lists all 16 (fact-check, Tier 3):

| Concern | Options |
|---|---|
| Identity and prompt | `name`, `instructions` (a string or a function), `prompt` |
| Model | `model` (a name or a `Model`), `modelSettings` |
| Tools | `tools`, `mcpServers`, `mcpConfig`, `toolUseBehavior`, `resetToolChoice` |
| Delegation | `handoffs`, `handoffDescription`, `handoffOutputTypeWarningEnabled` |
| Safety and output | `inputGuardrails`, `outputGuardrails`, `outputType` |

Only `name` is required. The docs table marks `instructions` required too, but `AgentOptions` makes it optional, and the SDK's JSDoc only "strongly recommends" it (fact-check, F2). Per-run options such as `maxTurns`, `session`, `signal` and `context` go to `run()`, and runner-wide defaults such as `modelProvider`, `tracingDisabled` and the guardrails go to `new Runner(...)` (`running-agents.mdx`).

## 5. Function tools run your code; hosted tools run on OpenAI

The SDK groups tools into six categories (`tools.mdx`):
- **Function tools:** your code, with a Zod or JSON Schema for the parameters.
- **Agents as tools:** another agent, called and returned like a function.
- **MCP servers:** hosted MCP, Streamable HTTP or stdio.
- **Hosted tools:** web search, file search, code interpreter, image generation, tool search and programmatic tool calling, which run on OpenAI's side.
- **Built-in execution tools:** computer use, shell, apply-patch, and a sandbox agent's shell and filesystem tools. They run against implementations you supply, a hosted container, or the sandbox workspace.
- **Experimental:** the Codex tool.

A function tool's `execute()` receives arguments already parsed by its Zod schema, and the result returns to the model in the next request:

```ts
import { tool } from "@openai/agents";
import { z } from "zod";

const weather = tool({
  name: "get_weather", description: "Gets the weather for a city.",
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => `${city}: sunny`,
});
```

**[verified: 02]** Function tools also take their own `inputGuardrails` and `outputGuardrails`, and a `needsApproval` predicate (sections 7 and 8). Hosted tools, tool search and namespaced or deferred tools need OpenAI's Responses API, so they stop working when you move to another provider (`tools.mdx`, `models.mdx`).

> **Gotcha.** `toolChoice: 'required'` forces the model to call one of the agent's tools, even for a request that needs none. For a read-only request, expose only read-only tools: if a user asks for a ticket's status and the only tools add a comment or close the ticket, a forced call can change the ticket. With the default `resetToolChoice`, the SDK clears the forced choice only after the agent has used a tool, so use `'auto'` when the model may also answer without one. Source: `guides/agents.mdx`, "Forcing tool use", added in v0.22.0; none of our examples runs it.

## 6. Handoffs transfer the conversation to another agent

An agent lists specialists in `handoffs`, and the SDK offers each one to the model as a tool. When the model calls it, the specialist takes over with the full history, answers, and becomes `lastAgent`. **[verified: 03]**

> **Gotcha.** The handoff tool is named `transfer_to_` plus the agent's name with spaces replaced. `handoffs.mdx` says an agent called `Refund Agent` gets `transfer_to_refund_agent`, but 0.22.0 produces `transfer_to_Refund_Agent`, keeping the capitals. **[verified: 03]** Set `toolNameOverride` if you match on tool names in logs or guardrails (fact-check, F1).

## 7. Three kinds of guardrails cover input, output and each tool call

Guardrails come in three families, and each runs at a different boundary (`guardrails.mdx`):
- **Input guardrails** run only for the first agent in a chain, on the user's input.
- **Output guardrails** run only for the agent that produces the final output.
- **Tool guardrails** run around every function-tool call, which makes them the choice for checks across handoffs.

A tripped input guardrail throws `InputGuardrailTripwireTriggered`, and a tripped output guardrail throws `OutputGuardrailTripwireTriggered`. **[verified: 04]** Input guardrails run in parallel with the model by default. With `runInParallel: false`, the guardrail finishes first and the model is never called when it trips, which saves the model call and keeps blocked input away from the model. **[verified: 04]**

## 8. Human approval pauses a run, and the state survives a restart

A tool with `needsApproval` (a boolean, or an async predicate over the call's arguments) pauses the run instead of executing (`human-in-the-loop.mdx`):

```ts
const first = await run(agent, "Refund order A-1");      // first.interruptions has the pending call
const saved = JSON.stringify(first.state);                // store it anywhere
const state = await RunState.fromString(agent, saved);    // later, possibly in another process
state.approve(first.interruptions[0]);                    // or state.reject(...)
const done = await run(agent, state);                     // resumes where it paused
```

Before approval, the tool never executes. After `approve()` it executes exactly once, and after `reject()` it never does, while the model still receives the rejection and finishes. **[verified: 05]** Because the paused state serialises to JSON, a web app can show the pending call to a person and resume hours later from another process. The docs add one caution: browser and mobile approval UIs should keep the state on the server, because the restored state is trusted (`examples/docs/human-in-the-loop/index.ts`).

## 9. Sessions keep history, locally or on OpenAI's servers

A session stores the conversation between runs; pass it as `run(agent, input, { session })` (`sessions.mdx`):
- **`MemorySession`** keeps history in memory. The second run's request carries the first run's messages. **[verified: 06]**
- **`OpenAIConversationsSession`** stores history on OpenAI's Conversations API, server side.
- **`OpenAIResponsesCompactionSession`** wraps a session and compacts history through the Responses API.
- **A custom `Session`** implements the interface over your own database; the docs ask for atomic, idempotent writes.

The server-side sessions need an OpenAI API key and the Responses API, so the offline harness skips their doc examples (fact-check, Tier 2). As an alternative to sessions, `conversationId` and `previousResponseId` let OpenAI's servers hold the history (`running-agents.mdx`).

Sessions hold history, not long-term memory. For memory that outlives a conversation, sandbox agents take a `memory()` capability that distils past runs into memory files over a `MemoryStore`, and it forgets by keeping only the newest conversations once `maxRawMemoriesForConsolidation` is exceeded (`guides/sandbox-agents/memory.mdx`). No example tests it yet (fact-check M1 and M2, as of November 2026).

## 10. A Zod `outputType` turns the final answer into a typed object

Set `outputType` to a Zod schema, and the model receives a JSON Schema output type while `finalOutput` arrives parsed and typed:

```ts
const Ticket = z.object({ title: z.string(), priority: z.enum(["low", "medium", "high"]) });
const agent = new Agent({ name: "Ticketer", outputType: Ticket });
const { finalOutput } = await run(agent, "Safari login crashes.");   // finalOutput: { title, priority }
```

**[verified: 07]** Output that fails the schema throws `ModelBehaviorError`. **[verified: 07]** Unlike the Claude SDK, which needs draft-07 schemas, this SDK takes Zod 4 schemas directly.

## 11. Streaming emits raw model events and run-item events

`run(agent, input, { stream: true })` returns a `StreamedRunResult` that yields events as they arrive (`streaming.mdx`). Run-item events have ten names in the package, from `message_output_created` and `tool_called` to `handoff_occurred` and `tool_approval_requested`. The docs list nine; `compaction_item_created` is missing from the table (fact-check, Tier 3).

## 12. Sandbox agents add a managed workspace

`SandboxAgent` gives the model a persistent workspace with filesystem tools, shell commands and session state. A `Manifest` declares what goes into the workspace, and a sandbox client runs it: `UnixLocalSandboxClient` for trusted local development on macOS or Linux, `DockerSandboxClient`, or a hosted client (`sandbox-agents.mdx`). Sandbox agents ship in the JS SDK as well as the Python SDK. Seven sandbox doc examples ran offline in our harness, but this reference adds no behavioral test for sandboxes. Sandbox capabilities reach the model as ordinary function tools (`exec_command`, `write_stdin`, `view_image`), so a test model must deny them by name (fact-check, Tier 2).

## 13. First-party test doubles make the whole loop testable offline

`@openai/agents/testing` exports `ScriptedModel`, which consumes one scripted step per model call and records every request (`testing.mdx`):

```ts
import { assistantMessage, functionCall, ScriptedModel } from "@openai/agents/testing";

const model = new ScriptedModel([
  [functionCall("get_weather", { city: "Lisbon" }, { callId: "call_1" })],
  [assistantMessage("It is sunny in Lisbon.")],
]);
const agent = new Agent({ name: "Weather", model, tools: [weather] });
const result = await new Runner({ tracingDisabled: true }).run(agent, "Weather in Lisbon?");
model.assertComplete();   // every scripted step was consumed
```

The real tool pipeline, guardrails and hooks run between the scripted steps, and `model.calls`, `firstCall` and `lastCall` expose each request for assertions. **[verified: 01–09]** `modelResponder()` computes a response from the request, which is how the harness's preload runs unmodified doc examples. Two caveats apply. `ScriptedModel` copies its steps into an array, so a script can't be an endless generator. And tracing is a separate boundary: disable it, or a test can still export a run.

## 14. Other providers plug in through the model provider

Model names resolve through the runner's `modelProvider`, so the SDK runs on any provider that implements `ModelProvider` or `Model`, and `agents-extensions` adapts AI SDK models (`models.mdx`). `setDefaultModelProvider()` switches the default for every runner. The cost of switching is the OpenAI-only features: hosted tools, server-side sessions and tool search, which need the Responses API.

## 15. Production agents need four decisions made up front

Four choices keep a deployed agent safe and private:
- **Traces.** Disable tracing, or keep it deliberately, knowing each run goes to OpenAI.
- **Gates.** Put `needsApproval` on every tool that changes state, store the paused state on the server, and use `runInParallel: false` for input guardrails that must block before the model runs.
- **History.** Choose `MemorySession`, a custom session over your database, or OpenAI's server-side storage, and keep the choice consistent across runs.
- **Limits.** Leave `maxTurns` at its default of 10 or lower, and catch `MaxTurnsExceededError` and the guardrail errors.

## 16. A gated triage agent takes four layers

The capstone [`09-triage-agent.ts`](../../../verify/openai-agents-sdk/examples/09-triage-agent.ts) builds the same support-triage agent as the Claude and Pi references:
1. **Tools.** `lookup_customer` reads data, and `escalate` sets `needsApproval: async () => true`.
2. **An input guardrail** with `runInParallel: false` blocks prompt-injection attempts before any model call. **[verified: 09]**
3. **A Zod `outputType`** returns the triage result as a typed object. **[verified: 09]**
4. **Approval.** The run pauses at `escalate`, a person rejects it through the serialised `RunState`, and the run still finishes with a typed result. The escalation never executes. **[verified: 09]**

```bash
pnpm install && pnpm --filter @buildanagent/verify-openai-agents-sdk test
```

## 17. Nine runnable examples back every [verified] claim

| File | Demonstrates |
|---|---|
| `01-hello-agent.ts` | `Agent`, `run`, `finalOutput`, `lastAgent`, `assertComplete()` |
| `02-function-tool.ts` | `tool()` with Zod, the tool result in the next request |
| `03-handoff.ts` | `handoffs`, the generated `transfer_to_` tool, `lastAgent` after a handoff |
| `04-guardrails.ts` | Input and output tripwires, and `runInParallel: false` skipping the model |
| `05-approval-resume.ts` | `needsApproval`, `RunState` serialisation, `approve()` and `reject()` |
| `06-session.ts` | `MemorySession` carrying history between runs |
| `07-structured-output.ts` | Zod `outputType`, and `ModelBehaviorError` on bad output |
| `08-max-turns.ts` | `MaxTurnsExceededError` and its `state` |
| `09-triage-agent.ts` | The capstone, combining all of the above |

## Conclusion: own the gates and the defaults, and the SDK does the rest

The OpenAI Agents SDK suits teams that want an in-process loop with first-class approvals, guardrails and handoffs, and tests that run offline without a key. Its docs are accurate, too: all 16 agent options and the `maxTurns` default match the package, and 178 of its 182 doc sources compile cleanly. What a team must add is its own view of the defaults: decide where traces go, which history store to trust, and which tools may act without a person. To start, copy [`09-triage-agent.ts`](../../../verify/openai-agents-sdk/examples/09-triage-agent.ts), swap in your tools, put `needsApproval` on the ones that change state, and run `pnpm --filter @buildanagent/verify-openai-agents-sdk test` to confirm the gates still hold.
