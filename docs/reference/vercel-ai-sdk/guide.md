# Building agents with the Vercel AI SDK: a model-call library with a thin, explicit tool loop

*Version `ai@7.0.162`, TypeScript, November 2026. **[verified: NN]** marks a claim asserted by example `NN` in [`verify/vercel-ai-sdk/examples/`](../../../verify/vercel-ai-sdk/examples/), run offline on `MockLanguageModelV4` from `ai/test`. Other claims cite their upstream page in [`source/content/`](source/content/), mirrored from git tag `ai@7.0.162`; [fact-check.md](fact-check.md) rates those pages.*

The Vercel AI SDK began as a library for calling models, and its agent support grew on top of that library rather than beside it. A single `generateText` call becomes an agent once you give it tools and a stop condition, and `ToolLoopAgent` packages those settings into a reusable object. The result is the thinnest loop of the four SDKs in this repo: no built-in tools, no session store, no tracing exporter. Two defaults still reach outside your process. Model strings such as `'openai/gpt-5'` go to Vercel's AI Gateway, and telemetry starts flowing as soon as you register an integration. In this guide, I explain how the loop, its stop conditions and its approval policy fit together, and I build a gated support-triage agent from them, one that sets its own step limit, approval gates and model routing instead of trusting the defaults.

## 1. The SDK is a model-call library with a thin tool loop on top

The `ai` package holds AI SDK Core: `generateText`, `streamText`, tools, structured output and the agent classes (`docs/03-ai-sdk-core/`, `docs/03-agents/`). Providers ship as separate packages, such as `@ai-sdk/openai` and `@ai-sdk/anthropic`, and each exposes models that implement one interface, the language model specification (`LanguageModelV4` in 7.0). Every agent feature runs through that interface, so the loop is the same for every provider:
1. Call the model with the prompt, the tools and the step's settings.
2. Run any tool calls whose tools have an `execute` function, and append the results.
3. Check `stopWhen`. If no condition holds and the step ended on tool calls, go back to step 1.

The contrast with the other references explains the design. Claude's SDK spawns a CLI that owns its loop, Pi ships a full harness with file and shell tools, and the OpenAI Agents SDK adds handoffs, guardrails and sessions. The AI SDK keeps only the loop and leaves memory, durability and sandboxes to separate packages (section 11). That thinness is the SDK's main trade-off: each piece is small and easy to replace, but you assemble more yourself.

## 2. Install, then choose a provider instance or a model string

```bash
npm install ai zod @ai-sdk/anthropic
```

The SDK is Apache-2.0 (`LICENSE` in the mirror). A model can be a provider instance or a string:

```ts
import { anthropic } from "@ai-sdk/anthropic";
model: anthropic("claude-sonnet-4-5");      // direct to Anthropic, reads ANTHROPIC_API_KEY
model: "anthropic/claude-sonnet-4-5";       // through the AI Gateway, reads AI_GATEWAY_API_KEY
```

> **Gotcha.** "The AI SDK uses AI Gateway by default for model strings" (`providers/…/05-anthropic.mdx`). A string model id sends the request through Vercel's gateway and its API key, instead of directly to the model's vendor. The SDK resolves strings through `globalThis.AI_SDK_DEFAULT_PROVIDER`, falling back to the gateway (`ai/dist/index.js`), so you can point strings at your own provider. The docs site also fills its examples' `__MODEL__` placeholder with a gateway string by default, so copied examples use the gateway unless you change them.

## 3. `generateText` returns the answer, and system prompts belong in `instructions`

A minimal call:

```ts
import { generateText } from "ai";

const result = await generateText({
  model,
  instructions: "You are terse.",
  prompt: "Say hello.",
});
console.log(result.text, result.usage, result.finishReason);
```

The result carries `text`, `steps`, `usage` and `finishReason`, and `instructions` reach the model as the system message. **[verified: 01]** In 7.0, a message with `role: 'system'` inside `prompt` or `messages` makes the call throw `InvalidPromptError`, unless you set `allowSystemInMessages: true` (`reference/…/30-model-message.mdx`). **[verified: 01]** The rule guards against prompt injection: a system message that arrives with chat history may have come from a user. Keep trusted instructions in `instructions`, and enable the flag only for histories you control. One page of the docs omits the flag (F2 in the fact-check).

## 4. Tools run in a loop only as long as `stopWhen` allows

A tool is a Zod (or JSON Schema) input schema plus an optional `execute` function:

```ts
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";

const weather = tool({
  description: "Get the weather for a city",
  inputSchema: z.object({ city: z.string(), unit: z.enum(["C", "F"]).default("C") }),
  execute: async ({ city, unit }) => ({ city, temperature: 21, unit }),
});

const result = await generateText({ model, tools: { weather }, stopWhen: isStepCount(5), prompt: "Weather in Lisbon?" });
```

`execute()` receives the input after the schema parses it, defaults included, and the SDK sends the tool result back to the model on the next step. **[verified: 02]** Input that fails the schema never reaches `execute()`. Instead the step records a `tool-error`, and the loop continues so the model can recover. **[verified: 02]**

> **Gotcha.** `generateText` and `streamText` default to `stopWhen: isStepCount(1)` (`generateTextInternal` in `ai/dist/index.js`). With that default, the SDK still runs the step's tools, but it never calls the model again, so `result.text` is empty. **[verified: 02]** Set `stopWhen` whenever you pass tools to these functions.

A tool without `execute` stops the loop and hands the call to you, which is how the cookbook's manual agent loop works (`cookbook/05-node/55-manual-agent-loop.mdx`). Provider-defined tools, such as `anthropic.tools.bash_20250124()` or `openai.tools.webSearch()`, have schemas fixed by the provider. Some run on the provider's servers, and Anthropic's bash tool runs commands through an `experimental_sandbox` you supply (`providers/…/05-anthropic.mdx`).

## 5. `ToolLoopAgent` packages the loop and stops after 20 steps by default

`ToolLoopAgent` takes the same settings as `generateText`, minus the prompt, and exposes `generate()` and `stream()` (`reference/…/16-tool-loop-agent.mdx`):

```ts
import { hasToolCall, isStepCount, ToolLoopAgent } from "ai";

const agent = new ToolLoopAgent({
  model,
  instructions: "You triage support tickets.",
  tools: { lookupOrder, finalAnswer },
  stopWhen: [hasToolCall("finalAnswer"), isStepCount(10)],
});
const result = await agent.generate({ prompt: "Where is order A-1?" });
```

Without `stopWhen`, the agent stops after 20 steps and logs a warning that names the default. **[verified: 07]** An explicit condition logs nothing, even `isStepCount(20)`. **[verified: 07]** Three helpers build stop conditions: `isStepCount(n)`, `hasToolCall(name)`, which stops right after that tool's step, and `isLoopFinished()`, which removes the cap (`agents/04-loop-control.mdx`). **[verified: 07]** An array of conditions stops when any one holds. **[verified: 07]** The package also exports `stepCountIs`, an older alias of `isStepCount` that the pages no longer use.

The agent's settings table documents 45 options, and every one exists in the package (fact-check, Tier 3). `prepareCall` and `callOptionsSchema` let one agent take typed per-call options, such as a user's account tier, and turn them into settings (`agents/05-configuring-call-options.mdx`).

## 6. `prepareStep` changes each step's settings before it runs

`prepareStep` runs before every step. It receives the step number, the earlier steps and the messages, and it returns overrides: `model`, `activeTools`, `toolChoice`, `instructions` or `messages` (`agents/04-loop-control.mdx`):

```ts
prepareStep: ({ stepNumber }) =>
  stepNumber === 0
    ? { activeTools: ["search"], toolChoice: { type: "tool", toolName: "search" } }
    : { activeTools: [] },
```

The SDK calls it once per step with the steps so far. On each request it offers only the active tools, and it forwards a forced `toolChoice`. **[verified: 04]** Use `prepareStep` to force a lookup first, to switch to a cheaper model after research, or to trim long histories before they reach the model.

## 7. Approval is a call-level policy, not a flag on the tool

In 7.0, `toolApproval` on `generateText`, `streamText` or `ToolLoopAgent` decides which tool calls need a person (`ai-sdk-core/15-tools-and-tool-calling.mdx`). The older `needsApproval` property on `tool()` still works, but its declaration is marked `@deprecated` ("Tool approval is handled on a `generateText` / `streamText` level now"), and the docs agree. A policy is a map from tool name to status, or one function for every call:
- `'not-applicable'` runs the tool normally; it is the default.
- `'approved'` and `'denied'` record an automatic decision, with an optional reason.
- `'user-approval'` stops the loop and returns a `tool-approval-request`.

The manual flow takes two calls (`agents/06-tool-approvals.mdx`):

```ts
const messages: ModelMessage[] = [{ role: "user", content: "Refund order A-1" }];
const first = await agent.generate({ messages });
messages.push(...first.responseMessages);
const ask = first.content.find((p) => p.type === "tool-approval-request");
messages.push({ role: "tool", content: [{ type: "tool-approval-response", approvalId: ask.approvalId, approved: true }] });
const second = await agent.generate({ messages });
```

The tool never runs on the first call. After approval it runs exactly once, and after a denial the model sees an `execution-denied` result and can still answer. **[verified: 03]** A `'denied'` policy skips the tool without stopping the loop. **[verified: 03]** The messages are the whole pause state, so you can store them anywhere and resume later.

> **Gotcha.** Approval responses arrive with the client's messages, so a client can forge one. Set `experimental_toolApprovalSecret` on the agent, or on `generateText` and `streamText`. The server then HMAC-signs each approval request and rejects a tampered or forged response before the tool runs (`agents/06-tool-approvals.mdx`).

Deterministic rules can come from an OPA policy through `@ai-sdk/policy-opa` (`agents/06-policy-tool-approvals.mdx`).

## 8. `Output.object` returns typed output, and two errors mark its failures

```ts
import { generateText, Output } from "ai";

const { output } = await generateText({
  model,
  output: Output.object({ schema: Triage, name: "triage", description: "Ticket triage" }),
  prompt: "I was charged twice!",
});
```

The SDK asks the model for JSON with the schema's JSON Schema and name, then parses and types `result.output`. **[verified: 05]** The options are `name` and `description`; `schemaName` belongs to the deprecated `generateObject` (F3). Two errors cover failure (`ai-sdk-core/10-generating-structured-data.mdx`). A response that fails the schema rejects with `NoObjectGeneratedError`, and reading `result.output` throws `NoOutputGeneratedError` when the last step ended on tool calls. **[verified: 05]** `Output.array`, `Output.choice` and `Output.text` cover the other shapes, and `output` works on `ToolLoopAgent` too. **[verified: 09]**

## 9. `streamText` returns at once and streams text or typed parts

`streamText` takes the same options and returns immediately (`ai-sdk-core/05-generating-text.mdx`). `result.textStream` yields text chunks, `result.stream` yields typed parts (`start`, `start-step`, `text-delta`, `finish-step`, `finish` and the tool parts), and promises such as `result.text` resolve when the stream ends. **[verified: 06]** A `text-delta` part carries its text in `text`. **[verified: 06]** Three pages still read `textDelta`, the property's name in older majors (F1). Callbacks such as `onEnd` fire only once something consumes the stream, so call `result.consumeStream()` when nothing else reads it. **[verified: 06]**

## 10. MCP tools become ordinary tools

`@ai-sdk/mcp` connects to an MCP server and converts its tools (`ai-sdk-core/16-mcp-tools.mdx`):

```ts
import { createMCPClient } from "@ai-sdk/mcp";

const client = await createMCPClient({ transport: { type: "http", url: "https://example.com/mcp" } });
try {
  const tools = await client.tools();
  await generateText({ model, tools, stopWhen: isStepCount(5), prompt });
} finally {
  await client.close();
}
```

`client.tools()` names each tool after the server's tool, and a model's call to one becomes an MCP `tools/call` whose result goes back to the model. **[verified: 08]** The client speaks HTTP, SSE and stdio, and it accepts any object that implements `MCPTransport`, which is how example 08 runs a server in-process. A custom transport that omits `supportsProtocolVersionDiscovery` uses the legacy `initialize` handshake. **[verified: 08]** Close the client when you finish; the docs' examples use `try`/`finally`.

## 11. Memory, durability and full harnesses live outside the core

Four needs fall outside `ToolLoopAgent`, and the SDK answers each with a separate package or pattern:
- **Memory.** There is no session store. The memory page lists three approaches: provider-defined memory tools (Anthropic's), memory providers such as Letta and Mem0, and a custom tool over your own store (`agents/06-memory.mdx`). Between calls, you keep `messages` yourself.
- **Durability.** `WorkflowAgent` in `@ai-sdk/workflow` runs the same loop as durable workflow steps, so a run survives restarts and approvals suspend the workflow. It still honours tool-level `needsApproval` (`agents/07-workflow-agent.mdx`).
- **Subagents.** A subagent is a tool whose `execute` calls another agent, which keeps a long subtask's context out of the parent's history (`agents/06-subagents.mdx`).
- **Harnesses.** `HarnessAgent` in `@ai-sdk/harness` runs a complete agent runtime, such as Claude Code, Codex or Pi, behind one AI SDK interface, with its own tools, sessions and compaction (`ai-sdk-harnesses/01-overview.mdx`).

This split matches the repo's reference architecture: a stateless loop in the core, with state and sandboxes behind separate interfaces. Our examples verify none of these four; the harness installs `@ai-sdk/harness` only to type-check its pages.

## 12. `MockLanguageModelV4` makes the loop testable offline

`ai/test` exports `MockLanguageModelV4`, `simulateReadableStream` and helpers for scripted responses (`ai-sdk-core/55-testing.mdx`). You supply `doGenerate` and `doStream`, and the mock records each request in `doGenerateCalls` and `doStreamCalls`. Our examples wrap it in a small `scripted()` helper that plays one turn per call and fails on an extra call (`examples/lib/check.ts`). **[verified: 01–09]** Because the mock sits below the loop, tests exercise the real tool execution, approval flow, stop conditions and output parsing. The doc-example harness goes further: a module hook swaps the OpenAI and Anthropic providers for mocks, so 116 unmodified doc examples run without a key (fact-check, Tier 2).

## 13. Telemetry is on once you register an integration

Telemetry in 7.0 is integration-based: register one, such as `OpenTelemetry` from `@ai-sdk/otel`, and "supported AI SDK calls emit telemetry events by default" (`ai-sdk-core/60-telemetry.mdx`). Telemetry is opt-out, so a call that must not be recorded needs `telemetry: { isEnabled: false }`. Leaving the integration unregistered also stops delivery to global integrations, but not to per-call integrations or Node.js tracing-channel subscribers. Decide which calls your traces may contain before you register one, because prompts and tool inputs go to whatever backend the integration exports to.

## 14. Production agents need four decisions made up front

Four choices keep a deployed agent safe and predictable:
- **Routing.** Use provider instances, or point `AI_SDK_DEFAULT_PROVIDER` at your own provider, unless you intend to route model strings through the AI Gateway.
- **Limits.** Set `stopWhen` on every call with tools and on every agent; the defaults are 1 step for `generateText` and 20 for `ToolLoopAgent`.
- **Gates.** Put `toolApproval: 'user-approval'` on every tool that changes state, set `experimental_toolApprovalSecret` so clients can't forge approvals, and persist `messages` so a paused run can resume.
- **Telemetry.** Register an integration deliberately, and opt sensitive calls out with `isEnabled: false`.

## 15. A gated triage agent takes four settings

The capstone [`09-triage-agent.ts`](../../../verify/vercel-ai-sdk/examples/09-triage-agent.ts) builds the same support-triage agent as the other references, on one `ToolLoopAgent`:
1. **Tools.** `lookupOrder` reads data, and `issueRefund` changes it.
2. **`toolApproval`.** `{ issueRefund: 'user-approval' }` stops the loop before the refund, so no refund runs until a person approves it. **[verified: 09]**
3. **`output`.** `Output.object` with a Zod schema returns the triage record as a typed object on the final call. **[verified: 09]**
4. **`stopWhen`.** `isStepCount(8)` caps the loop explicitly.

The run looks up the order, asks to refund it, resumes with the approval, refunds once and returns `{ category: "billing", action: "refunded", … }` in three model calls. **[verified: 09]**

```bash
pnpm install && pnpm --filter @agent-speak/verify-vercel-ai-sdk test
```

## 16. Nine runnable examples back every [verified] claim

| File | Demonstrates |
|---|---|
| `01-generate-text.ts` | `generateText`, `instructions`, usage, and `InvalidPromptError` for system messages |
| `02-tool-loop.ts` | `tool()` with Zod, the one-step default, `isStepCount`, tool errors |
| `03-tool-approval.ts` | `toolApproval`, approval requests and responses, denial |
| `04-prepare-step.ts` | `prepareStep` with `activeTools` and `toolChoice` |
| `05-structured-output.ts` | `Output.object`, `NoObjectGeneratedError`, `NoOutputGeneratedError` |
| `06-streaming.ts` | `textStream`, typed stream parts, `onEnd` |
| `07-agent-stop-conditions.ts` | `ToolLoopAgent`'s 20-step default and warning, `hasToolCall`, condition arrays |
| `08-mcp-tools.ts` | `createMCPClient` over a custom in-process transport |
| `09-triage-agent.ts` | The capstone, combining all of the above |

## Conclusion: set the limits and gates yourself, and the thin loop stays predictable

The Vercel AI SDK suits teams that want an agent loop they can read in an afternoon, across any provider, with tests that run offline. Its docs are accurate where it matters: every documented option of `generateText`, `streamText`, `ToolLoopAgent` and `tool()` exists, and 116 doc examples ran unmodified on a mock model. What the SDK leaves to you is the policy: route model strings deliberately, set `stopWhen` on every loop, and gate every state-changing tool with `toolApproval`. To start, copy [`09-triage-agent.ts`](../../../verify/vercel-ai-sdk/examples/09-triage-agent.ts), swap in your tools and schema, and run `pnpm --filter @agent-speak/verify-vercel-ai-sdk test` to confirm the gates still hold.
