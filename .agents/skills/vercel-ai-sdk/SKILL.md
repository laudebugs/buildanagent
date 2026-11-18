---
name: vercel-ai-sdk
description: Use when writing, reviewing or testing TypeScript that imports `ai` or `@ai-sdk/*` for agents (generateText, streamText, tool, stopWhen, ToolLoopAgent, toolApproval, prepareStep, Output.object, @ai-sdk/mcp, MockLanguageModelV4). Gives the verified 7.0 setup, the approval flow, the gotchas from our fact-check, and how to test offline with ai/test.
---

# Vercel AI SDK (`ai@7.0.162`)

AI SDK Core is a model-call library with a thin tool loop: `generateText` or `streamText` with tools and a stop condition, packaged as `ToolLoopAgent`. It has no built-in tools and no session store; the `messages` you keep are the state. Full reference: [`docs/reference/vercel-ai-sdk/guide.md`](../../../docs/reference/vercel-ai-sdk/guide.md); verified examples: [`verify/vercel-ai-sdk/examples/`](../../../verify/vercel-ai-sdk/examples/).

## When to use it

Choose it for the thinnest provider-neutral loop that you can read quickly and test offline. Choose the OpenAI Agents SDK for guardrails and handoffs, and Pi or Claude's SDK when you want a full coding harness ([comparison](../../../docs/comparison/deep-comparison.md)).

## Minimal setup

```bash
pnpm add ai zod @ai-sdk/anthropic   # in this repo: pnpm only, exact pins. Use a provider instance; model strings go to the AI Gateway
```

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { isStepCount, type ModelMessage, Output, ToolLoopAgent, tool } from "ai";
import { z } from "zod";

const lookupOrder = tool({
  description: "Look up an order", inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => ({ orderId, status: "delivered" }),
});
const issueRefund = tool({
  description: "Refund an order", inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => ({ refunded: orderId }),
});
const agent = new ToolLoopAgent({
  model: anthropic("claude-sonnet-4-5"),
  instructions: "Triage support tickets. Never refund without approval.",
  tools: { lookupOrder, issueRefund },
  toolApproval: { issueRefund: "user-approval" },
  experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET, // sign approval requests
  output: Output.object({ schema: z.object({ action: z.enum(["refunded", "answered"]), summary: z.string() }) }),
  stopWhen: isStepCount(8),
});

const messages: ModelMessage[] = [{ role: "user", content: "I was charged twice for A-1." }];
const first = await agent.generate({ messages });
messages.push(...first.responseMessages);
const ask = first.content.find((p) => p.type === "tool-approval-request");
if (ask) {
  messages.push({ role: "tool", content: [{ type: "tool-approval-response", approvalId: ask.approvalId, approved: true }] });
  const second = await agent.generate({ messages });
  console.log(second.output);
}
```

## Patterns that hold (verified)

- **`generateText` defaults to one step** (`stopWhen: isStepCount(1)`): tools run, but the model isn't called again. Set `stopWhen` whenever you pass tools.
- **`ToolLoopAgent` defaults to 20 steps** and logs a warning when it hits them; an explicit `stopWhen` logs nothing. Helpers: `isStepCount`, `hasToolCall`, `isLoopFinished`; an array stops when any holds.
- **`toolApproval`** is call-level: `'user-approval'` ends the call with a `tool-approval-request`; append a `tool-approval-response` and call again. `'denied'` skips the tool without asking. Per-tool `needsApproval` is deprecated (it still drives `WorkflowAgent`).
- **Where the model calls fall.** In the first `generate()`, earlier steps run normally (lookup → a model call that requests the refund), then the loop stops. The second `generate()` runs the approved tool without a model call, then makes one model call for the answer.
- **Signing is automatic.** With `experimental_toolApprovalSecret` set, the signature travels on the request inside `responseMessages`; push those back and send the response unsigned.
- **Invalid tool input** never reaches `execute()`; the step records a `tool-error` and the loop continues.
- **`prepareStep`** returns per-step `activeTools`, `toolChoice`, `model`, `instructions` or `messages`.
- **`Output.object({ schema, name, description })`** types `result.output`. A schema failure rejects with `NoObjectGeneratedError`; reading `output` after a tool-call finish throws `NoOutputGeneratedError`.
- **Streaming:** `textStream`; typed parts in `result.stream`, where `text-delta` parts carry `text`; `onEnd` fires only once the stream is consumed (`consumeStream()`).
- **MCP:** `createMCPClient({ transport })` from `@ai-sdk/mcp`, then `await client.tools()`; close it in `finally`.

## Gotchas (from the fact-check)

- **System messages in `prompt` or `messages` throw `InvalidPromptError`** unless `allowSystemInMessages: true`. Put trusted instructions in `instructions`.
- **Model strings such as `"openai/gpt-5"` route through Vercel's AI Gateway** (`AI_GATEWAY_API_KEY`). Use provider instances, or set `globalThis.AI_SDK_DEFAULT_PROVIDER`.
- **Unsigned approvals can be forged** by a client; set `experimental_toolApprovalSecret`.
- **Old names in docs:** stream parts use `text`, not `textDelta`; reasoning arrives as `reasoning-delta`; `Output.object` takes `name`/`description`, not `schemaName`.
- **Narrow tool calls with `staticToolCalls` / `staticToolResults`.** Checking `toolName` on `toolCalls` leaves `input` as `unknown`, because dynamic tools share the array.
- **`experimental_sandbox` needs a full `Experimental_SandboxSession`** (readFile, writeFile, …), not just `run`.
- **Telemetry emits once an integration is registered**; opt a call out with `telemetry: { isEnabled: false }`.

## Test offline

Use `MockLanguageModelV4` from `ai/test` with `doGenerate`/`doStream`, and `simulateReadableStream` from `ai` for streams. A tool call is `{ type: "tool-call", toolCallId, toolName, input: JSON.stringify(args) }` with `finishReason: { unified: "tool-calls", raw: undefined }`. The `scripted()` helper in [`verify/vercel-ai-sdk/examples/lib/check.ts`](../../../verify/vercel-ai-sdk/examples/lib/check.ts) plays one turn per call and records each request. A turn is a string (text) or `{ tools: [{ name, input, id? }] }`; import it with the `.ts` extension, and `check(cond, msg)` asserts and narrows. For `Output.object`, script the final turn as text holding the JSON (`JSON.stringify({...})`). In tests, hard-code `experimental_toolApprovalSecret`, because the runner's allowlisted environment drops `process.env` secrets.

> **TS trap in assertion tests.** After `check(count === 0)`, TypeScript narrows a `let` counter to `0`, so a later `count === 1` fails with TS2367. Read counters through a function (`() => count`).

Run one new file offline, without touching committed results, from `verify/vercel-ai-sdk`: `node scripts/run-examples.mjs <dir> --only <name>`. The runner prints only the outcome, so run the file with tsx to see its `ok -` lines. Run the verified examples with:

```bash
pnpm --filter @agent-speak/verify-vercel-ai-sdk test
```
