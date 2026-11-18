# Building agents with the GitHub Copilot SDK: the runtime starts as a full coding agent, so subtract before you embed it

*Version `@github/copilot-sdk@1.0.31` with its bundled Copilot runtime 1.0.109, TypeScript, November 2026. **[verified: NN]** marks a claim asserted by example `NN` in [`verify/copilot-sdk/examples/`](../../../verify/copilot-sdk/examples/), run offline: the real runtime runs its real loop, and every model call goes to a local mock through the SDK's BYOK provider. Other claims cite their upstream page in [`source/`](source/), the `github/copilot-sdk` repo at tag `v1.0.31`. [fact-check.md](fact-check.md) rates those pages, and its findings are cited here as F1–F10.*

The GitHub Copilot SDK puts the engine behind Copilot CLI inside your application. Like the Claude Agent SDK, it spawns a separate runtime that owns the agent loop, and your code configures that loop and answers its callbacks. The runtime arrives as a coding agent. A default session offers the model 19 built-in tools, `bash`, `edit` and `web_fetch` among them, and the Quick Start approves every call. Two other defaults widen that reach: the runtime inherits your process environment and signs in as the logged-in GitHub user. A third default surprises in the other direction, because a session without a permission handler denies every call that needs approval, although the docs say it leaves them pending. In this guide, I show how the SDK and its runtime divide the work, then build a gated support-triage agent on them. Because the runtime starts with full reach, you build a production agent by subtraction: name the tools the model may see, give every session a permission handler, and decide pending approvals yourself.

## 1. The SDK drives the Copilot runtime over JSON-RPC, and the runtime owns the loop

The SDK is a thin client. All six official SDKs "drive the Copilot agent runtime over JSON-RPC", and by default the runtime runs as a child process in server mode, whose lifecycle the SDK manages (`README.md`, "Architecture"). Our harness sees `vscode-jsonrpc` messages on stdio between the two ([harness README](../../../verify/copilot-sdk/README.md)). Two other transports exist: `RuntimeConnection.forUri` connects to a runtime that is already running, and an experimental in-process transport loads the native runtime through a C ABI (`nodejs/README.md`, "CopilotClient"; `docs/setup/in-process-runtime.md`).

The split decides where each concern lives:

| Concern | Lives in |
|---|---|
| Agent loop, model calls, retries, compaction | The runtime |
| Built-in tools (shell, file edits, web fetch, SQL, sub-agents) | The runtime |
| Tool filters, permission flow, hooks dispatch, MCP client | The runtime, with callbacks into your process |
| Session store and resume | The runtime, on disk under `baseDirectory` |
| Custom tool handlers, permission decisions, hook logic | Your process, called over JSON-RPC |

For a team, three consequences follow. First, each client costs a runtime process. Second, you control the loop only through session options, callbacks and RPC methods, not by editing the loop. Third, the runtime is GitHub's own software under the GitHub Copilot CLI License, while the SDK is MIT ([README](README.md#sources-and-license)).

## 2. Install one package, then authenticate as a GitHub user or bring your own model key

```bash
npm install @github/copilot-sdk zod   # Node.js ^20.19.0 or >=22.12.0
```

The runtime comes with the SDK. An optional `@github/copilot-sdk-<platform>` package holds the runtime for the host platform, so starting the SDK downloads nothing; `COPILOT_CLI_PATH` points it at another installation instead (`nodejs/README.md`, "Prerequisites"). The SDK's `package.json` pins the runtime version (`copilotCliVersion: "1.0.109"`), so updating the SDK updates the runtime.

The auth page lists five methods, and they fall into two families (`docs/auth/authenticate.md`):
- **As a GitHub identity.** By default, `useLoggedInUser` is `true`, and the runtime tries an explicit `gitHubToken`, then `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`, then a stored `copilot` login, then `gh auth`. This path needs a Copilot subscription, and usage counts against it. For a multi-user server, pass a per-session `gitHubToken`. Setting `useLoggedInUser: false` makes the runtime ignore the environment tokens too.
- **With your own key (BYOK).** A `provider` on the session sends model calls to OpenAI, Azure or Anthropic endpoints, or to any OpenAI-compatible endpoint such as Ollama or vLLM. BYOK "bypasses GitHub Copilot authentication entirely" and needs no subscription (`docs/auth/byok.md`). Every example in this guide authenticates this way. **[verified: 01–09]**

```ts
import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient({ useLoggedInUser: false });
const session = await client.createSession({
  model: "claude-sonnet-4.5",
  provider: { type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: process.env.ANTHROPIC_API_KEY },
  onPermissionRequest: () => ({ kind: "reject" }),
});
```

BYOK takes keys only. The FAQ rules out Entra ID, managed identities and third-party identity providers (`README.md`, "FAQ"). The runtime never persists provider keys, so a resumed BYOK session needs its `provider` again (`docs/features/session-persistence.md`, "Limitations").

## 3. A session runs turns until idle, persists to disk and resumes by id

`sendAndWait` sends a prompt and resolves with the final `assistant.message` event once the session goes idle, or with `undefined` if none arrived (`nodejs/README.md`, "sendAndWait"). **[verified: 01]** Its second argument is an optional timeout in milliseconds. A turn emits its events in a fixed order: `user.message`, then `assistant.turn_start`, `assistant.message`, `assistant.turn_end` and finally `session.idle`. **[verified: 01]**

```ts
const reply = await session.sendAndWait({ prompt: "What is 2+2?" }, 30_000);
console.log(reply?.data.content);
```

`createSession` and `resumeSession` start the client on demand. Other client calls, such as `listSessions()` and `client.rpc`, throw "Client not connected" until you call `start()`. **[verified: 06]** Two docs examples call `client.rpc` on a client they never started (F3).

The runtime saves a session to disk once the session handles its first message (`docs/features/session-persistence.md`). It stores sessions under `baseDirectory`, which sets `COPILOT_HOME` and defaults to `~/.copilot` (`nodejs/README.md`). A new client with the same `baseDirectory` finds a stopped session with `listSessions()`, and `resumeSession(id, config)` returns it under the same id. The next model call then carries the earlier turns, and `getEvents()` returns the whole history. **[verified: 06]**

> **Gotcha.** Custom tools do not survive a resume. A `resumeSession` call without `tools` offers the model none of the tools the session was created with. **[verified: 06]** The persistence page says the runtime maintains "tool state", and its table of resume options omits `tools` (F9). Pass `tools`, `provider` and your handlers again on every resume.

## 4. Custom tools run in your process after the runtime asks permission

`defineTool` takes a name, a description, a Zod schema or raw JSON Schema, and a handler. The SDK converts the Zod schema to JSON Schema for the model and gives the handler parsed arguments plus an `invocation` that carries the `toolName`. **[verified: 02]**

```ts
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

const getWeather = defineTool("get_weather", {
  description: "Get the weather for a city",
  parameters: z.object({ city: z.string().describe("City name") }),
  handler: async ({ city }) => `Sunny and 21C in ${city}`,
});
const session = await client.createSession({ model, provider, tools: [getWeather], onPermissionRequest });
```

Before the handler runs, the runtime asks `onPermissionRequest` with `kind: "custom-tool"`. **[verified: 02]** The session emits `tool.execution_start` and `tool.execution_complete` around the call. **[verified: 02]** A handler may return a string, any JSON-serializable value or a `ToolResultObject` (`nodejs/README.md`, "Tools"). Two tool options and one session method change the defaults:
- `skipPermission: true` runs the tool without asking. **[verified: 09]**
- `overridesBuiltInTool: true` lets a tool take a built-in's name; without it, the SDK throws (`nodejs/README.md`, "Overriding Built-in Tools").
- `session.setTools([...])` replaces this client's tools in a live session. The feature is experimental (`docs/features/changing-tools.md`).

## 5. A permission handler decides each tool call that asks, and a session without one denies them

The runtime asks `onPermissionRequest` before each tool call, built-in or custom, unless the tool sets `skipPermission` or an `onPreToolUse` hook denies the call first (section 7). The request's `kind` names the operation: `shell`, `write`, `read`, `mcp`, `custom-tool`, `url`, `memory` and others (`nodejs/README.md`, "Custom Permission Handler"). The handler returns one of these results (`nodejs/README.md`, "Permission Result Kinds"):

| Result `kind` | Effect |
|---|---|
| `approve-once` | Runs this call **[verified: 02]** |
| `approve-for-session`, `approve-for-location`, `approve-permanently` | Runs it and remembers the approval for the session, the project location or across sessions |
| `reject` with `feedback?` | Denies it; the model reads "The user rejected this tool call. User feedback: …" **[verified: 03]** |
| `user-not-available` | Denies it because no one can confirm |
| `no-result` | Answers nothing, leaving the request pending **[verified: 09]** |

A rejected call never reaches its handler, and the turn still ends with a reply. **[verified: 03]** The SDK also exports `approveAll`, which approves everything, shell commands included, and which throws when `enableManagedSettings` is true (`nodejs/README.md`, `createSession` options).

**Omitting the handler denies every call that asks.** The README and the `onPermissionRequest` JSDoc both say that without a handler, requests "are emitted as events and left pending" for the pending-permission RPC. In 1.0.31 the SDK instead tells the runtime it cannot ask (`requestPermission: false`), and the runtime denies each call at once. The model reads that permission "could not request permission from user", no `permission.requested` event fires, and nothing is pending. **[verified: 03]** The behavior fails closed, which is safe, but an app that waits for pending requests will wait forever (F1).

To hold a call for a person, return `{ kind: "no-result" }`. The session then emits `permission.requested`, and the call waits until something answers through `session.rpc.permissions.handlePendingPermissionRequest({ requestId, result })`. **[verified: 09]** Section 13 uses this pattern for its escalation gate.

## 6. `availableTools` decides which built-ins the model sees, and `mode: "empty"` makes you name them

A default session offers the model the runtime's built-ins next to your own tools: 19 of them in our harness, including `bash`, `view`, `create` and `edit`. **[verified: 01, 04]** A one-off probe listed the rest, among them `web_fetch`, `sql` and the sub-agent tool `task` (fact-check F8). The FAQ compares this default to running the CLI "with `--allow-all`" (`README.md`). Two session options and one client option narrow the list:
- **`availableTools`** is an allowlist. It takes tool names, or a `ToolSet` built with `addBuiltIn`, `addCustom` and `addMcp`. `new ToolSet().addCustom("*")` leaves only your own tools. **[verified: 04]**
- **`excludedTools`** removes named tools, and it wins when both options match a tool. **[verified: 04]**
- **`mode: "empty"`** on the client turns optional CLI features off. A session that does not set `availableTools` is then refused with "did not specify 'availableTools'". **[verified: 04]** The multi-tenancy page calls this mode "required for multi-user or shared scenarios" (`docs/setup/multi-tenancy.md`).

```ts
import { CopilotClient, ToolSet } from "@github/copilot-sdk";

const client = new CopilotClient({ mode: "empty", baseDirectory: "/var/lib/myapp/copilot" });
const session = await client.createSession({
  model, provider, tools: [lookupOrders, escalate],
  availableTools: new ToolSet().addCustom("*"),   // no shell, file or web tools
  onPermissionRequest,
});
```

`BuiltInTools.Isolated` names the built-ins that stay "within the bounds of a single session", with no host filesystem, environment or network access (`dist/toolSet.d.ts`). Our run offered `skill`, `read_agent`, `list_agents`, `write_agent` and `task` from that set, and none of `bash`, `view` or the custom tools. **[verified: 04]** The set still includes `task`, which starts sub-agents, so allow it only after deciding what a sub-agent may do.

## 7. `onPreToolUse` runs before the permission check and can deny a call, and `onPostToolUse` can rewrite the result

`hooks` on the session takes up to 12 handlers, including `onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted`, `onSessionStart`, `onErrorOccurred` and the sub-agent hooks (`SessionHooks` in `dist/types.d.ts`; `docs/hooks/hooks-overview.md`). Two of them shape tool calls:
- **`onPreToolUse`** runs before `onPermissionRequest`. A `{ permissionDecision: "deny", permissionDecisionReason }` result stops the call, so neither the handler nor the permission callback runs, and the model reads the reason. **[verified: 08]**
- **`onPostToolUse`** can return `modifiedResult` to replace what the model sees, for example to redact a field. **[verified: 08]**

```ts
hooks: {
  onPreToolUse: async (input) =>
    input.toolName === "close_ticket"
      ? { permissionDecision: "deny", permissionDecisionReason: "Closing needs a supervisor." }
      : undefined,
  onPostToolUse: async (input) =>
    input.toolName === "read_ticket"
      ? { modifiedResult: { ...input.toolResult, textResultForLlm: "ticket body (redacted)" } }
      : undefined,
},
```

Three doc problems affect hook code you copy:
- **Return values.** The hook pages return `null` for "no change", which the handler types reject in strict TypeScript; return `undefined` instead. The runtime accepts `null` (F4). **[verified: 08]**
- **Types.** The hook pages import `PreToolUseHookInput` and nine other types from the package root, which doesn't export them, and a `HookInvocation` type that doesn't exist (F2). Derive them from `SessionHooks` instead, for example `Parameters<NonNullable<SessionHooks["onPreToolUse"]>>[0]`.
- **Tool names.** Several hook examples match tool names such as `shell`, `read_file` and `delete_file`. The runtime in our harness offered `bash`, `view` and `edit` instead, so check `input.toolName` against the names your sessions actually see (F10).

## 8. Streaming adds delta events, but the typed event union misses the `model.*` events

With `streaming: true`, a session emits `assistant.message_delta` events whose `deltaContent` concatenates to the final `assistant.message`; without it, the session emits none. **[verified: 05]** The docs split events into ephemeral ones, such as deltas and `session.idle`, and persisted ones, such as messages and tool results (`docs/features/streaming-events.md`). Subscribe to one type with `session.on("assistant.message_delta", handler)`, which types the payload, or to everything with `session.on(handler)`. **[verified: 01, 05]**

```ts
const session = await client.createSession({ model, provider, streaming: true, onPermissionRequest });
session.on("assistant.message_delta", (e) => process.stdout.write(e.data.deltaContent));
const idle = new Promise<void>((resolve) => session.on("session.idle", () => resolve()));
await session.send({ prompt: "Tell me a short story" });
await idle;
```

> **Gotcha.** `session.on(handler)` also delivers ten `model.*` event types, such as `model.call_start` and `model.turn_ended`, that the `SessionEvent` union does not include. **[verified: 01]** A `switch (event.type)` that TypeScript treats as exhaustive therefore meets values it never declared, so give it a `default` branch (F6).

## 9. MCP servers plug in per session, and their tools arrive as `<server>-<tool>`

`mcpServers` maps a server key to a config. A `type: "local"` server runs as a subprocess over stdio, and a `type: "http"` server is reached by URL with optional headers (`docs/features/mcp.md`). Each config's `tools` list filters what the model sees: `["*"]` offers every tool, and `[]` offers none. **[verified: 07]**

```ts
mcpServers: {
  orders: { type: "local", command: "node", args: ["./mcp-orders.mjs"], tools: ["*"] },
},
```

The runtime starts a local server itself and offers its tools as `<server-key>-<tool-name>`, here `orders-order_status`. **[verified: 07]** A call asks `onPermissionRequest` with `kind: "mcp"`, and the server's result reaches the model. **[verified: 07]** To allow MCP tools by name in `availableTools`, use `new ToolSet().addMcp("orders-order_status")` or the raw form `mcp:orders-order_status` (`nodejs/README.md`).

## 10. `sendAndWait(prompt, schema)` returns a parsed, typed result or throws

Structured output is a preview feature with two forms (`nodejs/README.md`, "Structured output (preview)"):
- **`responseSchema`** in the message options constrains the answer, and `message.data.content` holds the JSON text.
- **The typed overload, `sendAndWait(prompt, schema, timeout?)`,** converts a Zod schema to JSON Schema and parses the final answer with `schema.parse`. It returns the typed value, and it throws on invalid JSON, a schema mismatch or a run with no answer.

```ts
const Triage = z.object({ category: z.enum(["shipping", "billing", "other"]), escalated: z.boolean(), summary: z.string() });
const result = await session.sendAndWait("My parcel is late.", Triage, 60_000);   // typed as z.infer<typeof Triage>
```

In our runs, the typed overload returned parsed values, and an answer outside the enum threw a `ZodError`. **[verified: 09]** Don't set `responseSchema` as well when you use the overload.

## 11. Tests run the real runtime offline against a BYOK mock inside a network namespace

We found no test model in the SDK, and the runtime makes its model calls out of process, so the harness mocks one layer below the runtime ([harness README](../../../verify/copilot-sdk/README.md)):
- **Model.** `scripts/mock-model.mjs` serves the Anthropic Messages API on `127.0.0.1`. Each session reaches it through `provider: { type: "anthropic", baseUrl }`, so the runtime, its loop, the tool filters, the permission flow, hooks, MCP and the session store all run for real. **[verified: 01–09]**
- **Provider injection.** The CLI's own `COPILOT_PROVIDER_*` variables do not configure SDK sessions: with only those set, `createSession` fails with "No GitHub OAuth token or Copilot HMAC key provided". A preload therefore sets `provider` on every `createSession` and `resumeSession` call.
- **Network.** Each example runs under `unshare -rn`, in a network namespace whose only interface is loopback. A raw connection to a public address fails with `ENETUNREACH`, and DNS fails. **[verified: 00]**
- **Environment.** Each child gets an allowlisted environment and a temp `HOME`, so no GitHub token or proxy setting reaches the runtime. **[verified: 00]**
- **Host tools.** The mock calls only tools the example registered, and it denies the runtime's host tools by name, so a test never runs `bash` or `edit`.

Prompt lines steer the mock. `mock-args <tool> <json>` sets a call's arguments, `mock-reply: <text>` sets the answer, and `mock-no-tools` skips tool calls. Assertions then read the mock's request log, which records exactly which tools and messages the runtime sent. The harness runs on Linux only.

## 12. Production agents need four defaults changed

Each default below is documented, and each widens what an embedded agent can do (F8):
- **Tools.** `mode` defaults to `"copilot-cli"`, whose JSDoc warns that its tools "can access the host OS environment" and rules it out for "server-based multi-user applications" (`dist/types.d.ts`, `CopilotClientMode`). Set `availableTools` on every session, and use `mode: "empty"` for any server (section 6).
- **Approval.** The Quick Start passes `onPermissionRequest: approveAll`, which approves shell commands and file edits (`nodejs/README.md`, "Quick Start"). Write a handler that approves by tool and kind, and route risky calls to `no-result` and a person (section 5).
- **Environment.** `env` "inherits `process.env`" when omitted (`nodejs/README.md`, `CopilotClient` options), so the runtime and its shell tool see every secret in your process. Pass an allowlisted `env`, as the harness does. **[verified: 00]**
- **Identity.** `useLoggedInUser` defaults to `true`, so a server that holds a `GH_TOKEN` or a `gh` login acts as that user. Set it to `false`, and pass either a per-session `gitHubToken` or a BYOK `provider` (`docs/auth/authenticate.md`).

Two smaller settings deserve a check before launch. Session telemetry is on for eligible sessions, including BYOK sessions, unless `enableSessionTelemetry` is `false` (`nodejs/README.md`, `createSession` options); the harness also sets `COPILOT_TELEMETRY_DISABLED=true`. Sessions also live on local disk under `baseDirectory`, so mount a persistent volume when containers restart, and lock each session yourself, because "concurrent access to same session is undefined" (`docs/features/session-persistence.md`, "Limitations").

## 13. A gated triage agent takes five choices

The capstone [`09-triage-agent.ts`](../../../verify/copilot-sdk/examples/09-triage-agent.ts) builds the same support-triage agent as the other references:
1. **No built-ins.** `availableTools: new ToolSet().addCustom("*")` leaves the model exactly two tools, `lookup_orders` and `escalate_to_human`. **[verified: 09]**
2. **Identity from trusted context.** `lookup_orders` takes no parameters and reads the customer id from a value the app's auth layer set. When the mock sends `{"customerId":"cust-evil"}`, the lookup still returns the trusted customer's orders, and the tool's schema exposes no identity field. **[verified: 09]**
3. **A read-only fast path.** `skipPermission: true` on the lookup skips the permission callback, so only the escalation reaches the reviewer. **[verified: 09]**
4. **A pending escalation.** `onPermissionRequest` returns `{ kind: "no-result" }` for `escalate_to_human` and rejects anything else. A `permission.requested` listener hands the request to a reviewer, who answers through `session.rpc.permissions.handlePendingPermissionRequest`. A declined escalation never runs, and an approved one runs once. **[verified: 09]**
5. **A typed result.** `sendAndWait(prompt, Triage, 60_000)` returns the parsed object, and a reply outside the schema throws. **[verified: 09]**

```ts
onPermissionRequest: (request) =>
  request.kind === "custom-tool" && request.toolName === "escalate_to_human"
    ? { kind: "no-result" }                              // wait for a human
    : { kind: "reject", feedback: "Not allowed in triage." },

session.on("permission.requested", (event) => {
  reviewQueue.push(event.data.requestId);                // later:
  // session.rpc.permissions.handlePendingPermissionRequest({ requestId, result: { kind: "approve-once" } })
});
```

```bash
pnpm install && pnpm --filter @agent-speak/verify-copilot-sdk test
```

## 14. Ten runnable examples back the [verified] claims

| File | Demonstrates |
|---|---|
| `00-sandbox.ts` | The sandbox: no credentials, a temp `HOME`, no network beyond loopback |
| `01-hello-session.ts` | `sendAndWait`, the event order, the default built-ins, the untyped `model.*` events |
| `02-custom-tool.ts` | `defineTool` with Zod, parsed arguments, the `custom-tool` permission kind, tool events |
| `03-permission-deny.ts` | `reject` with feedback, and the denial when `onPermissionRequest` is omitted |
| `04-restrict-builtins.ts` | `availableTools`, `excludedTools`, `ToolSet`, `BuiltInTools.Isolated`, `mode: "empty"` |
| `05-streaming.ts` | `assistant.message_delta` with and without `streaming` |
| `06-resume-session.ts` | `listSessions` before `start()`, resume from `baseDirectory`, history kept, custom tools dropped |
| `07-mcp-server.ts` | A stdio MCP server, `<server>-<tool>` names, the `mcp` permission kind, `tools: []` |
| `08-hooks.ts` | `onPreToolUse` deny before permissions, `onPostToolUse` result rewrite, `null` returns |
| `09-triage-agent.ts` | The capstone: no built-ins, trusted identity, a pending escalation, typed output |

## 15. Six official SDKs share one runtime, and TypeScript is first-class

GitHub ships the SDK for Node.js/TypeScript, Python, Go, .NET, Java and Rust from one repository, and all six drive the same runtime over the same protocol (`README.md`, "Available SDKs" and "Architecture"). The docs describe shared features for all six at once, for example sub-agent hooks (`docs/features/fleet-mode.md`). TypeScript is therefore a first-class SDK, not a port that trails a primary language. Comparing the six READMEs turns up only Rust-only extras (`rust/README.md`, "Rust-only API"):
- **Caller-supplied streams.** `Client::from_streams` connects over any reader and writer. TypeScript's `RuntimeConnection` offers only stdio, TCP, URI and in-process connections.
- **Permission policy builders.** Rust has `deny_all` and `approve_if(predicate)`. TypeScript has `approveAll` only, so deny-all and predicate policies need a hand-written handler.
- **Separate argument lists.** Rust has `prefix_args` and `extra_args` for the runtime command line, and TypeScript has one `args` list.

Packaging differs by language. Python downloads the runtime on first use or with `python -m copilot download-runtime`, Go and Java need a bundler step or a runtime artifact, and Node and .NET bundle it (`README.md`, "Getting Started"; `python/README.md`). The Rust README calls cross-SDK parity for its extras "a post-release conversation".

## Conclusion: restrict the runtime first, then add back what the agent needs

The Copilot SDK suits teams that want Copilot CLI's loop, tools and session store behind a small API, from any of six languages, and who can run one runtime process per client. The runtime owns the loop, so you shape an agent through `availableTools`, the permission handler, hooks and session options. Its defaults suit a developer's terminal: a full coding toolset, `approveAll` in the Quick Start, the process environment and the logged-in GitHub user. A production agent reverses each one. Set `mode: "empty"` and `availableTools`, write a handler for every session, return `no-result` for calls a person must decide, pass an allowlisted `env`, and pass `tools` again on every resume. To start, copy [`09-triage-agent.ts`](../../../verify/copilot-sdk/examples/09-triage-agent.ts), swap in your tools and schema, and run `pnpm --filter @agent-speak/verify-copilot-sdk test` to confirm the gate still holds.
