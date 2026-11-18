---
name: copilot-sdk
description: Use when writing, reviewing or testing TypeScript that imports `@github/copilot-sdk` (CopilotClient, createSession, defineTool, availableTools/excludedTools, ToolSet, BuiltInTools, onPermissionRequest, hooks, sendAndWait, session events, resumeSession, BYOK provider, mcpServers). Gives the verified setup, how to strip the default coding toolset, the gotchas from our fact-check, and how to test offline against a mock model through BYOK.
---

# GitHub Copilot SDK (`@github/copilot-sdk@1.0.31`, runtime 1.0.109)

The SDK spawns the Copilot runtime, the engine behind Copilot CLI, and drives it over JSON-RPC; the runtime owns the loop, the built-in tools and the session store. A default session is a full coding agent with host access, so you build a safe agent by subtraction: name the tools the model may see, give every session a permission handler, and decide pending approvals yourself. Full reference: [`docs/reference/copilot-sdk/guide.md`](../../../docs/reference/copilot-sdk/guide.md); verified examples: [`verify/copilot-sdk/examples/`](../../../verify/copilot-sdk/examples/) (09 is the triage capstone).

## When to use it

Choose it for Copilot CLI's loop, tools and session store behind a small API, with GitHub-hosted models or your own key (BYOK), when one runtime process per client is affordable. Peer SDKs in Python, Go, .NET, Java and Rust drive the same runtime, and TypeScript lacks only Rust's stream transport and permission builders ([TypeScript gaps](../../../docs/comparison/typescript-gaps.md#github-copilot-sdk-typescript-is-a-first-class-sdk-and-lacks-only-rust-extras)). Choose the Claude Agent SDK for the same runtime shape with Claude Code's permission rules, Pi to own the loop, or the OpenAI Agents SDK for approvals that survive a restart ([feature table](../../../docs/comparison/feature-table.md#choose-by-the-safety-work-you-want-to-own)).

## Minimal setup

```bash
pnpm add @github/copilot-sdk zod   # Node ^20.19.0 or >=22.12.0; the runtime ships in an optional per-platform package
```

```ts
import { CopilotClient, defineTool, type PermissionRequestedEvent, ToolSet } from "@github/copilot-sdk";
import { z } from "zod";

const customer = { id: "cust-42" };                       // trusted context from your auth layer
const lookupOrders = defineTool("lookup_orders", {
  description: "List the current customer's orders",
  parameters: z.object({}),                               // no identity field for the model to fill
  skipPermission: true,                                   // read-only fast path
  handler: async () => `orders for ${customer.id}: A-100 shipped`,
});
const escalate = defineTool("escalate_to_human", {
  description: "Hand the conversation to a human agent",
  parameters: z.object({ reason: z.string() }),
  handler: async ({ reason }) => `Escalated: ${reason}`,
});
const Triage = z.object({ category: z.enum(["shipping", "billing", "other"]), escalated: z.boolean(), summary: z.string() });

const client = new CopilotClient({
  mode: "empty", baseDirectory: "/var/lib/myapp/copilot",  // refuses sessions without availableTools
  useLoggedInUser: false,                                  // ignore GH_TOKEN and gh logins
  env: { PATH: process.env.PATH ?? "", HOME: "/var/lib/myapp/home" },  // the default inherits process.env
});
const session = await client.createSession({
  model: "claude-sonnet-4.5",
  provider: { type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: process.env.ANTHROPIC_API_KEY },
  tools: [lookupOrders, escalate],
  availableTools: new ToolSet().addCustom("*"),           // only your tools: no bash, edit, web_fetch or task
  onPermissionRequest: (request) =>
    request.kind === "custom-tool" && request.toolName === "escalate_to_human"
      ? { kind: "no-result" }                             // pending until a person decides
      : { kind: "reject", feedback: "Not allowed in triage." },
});
const pending: string[] = [];
session.on("permission.requested", (e: PermissionRequestedEvent) => pending.push(e.data.requestId));
export const decide = (requestId: string, ok: boolean) =>   // call from your review UI
  session.rpc.permissions.handlePendingPermissionRequest({
    requestId, result: ok ? { kind: "approve-once" } : { kind: "reject", feedback: "Reviewer declined." },
  });
try {
  const result = await session.sendAndWait("My parcel is late.", Triage, 60_000);  // parsed, or throws
  console.log(result.category, result.summary);
} finally {
  await session.disconnect();
  await client.stop();
}
```

## Patterns that hold (verified)

- **Name the tools the model may see.** `availableTools` is an allowlist of names or a `ToolSet` (`addCustom`, `addBuiltIn`, `addMcp`); `excludedTools` removes names and wins when both match. `mode: "empty"` needs `baseDirectory` and rejects a session without `availableTools`.
- **Every tool call asks `onPermissionRequest`** unless the tool sets `skipPermission` or `onPreToolUse` denies first. `request.kind` is `custom-tool`, `mcp`, `shell`, `write`, `url` and others. `reject` with `feedback` keeps the handler from running, and the model reads the feedback.
- **Decide approvals out of band.** `{ kind: "no-result" }` emits `permission.requested` and holds the call until `session.rpc.permissions.handlePendingPermissionRequest({ requestId, result })` answers it.
- **`sendAndWait({ prompt })`** resolves with the final `assistant.message` once the session is idle. `sendAndWait(prompt, zodSchema, timeout)` returns the parsed value and throws on a mismatch; don't also set `responseSchema`.
- **Events:** `user.message → assistant.turn_start → assistant.message → assistant.turn_end → session.idle`. `streaming: true` adds `assistant.message_delta` chunks. `session.on(type, fn)` types the payload.
- **MCP:** `mcpServers: { orders: { type: "local", command, args, tools: ["*"] } }` offers `orders-<tool>` with permission kind `mcp`; `tools: []` offers none.
- **Hooks:** `onPreToolUse` runs before the permission handler, and `{ permissionDecision: "deny", permissionDecisionReason }` stops the call. `onPostToolUse` returns `{ modifiedResult }` to rewrite what the model sees.
- **Resume:** a new client with the same `baseDirectory` finds the session with `listSessions()` (after `start()`), and `resumeSession(id, config)` carries the history.

## Gotchas (from the fact-check)

- **No permission handler means denied (F1).** The README says requests are "left pending"; in 1.0.31 the runtime denies each call at once, with no event. To hold a call, return `no-result`.
- **A default session offers 19 built-ins (F8)**, including `bash`, `edit`, `web_fetch`, `sql` and the sub-agent tool `task`. The Quick Start's `approveAll` approves shell commands. `BuiltInTools.Isolated` drops host tools but keeps `task`.
- **Custom tools are dropped on resume (F9).** Pass `tools`, `provider` (BYOK keys are never persisted) and every handler again to `resumeSession`.
- **`request.toolName` exists only on custom-tool requests.** `PermissionRequest` is a union; narrow with `request.kind === "custom-tool"` before reading `toolName`, or tsc rejects it. The tested approval pattern decides from a `permission.requested` listener after the handler returns `no-result`, deferring the call to `handlePendingPermissionRequest` (a `setTimeout`); deciding synchronously inside the listener is untested.
- **Hook examples check tool names the runtime doesn't offer (F10).** The docs match `shell`, `read_file` and `edit_file`, but the runtime's shell tool is `bash` and its file tools are `view`, `create` and `edit`; `shell` is only a permission kind. Match `input.toolName` against the names your sessions see.
- **Hook types and return values (F2, F4).** The root doesn't export `PreToolUseHookInput` and its siblings, and `HookInvocation` doesn't exist; use `Parameters<NonNullable<SessionHooks["onPreToolUse"]>>[0]`. Return `undefined`, not the docs' `null`, for "no change".
- **`client.rpc` and `listSessions()` throw before `start()` (F3)**; only `createSession` and `resumeSession` start the client.
- **Ten `model.*` events arrive outside the `SessionEvent` union (F6)**, so give every `switch (event.type)` a `default` branch.

## Test offline

The SDK has no test model, so the harness runs the real runtime against [`scripts/mock-model.mjs`](../../../verify/copilot-sdk/scripts/mock-model.mjs), an Anthropic Messages API on `127.0.0.1`, reached through `provider: mockProvider()` from [`examples/lib/harness.ts`](../../../verify/copilot-sdk/examples/lib/harness.ts). The runner puts each file in an `unshare -rn` network namespace with loopback only, an allowlisted environment and a temp `HOME`. Import `check`, `MODEL`, `mockProvider` and `mockRequests` from `./lib/harness.ts` (with the extension); for `mode: "empty"` use a `mkdtemp` directory as `baseDirectory` and pass the runner's `HOME` and `TMPDIR` in `env`. Each turn, the mock calls, once each and in prompt order, the callable tools the prompt names (else the first callable tool), and never a host built-in; `mock-args` lines set arguments but don't count as naming a tool. Steer it with prompt lines `mock-args <tool> <json>`, `mock-reply: <text>` and `mock-no-tools`. For structured output it answers with the `mock-reply:` JSON if that parses, else JSON generated from the schema, so put enum-valid JSON in `mock-reply:`. Assert on `mockRequests()` with `check()`: `mockRequests()[i].tools` lists the tool names offered on request `i`. Run one new file without touching committed results, from `verify/copilot-sdk`: `node scripts/run-examples.mjs examples --only <name> --verbose`. That run does not type-check, so also run `pnpm exec tsc --noEmit -p .`. Run the verified examples with:

```bash
pnpm --filter @agent-speak/verify-copilot-sdk test
```
