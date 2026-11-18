# Building agents with Pi: you own the loop, so you also own the safety

*Version `@earendil-works/pi-coding-agent@1.5.2` (with `pi-agent-core` and `pi-ai` 1.5.2), TypeScript, November 2026. **[verified: NN]** marks a claim asserted by example `NN` in [`verify/pi/examples/`](../../../verify/pi/examples/), run offline with pi-ai's faux provider. Other claims cite their upstream page in [`source/`](source/), mirrored from git tag `v1.5.2`; [fact-check.md](fact-check.md) rates those pages.*

Pi is an MIT-licensed agent harness from Earendil Works with about 123,000 GitHub stars. Pi runs its agent loop inside your own Node.js process, as three npm packages you can read end to end. That design gives you what a vendor SDK withholds: the loop, the session format, the compaction policy and the model provider are all yours to replace. The same design also takes something away. Pi ships no permission system, so every tool call runs with the permissions of your process until you add a gate. In this guide, I show how Pi's layers fit together and how to build a production agent on them. That agent needs the two jobs Pi leaves to you: gating tool calls in an extension and isolating the process.

## 1. Pi is three layered packages that run in your process

Each layer of Pi is a separate package, so you can take the loop without the coding agent (`source/coding-agent/README.md`, `source/agent-core-README.md`, `source/pi-ai-README.md`):

| Package | Layer | What it gives you |
|---|---|---|
| `@earendil-works/pi-ai` | Model API | One streaming interface over the 35 providers its README lists, plus a faux provider for tests |
| `@earendil-works/pi-agent-core` | Loop core | A stateful `Agent` with tool calling, an event stream and hooks (`agent-loop.ts`, about 950 lines) |
| `@earendil-works/pi-coding-agent` | Product | The `pi` CLI and the SDK: built-in tools, sessions, compaction, extensions, skills |

The contrast with the Claude Agent SDK explains most of Pi's design. Claude's SDK spawns a separate CLI process that owns the loop, so you configure the loop through options. Pi's SDK calls the loop in-process, so you can also read, wrap or replace it. Because the model layer is its own package, the loop also works with any of `pi-ai`'s providers, and a test can swap in a scripted model with one function call (section 12).

## 2. Install the SDK and pin the model explicitly

```bash
npm install @earendil-works/pi-coding-agent   # the SDK; needs Node.js 22.19+
npm install -g --ignore-scripts @earendil-works/pi-coding-agent   # the pi CLI
```

Pi needs no install scripts, which is why the docs pass `--ignore-scripts` (`quickstart.md`). A session needs a model, and `ModelRuntime` holds the providers and credentials. Credentials come from `/login` in the CLI, from `auth.json`, from environment variables, or from `modelRuntime.setRuntimeApiKey()` (`providers.md`).

> **Gotcha.** Without an explicit model, `createAgentSession()` takes the model from settings or "first available" (`examples/sdk/01-minimal.ts`). Amazon Bedrock and Google Vertex AI can authenticate from ambient cloud credentials (`providers.md`). On a host with cloud credentials in its environment, an unconfigured session therefore calls that cloud's models. Our harness hit exactly this case before it scrubbed the environment. Pass `model` and `modelRuntime` explicitly in production. **[verified]**

## 3. A session streams events and settles when it is done

A minimal agent creates a session, prompts it, and reads the answer:

```ts
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession();
try {
  session.subscribe((e) => {
    if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") process.stdout.write(e.assistantMessageEvent.delta);
  });
  await session.prompt("What files are in the current directory?");
  console.log(session.getLastAssistantText());
} finally {
  session.dispose();
}
```

`prompt()` resolves after the run finishes, including automatic retries (`sdk.md`). A run emits `agent_start`, then one `turn_start` … `turn_end` cycle per model call with `message_*` and `tool_execution_*` events inside it, then `agent_end`. **[verified: 01, 02]** Because automatic recovery or queued work can follow `agent_end`, wait for `agent_settled` to know Pi has stopped for good. **[verified: 01]** Always call `dispose()`: it aborts active work and removes listeners.

## 4. Session options choose the model, the tools and the resources

`createAgentSession()` takes 14 options. `sdk.md` documents 12 of them; `agentDir` and `sessionStartEvent` exist only in the type declarations (fact-check, Tier 3).

| Concern | Options |
|---|---|
| Model | `modelRuntime`, `model`, `thinkingLevel`, `scopedModels` |
| Tools | `tools`, `noTools`, `excludeTools`, `customTools` |
| State | `sessionManager` (persistent by default, or `SessionManager.inMemory()`), `settingsManager` |
| Resources | `resourceLoader` (extensions, skills, prompt templates, themes, context files) |
| Environment | `cwd`, `agentDir` |

Without overrides, the session discovers settings, extensions, skills and `AGENTS.md` context files from `cwd` and `~/.pi/agent`. An embedded agent usually wants none of that, so pass in-memory managers and an explicit `DefaultResourceLoader`, as example 08 does.

## 5. Four built-in tools by default, and custom tools through `customTools`

A default session has four active tools: `read`, `bash`, `edit` and `write`. **[verified: 01]** Three options narrow that set (`sdk.md`, `examples/sdk/05-tools.ts`):
- `tools: ["read", "grep", "find", "ls"]` selects exactly those tools, here a read-only set. **[verified: 03]**
- `excludeTools: ["bash", "write"]` removes tools from the defaults. **[verified: 03]**
- `noTools: "builtin"` removes every built-in tool. **[verified: 03]**

You add tools with `defineTool()`, which keeps TypeBox type inference for the parameters:

```ts
import { createAgentSession, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const weather = defineTool({
  name: "get_temperature", label: "Temperature", description: "Get the current temperature for a city",
  parameters: Type.Object({ city: Type.String() }),
  execute: async (_id, params) => ({ content: [{ type: "text", text: `21°C in ${params.city}` }], details: {} }),
});
const { session } = await createAgentSession({ customTools: [weather] });
```

The model's arguments reach `execute()`, and the result joins the transcript as a `toolResult` message. **[verified: 02]** When the model calls an inactive tool, Pi returns an error tool result ("Tool … not found") and the loop continues, so a bad call never crashes the run. **[verified: 03]** The CLI also loads `codemode`, `tool_search` and MCP as built-in extensions, but SDK sessions start without them; add `createCodemodeExtension()`, `createToolSearchExtension()` and `createMcpExtension()` yourself (`sdk.md`).

## 6. Extensions are the only gate on tool calls

Pi has no permission prompts and no allow or deny rules. Tools run with the operating-system permissions of the Pi process, and so do extensions (`security.md`). Only an extension's `tool_call` handler can approve or block a call, and it runs before the tool executes:

```ts
const resourceLoader = new DefaultResourceLoader({
  cwd, agentDir,                                   // both required
  extensionFactories: [
    (pi) => {
      pi.on("tool_call", async (event) =>
        event.toolName === "restart_service" ? { block: true, reason: "change freeze" } : undefined);
    },
  ],
});
await resourceLoader.reload();
const { session } = await createAgentSession({ cwd, resourceLoader });
```

A blocked call never executes, and the reason reaches the model as an error tool result. **[verified: 07]** For built-in tools, narrow the event with `isToolCallEventType("bash", event)` to get typed input (`extensions.md`). Extensions can also register tools, commands, providers and TUI components, and they subscribe to 41 events; the docs and the package agree on all 41 (fact-check, Tier 3).

Extensions import a set of modules that Pi supplies at run time: `pi-agent-core`, `pi-tui`, `typebox`, `pi-coding-agent`, and an "extension view" of `pi-ai` that adds TypeBox's `Type` and deprecated helpers such as `getModel()`. Code outside an extension imports the real `pi-ai`, where those helpers live only under `@earendil-works/pi-ai/compat` (fact-check, F2 and F5).

*Project trust* controls whether a folder's `.pi/settings.json`, `.pi/mcp.json` and extensions load at startup. Project trust is no security boundary, though: after startup, tools still act with the process's permissions (`security.md`).

## 7. Steering and follow-up messages queue around a running turn

A message sent while a run is streaming must say how it joins the run. `prompt()` without that choice rejects instead of guessing. **[verified: 04]** Two methods make the choice (`sdk.md`):
- `steer(text)` enters after the current assistant turn and its tool calls.
- `followUp(text)` enters after the run finishes its pending work.

Both return `"queued"`, or `"handled"` when an extension consumed the input. **[verified: 04]** In our test, the prompt, the steer and the follow-up reached the transcript in that order, each with its own model request. **[verified: 04]** `abort()` stops the active operation, and `waitForIdle()` waits without aborting.

## 8. Sessions are a tree, so branching never loses work

Pi stores a session as JSONL entries, each with an `id` and a `parentId`, and the active branch is the path to the current leaf (`how-pi-works.md`, `session-format.md`). Continuing from an earlier entry adds a branch in the same file. In example 05, `sessionManager.branch(id)` moved the leaf back, and the next prompt started a second path; both paths stayed in `getEntries()`, while `getBranch()` returned only the active one. **[verified: 05]** The CLI exposes the same model as `/tree` (move within the file), `/fork` (new session from an earlier user message) and `/clone` (copy the active branch) (`sessions.md`).

The tree has 11 entry types, such as `SessionMessageEntry`, `CompactionEntry` and `BranchSummaryEntry`, and the docs match the package's `SessionEntry` union exactly (fact-check, Tier 3). Sessions persist to files by default; `SessionManager.inMemory()` keeps them in memory, and `AgentSessionRuntime` adds `newSession()`, `switchSession()`, `fork()` and `importFromJsonl()` (`sdk.md`).

## 9. Compaction appends a summary and keeps the originals

Auto-compaction starts when `contextTokens > contextWindow - reserveTokens`, with `reserveTokens` defaulting to 16,384 (`compaction.md`). Pi then walks back to keep about `keepRecentTokens` (default 20,000) of recent context, summarises the rest, and appends a `CompactionEntry`. The package's settings schema confirms both defaults. **[verified]** Because the summary is just another entry, compaction never deletes history. In example 06, `compact()` added one entry and removed none, and the next request carried the summary instead of the old messages. **[verified: 06]**

Two details matter for tuning. First, when one user-message span exceeds `keepRecentTokens`, the cut lands inside it, and Pi makes two summary requests (history and span prefix) and merges them. **[verified: 06]** Second, a provider overflow error, or an early `stopReason: "length"`, triggers one compact-and-retry (`compaction.md`). Summary requests also skip prompt-cache writes, because they are one-off prompts.

## 10. Structured output comes from a tool that ends the run

Pi has no `outputFormat` option. Instead, its documented pattern is a final tool whose parameters are the output schema and whose result sets `terminate: true` (`examples/extensions/structured-output.ts`):

```ts
const submitTriage = defineTool({
  name: "submit_triage", label: "Submit triage", description: "Submit the final triage result. Call this last.",
  parameters: Type.Object({ category: Type.String(), priority: Type.String(), summary: Type.String() }),
  execute: async (_id, params) => ({ content: [{ type: "text", text: "recorded" }], details: params, terminate: true }),
});
```

The parameters arrive typed and validated, and `terminate: true` ends the run without the extra model turn a normal tool result would trigger. **[verified: 08]** For data that scripts consume, a tool can also declare `outputSchema` and return `structuredContent` alongside its text (`extensions.md`).

## 11. Four process modes wrap the same agent

When a process boundary suits you better than in-process TypeScript, the `pi` CLI offers four modes over the same agent, sessions and tools (`cli-integration.md`):

| Mode | Interface | Lifetime |
|---|---|---|
| Interactive | Terminal UI | Until the user exits |
| Print (`pi --print`) | Final text on stdout | One invocation |
| JSON (`pi --mode json`) | JSONL events on stdout | One invocation |
| RPC | JSONL commands, responses and events | Long-lived |

RPC mode documents 33 commands, from `prompt`, `steer` and `follow_up` to model and session control, and the docs match the package's `RpcCommand` union exactly (fact-check, Tier 3).

## 12. The faux provider makes agents testable offline

pi-ai ships `fauxProvider()`, an in-memory model with scripted responses, which its README offers "for tests and demos" (`pi-ai-README.md`). Register it on a `ModelRuntime`, pass its model to the session, and queue responses:

```ts
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const faux = fauxProvider();
faux.setResponses([
  fauxAssistantMessage([fauxToolCall("get_temperature", { city: "Lisbon" })], { stopReason: "toolUse" }),
  fauxAssistantMessage(fauxText("It is 21°C in Lisbon.")),
]);
const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const { session } = await createAgentSession({
  modelRuntime, model: faux.getModel(),
  sessionManager: SessionManager.inMemory(), settingsManager: SettingsManager.inMemory(),
});
```

A response can also be a function of the request context, which lets one script react to whatever tools the session declares; `verify/pi/scripts/faux-model.mjs` uses that to run unmodified doc examples. Set `tokensPerSecond` to slow streaming, as the steering test does. All eight examples in `verify/pi/examples/` run this way, with no API key. **[verified: 01–08]**

## 13. Production agents need a gate, isolation and an explicit model

Pi leaves five safety jobs to you:
- **Gate tool calls.** Block or approve risky calls in a `tool_call` extension. Remove the built-in tools you don't need with `noTools` or `tools`. **[verified: 07, 08]**
- **Isolate the process.** Run the whole Pi process in a container, VM or sandbox. The docs call this "usually the strongest practical option" (`security.md`, `containerization.md`).
- **Pin the model.** Pass `model` and `modelRuntime`, so ambient cloud credentials can't choose one for you (section 2).
- **Scrub the environment.** Give the process only the variables and credentials it needs, ideally short-lived ones (`security.md`).
- **Own discovery.** Use in-memory managers and an explicit `DefaultResourceLoader` in embedded agents, so a working folder can't load extensions or settings you didn't choose.

## 14. A gated triage agent takes five layers and about 100 lines

The capstone [`08-triage-agent.ts`](../../../verify/pi/examples/08-triage-agent.ts) builds the same support-triage agent as the Claude reference, one layer at a time:
1. **Define the tools.** `lookup_customer` reads data, `escalate` changes state, and `submit_triage` captures the answer.
2. **Lock the surface.** `noTools: "builtin"` leaves only those three tools. **[verified: 08]**
3. **Gate by risk.** An inline extension audits every `tool_call` and blocks `escalate`; the block reason goes back to the model. **[verified: 08]**
4. **Fix the output shape.** `submit_triage` takes a TypeBox schema and returns `terminate: true`. **[verified: 08]**
5. **Stay self-contained.** In-memory session and settings managers, plus an explicit resource loader over a temp folder, keep `~/.pi` out of the run.

```bash
pnpm install && pnpm --filter @agent-speak/verify-pi test
```

## 15. Eight runnable examples back every [verified] claim

| File | Demonstrates |
|---|---|
| `01-hello-session.ts` | `createAgentSession`, `prompt`, events through `agent_settled`, the four default tools |
| `02-custom-tool.ts` | `defineTool` and `customTools`, tool execution events, the `toolResult` turn |
| `03-tool-selection.ts` | `tools`, `excludeTools`, `noTools`, and the error result for an inactive tool |
| `04-steering.ts` | `prompt()` rejecting mid-run, `steer()` and `followUp()` queueing in order |
| `05-session-tree.ts` | `branch()`, both branches kept, `getBranch()` versus `getEntries()` |
| `06-compaction.ts` | `compact()`, the appended entry, split-span summaries, the next request's context |
| `07-extension-gate.ts` | An inline extension registering a tool and blocking it from `tool_call` |
| `08-triage-agent.ts` | The capstone, combining all of the above |

## Conclusion: Pi trades vendor guardrails for a harness you can read

Pi suits teams that want to own their agent harness: the loop, the session tree, compaction and the provider layer are all in-process TypeScript, and the faux provider makes every layer testable offline. Its docs are accurate, too: the reference pages matched the 1.5.2 package exactly on session entries, RPC commands and extension events, and on every documented setting. The cost of that openness is safety work Pi won't do for you. Before you put a Pi agent in front of real tools, write a `tool_call` extension that blocks risky calls, run the process in a container with a scrubbed environment, and pin the model. To start, copy [`08-triage-agent.ts`](../../../verify/pi/examples/08-triage-agent.ts), swap in your tools, and run `pnpm --filter @agent-speak/verify-pi test` to confirm the gate still holds.
