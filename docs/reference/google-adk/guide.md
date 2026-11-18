# Building agents with Google ADK in TypeScript: the port does more than its docs say, but enforces less

*Version `@google/adk@2.5.0` with `@google/genai@2.32.0`, TypeScript, November 2026. The owner chose the 2.5.0 pin on 2026-11-18, when the release was six days old. **[verified: NN]** marks a claim asserted by example `NN` in [`verify/google-adk/examples/`](../../../verify/google-adk/examples/), run offline on a scripted `BaseLlm` subclass. Other claims cite their upstream page in [`source/adk-docs/`](source/adk-docs/) (`google/adk-docs` at commit `ff7a5f56`, 2026-11-17), or the package's own declarations under `node_modules/@google/adk/dist/types/` (`d.ts:` below). Paths such as `tools/function_tool.ts` name adk-js source files at tag `main-v2.5.0`, the commit npm records for 2.5.0. [fact-check.md](fact-check.md) rates the pages.*

Google's Agent Development Kit (ADK) is a Python-first framework. Python `google-adk` is at 2.14.1, and the TypeScript package `@google/adk` at 2.5.0 (as of November 2026). One docs site serves Python, TypeScript, Go, Java and Kotlin, with a tab per language and a "Supported in ADK" tag on each section. Of those 261 tags, 152 list Python but not TypeScript, so a TypeScript reader often can't tell whether a feature exists. Sometimes the feature does exist: the confirmation page tells TypeScript users to build tool approval by hand, yet 2.5.0 ships a `requireConfirmation` option. Elsewhere the port is weaker than the page implies. A TypeScript agent's `outputSchema` is only logged when the model breaks it, and several tool calls from one model turn run one after another. In this guide, I explain how `LlmAgent`, `Runner`, sessions, callbacks and the graph `Workflow` fit together in 2.5.0, and I build a support-triage agent whose escalation waits for a person's approval. I then list where the TypeScript package trails Python, and where the docs undersell it.

## 1. An `LlmAgent` is configuration, and a `Runner` drives it over a session

ADK splits an agent into three objects. An `LlmAgent` holds the model, the instruction, the tools and the callbacks. A session service stores sessions, each with its events and state. A `Runner` takes a user message, runs the agent loop and appends every event to the session (`docs/runtime/event-loop.md`; `docs/agents/llm-agents.md`):

```ts
import { FunctionTool, InMemoryRunner, LlmAgent } from "@google/adk";
import { z } from "zod";

const getOrderStatus = new FunctionTool({
  name: "get_order_status",
  description: "Look up an order by id.",
  parameters: z.object({ orderId: z.string() }),
  execute: ({ orderId }) => `order ${orderId} shipped`,
});
const agent = new LlmAgent({
  name: "support", model: "gemini-flash-latest",
  instruction: "Answer order questions.", tools: [getOrderStatus],
});
const runner = new InMemoryRunner({ agent, appName: "orders" });
const session = await runner.sessionService.createSession({ appName: "orders", userId: "u1" });
for await (const event of runner.runAsync({
  userId: "u1", sessionId: session.id,
  newMessage: { role: "user", parts: [{ text: "Where is order A-1?" }] },
})) console.log(event.author, event.content?.parts);
```

`runAsync` yields events as they happen: the model's function call, the tool's response and the final answer. **[verified: 01]** Each tool result triggers another model call, and the last event is the final response, which `isFinalResponse(event)` detects. **[verified: 01]** ADK also prepends an identity line to your instruction, such as `Your internal name is "support"`, so the system prompt the model sees is longer than the one you wrote. **[verified: 01]** `InMemoryRunner` bundles in-memory session, artifact and memory services, which suit tests and scripts (`d.ts: runner/in_memory_runner.d.ts`). For production, `Runner` takes the services you choose (`d.ts: runner/runner.d.ts`).

## 2. Install `@google/adk`, and give the Gemini client a key

```bash
npm install @google/adk
npm install -D @google/adk-devtools   # the `adk` CLI: npx adk run agent.ts, npx adk web
```

The quickstart puts `GEMINI_API_KEY` in `.env`, and a model string such as `gemini-flash-latest` resolves to the built-in `Gemini` class (`docs/get-started/typescript.md`). `@google/genai` is the model layer, and its `Content` and `Part` types appear throughout ADK's API. The other built-in models are `ApigeeLlm`, `ChromeBuiltInLlm` (Chrome's on-device Prompt API) and `RoutedLlm` (`d.ts: common.d.ts`). Claude and the LangChain, CrewAI and BigQuery integrations ship separately, in `@google/adk-integrations`, which this reference did not install. TypeScript has no LiteLLM connector, so the Ollama and vLLM pages apply to Python only (section 13).

## 3. Function tools validate arguments with zod, return errors to the model, and run one at a time

A `FunctionTool` takes a zod object as `parameters`. ADK converts it into a Gemini function declaration, with type `OBJECT`, typed properties and the required fields marked. **[verified: 01]** A non-object return value comes back wrapped as `{ result: ... }`, as the docs say (`docs/tools-custom/function-tools.md`, "Return type"). **[verified: 01]**

When the model sends arguments that fail the schema, the tool body never runs. Instead, `FunctionTool.runAsync` throws `Error in tool '<name>': ...` with the zod issues, and the agent loop catches the throw and sends the model `{ error: "<message>" }` as the tool result (`tools/function_tool.ts`, `agents/functions.ts`). **[verified: 01]** The same path handles an `execute` that throws, and a plugin's `onToolErrorCallback` can replace the error first. As a result, the model gets a chance to retry with corrected arguments, and the run continues (fact-check F14).

> **Gotcha.** Several function calls in one model turn run sequentially in TypeScript: the loop awaits each call inside a `for` loop (`agents/functions.ts`). In example 01, the second of two 100 ms tools started only after the first finished. **[verified: 01]** Python has run them concurrently since 1.10.0, and the performance page is tagged Python only (`docs/tools-custom/performance.md`). Slow, independent tools therefore add up their latencies in TypeScript, so batch the work inside one tool when latency matters (fact-check F11).

## 4. The workflow agents still run, but 2.5.0 deprecates all three

`SequentialAgent`, `ParallelAgent` and `LoopAgent` orchestrate sub-agents without a model of their own (`docs/agents/workflow-agents/`):
- **`SequentialAgent`** runs its sub-agents in order. One agent's `outputKey` writes its reply to session state, and a later instruction reads it with `{key}` templating, so `"Review this: {draft}"` receives the writer's draft. **[verified: 02]**
- **`ParallelAgent`** runs every sub-agent on its own branch (`fan.a`, `fan.b`). A sibling's reply stays out of the other's context, but both write to the shared session state. **[verified: 02]**
- **`LoopAgent`** repeats until `maxIterations`, or until a sub-agent calls the built-in `exit_loop` tool, which sets `actions.escalate`. **[verified: 02]**

Constructing any of the three logs "X is deprecated in favor of Workflow and will be removed in a future version". **[verified: 02]** The docs agree: a warning on the workflow-agents page and a note on the patterns page both point to graph workflows (`docs/agents/workflow-agents/index.md`, `docs/workflows/patterns.md`). The warning adds one limit that shapes migration: "Workflow cannot yet be used as an LlmAgent sub-agent". An agent tree that nests a pipeline under an `LlmAgent` has to keep the old classes for now (fact-check F13).

## 5. The graph `Workflow` replaces them, and it warns at run time that it is experimental

A `Workflow` wires nodes with edges that start at `"START"`. A node can be a plain function wrapped with `node()`, an `LlmAgent`, a tool or another workflow, and each node's return value becomes the next node's input (`docs/graphs/index.md`, `docs/graphs/routes.md`):

```ts
const router = node((_ctx: NodeContext, input: string) =>
  createEvent({ route: /\d/.test(input) ? "DIGITS" : "WORDS", output: input }), { name: "router" });
const wf = new Workflow({
  name: "route",
  edges: [["START", router], [router, { DIGITS: digits, WORDS: agentNode }]],
});
```

Example 03 exercises four graph features. **[verified: 03]**
1. **Sequence.** In `START → trim → upper`, the user text reaches `trim`, and `upper` returns `"HELLO"`.
2. **Routing.** A node that emits `createEvent({ route })` selects the branch, and the other branch never runs. An `LlmAgent` node calls its model only when routed to.
3. **Fan-in.** A `JoinNode` waits for every branch and passes `{ nodeName: output }` to the next node.
4. **Human input.** A node that yields `RequestInput` pauses the run with a long-running `adk_request_input` call. The next user message resumes the paused node with that text.

Function-only graphs need no model at all, so they test cheaply. `Workflow` also accepts retry, timeout, concurrency and schema options that the graph pages barely mention: the docs use 2 of its 13 options (fact-check, Tier 3).

> **Gotcha.** Constructing a `Workflow` logs "Class Workflow is experimental and may change in the future." (seen in example 03's output). The `.d.ts` carries no `@experimental` tag, so an editor shows nothing, and the graphs overview tags the feature "TypeScript v2.0.0" with an experimental note for Kotlin only (`docs/graphs/index.md`). Only the retry page warns that the TypeScript workflow APIs behind retries and timeouts are experimental (`docs/graphs/retry.md`). Treat the whole graph runtime as experimental in 2.5.0 (fact-check F8).

## 6. Session state is scoped by key prefix, and changes go through events

State keys carry their scope in a prefix (`docs/sessions/state.md`, "State Prefixes"):

| Prefix | Shared by | Persisted |
|---|---|---|
| none | one session | yes |
| `user:` | all of one user's sessions | yes |
| `app:` | every user of the app | yes |
| `temp:` | one invocation | no |

On `InMemorySessionService`, all four behaved as documented. A tool's `context.state.set` persisted, and a `temp:` key was readable during the invocation and gone afterwards. **[verified: 04]** To change state outside a run, append an event whose `actions` carry a `stateDelta`, as the docs show. `appendEvent` applies it and drops `temp:` keys. **[verified: 04]** The docs warn against mutating a fetched `Session` directly (`docs/sessions/state.md`, "A Warning About Direct State Modification"). In 2.5.0, such a change has no effect at all: `getSession` returns a copy, so the next fetch shows the stored value. **[verified: 04]** `listSessions` returns a user's sessions. **[verified: 04]**

Persistent backends exist in TypeScript too, `DatabaseSessionService` and `VertexAiSessionService`, though the docs tag their sections Python only (section 13).

## 7. Callbacks and plugins share hook names, but not parameter names

ADK has two layers of hooks. **Agent callbacks** are options on one `LlmAgent`: before and after the agent, the model call and each tool call (`docs/callbacks/types-of-callbacks.md`). A before-callback that returns a value replaces the step, and an after-callback that returns a value replaces the result. **[verified: 05]**
- **`beforeAgentCallback`** returning `Content` skips the agent, with no model call.
- **`beforeModelCallback`** returning an `LlmResponse` skips the model, which suits caching. It receives the full `LlmRequest`.
- **`afterModelCallback`** returning a response replaces the model's reply.
- **`beforeToolCallback`** returning an object skips the tool body, and the model receives that object as the tool result. This is how you block a tool.
- **`afterToolCallback`** returning an object replaces the tool's result.

**Plugins** extend `BasePlugin` and register on a `Runner` or an `App`, where their hooks apply to every agent, model and tool (`docs/plugins/index.md`). A plugin hook runs first, and when it returns a value, the agent's own callback is skipped. **[verified: 05]** Plugins offer 16 hooks, including `onToolErrorCallback` and `onModelErrorCallback`, of which the docs' TypeScript code uses 3 (fact-check, Tier 3).

> **Gotcha.** The two layers name the same arguments differently. An agent callback receives `({ tool, args, context })` or `({ context, request })`, while a plugin hook receives `({ tool, toolArgs, toolContext })` or `({ callbackContext, llmRequest })` (`d.ts: agents/llm_agent.d.ts`, `plugins/base_plugin.d.ts`). Example 05 uses both forms. **[verified: 05]** Check the names whenever you move a callback into a plugin (fact-check F12).

> **Gotcha.** The plugin page's `CountInvocationPlugin` declares `beforeAgentCallback(agent, context)` with positional parameters (`docs/plugins/index.md`). `BasePlugin` hooks take one object, so `tsc` rejects the class with TS2416. At run time, the first parameter receives the object `{ agent, callbackContext }`, and `context` is `undefined`. **[verified: 05]** The page's counter works only because it never reads its arguments. Destructure one object parameter instead (fact-check F1).

## 8. `outputSchema` shapes the request, but TypeScript never enforces it

Set `outputSchema` to a zod object, and ADK sends it as the request's `responseSchema` with `responseMimeType: "application/json"`. With `outputKey` set, the parsed object, not the JSON text, lands in session state. **[verified: 06]** When the agent also has tools, the Gemini API backend can't combine tools with a response schema. ADK therefore offers a `set_model_response` tool, sends no `responseSchema`, and turns that tool's arguments into the final answer. **[verified: 06]**

> **Gotcha.** The docs say the final response "*must* be a JSON string conforming to this schema" (`docs/agents/llm-agents.md`, `output_schema`). In TypeScript 2.5.0, a failure is only logged at ERROR level, and the code checks the schema only while saving to `outputKey`. A reply that isn't JSON is stored in `outputKey` as raw text, and JSON that violates the schema is stored as the invalid object. Neither produces an error event. **[verified: 06]** A source comment calls rejection "a separate behaviour change" (`agents/llm_agent.ts`). Python raises a pydantic validation error instead (`adk-python` v2.14.1, `agents/llm_agent.py`). Re-validate the stored value yourself, as the capstone does with `TriageResult.parse` (fact-check F10).

## 9. `requireConfirmation` pauses a tool for approval, although the confirmation page says TypeScript lacks it

The confirmation page tells TypeScript users to implement approval "manually within the `execute` function" by calling `toolContext.requestConfirmation`, and its TypeScript snippet does exactly that (`docs/tools-custom/confirmation.md`, "Boolean confirmation"). Yet 2.5.0's `FunctionTool` has the option that Python, Go and Java document, and the graphs human-input page even names it for TypeScript (`docs/graphs/human-input.md`):

```ts
const reimburse = new FunctionTool({
  name: "reimburse",
  description: "Reimburse an amount.",
  parameters: z.object({ amount: z.number() }),
  requireConfirmation: ({ amount }) => amount > 100,   // or `true`
  execute: ({ amount }) => ({ status: "paid", amount }),
});
```

Example 07 shows the full round trip. **[verified: 07]**
1. **Pause.** The call pauses before the tool body runs. ADK emits a long-running `adk_request_confirmation` call that carries the original call and its arguments, and the turn makes no further model call.
2. **Approve.** The app resumes by sending a user message with a `functionResponse` for that call id, named `REQUEST_CONFIRMATION_FUNCTION_CALL_NAME`, with `response: { confirmed: true }`. The tool then runs with the original arguments, and the model answers.
3. **Reject.** With `confirmed: false`, the tool never runs, and the model receives `{ error: "This tool call is rejected." }`.
4. **Predicate.** A predicate that returns `false` lets the call through without asking.

The pause is stored as session events, so the answer can arrive in a later request. A confirmation for a call id that ADK never issued runs nothing. ADK treats the message as a new turn, and the tool asks for confirmation again. **[verified: 07]** One limit is documented only in the `.d.ts`: a `requireConfirmation` tool used directly as a graph node "does not pause". It returns the confirmation error as its node output (`d.ts: tools/function_tool.d.ts`). Use `RequestInput` for approval inside a `Workflow` (fact-check F2, F15).

## 10. Offline tests need a `BaseLlm` subclass, because ADK ships no fake model

`@google/adk@2.5.0` exports no fake, mock or scripted model. The adk-js repo keeps a record-and-replay model in its own integration tests, outside the package. The seam ADK's tests use is `BaseLlm`, and a subclass takes a dozen lines (`verify/google-adk/examples/lib/check.ts`):

```ts
class ScriptedLlm extends BaseLlm {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly script: (req: LlmRequest, n: number) => LlmResponse) {
    super({ model: "scripted" });
  }
  override async *generateContentAsync(req: LlmRequest) {
    this.requests.push(structuredClone({ contents: req.contents, config: { ...req.config, abortSignal: undefined } }));
    yield this.script(req, this.requests.length);
  }
  override async connect(): Promise<BaseLlmConnection> { throw new Error("live connections are not scripted"); }
}
```

Pass an instance as the agent's `model`. Each test scripts responses per request and asserts on the recorded requests: the offered tools, the system instruction and the function responses. **[verified: 01–08]** Copy each request, because ADK reuses and mutates request objects between steps. For doc examples that construct `Gemini` by name, our harness registers the same scripted model with `LLMRegistry` under Gemini's patterns, in a preload (`verify/google-adk/scripts/scripted-preload.mjs`). Function-only `Workflow` graphs need no model at all. Of the doc sources, 45 ran without a model call, among them such graphs and samples that bring their own deterministic model (fact-check, Tier 2).

## 11. Production agents need five decisions made up front

- **Structured output.** Parse `outputKey` values with your own zod schema, because ADK stores invalid output (section 8).
- **Gates.** Put `requireConfirmation` on every state-changing tool, and send confirmations only for call ids that ADK issued (section 9).
- **Tool latency.** Expect independent tool calls to run in sequence, and merge slow lookups into one tool where it matters (section 3).
- **Orchestration.** Choose between the deprecated workflow agents, which nest under an `LlmAgent`, and the experimental `Workflow`, which can't yet. Pin the minor version either way (sections 4 and 5).
- **Limits and services.** `RunConfig.maxLlmCalls` defaults to 500 (`d.ts: agents/run_config.d.ts`), and `InMemorySessionService` keeps everything in process memory. Set a lower limit, and pick `DatabaseSessionService` or `VertexAiSessionService` before launch (section 6).

## 12. A gated triage agent takes four settings

The capstone [`08-triage-agent.ts`](../../../verify/google-adk/examples/08-triage-agent.ts) builds the same support-triage agent as the other references, on one `LlmAgent`:
1. **Identity from state.** `lookup_customer` takes no arguments and reads `user:customer_id`, which the app sets when it creates the session. Zod strips the `customerId` the scripted model tries to smuggle in, so another customer's record never reaches the model. Without the key, the tool returns an error. **[verified: 08]**
2. **`requireConfirmation: true` on `escalate_to_human`.** The escalation pauses and does not run until a person approves its call id. Approval runs it exactly once, for the session's customer, and a rejection never runs it. **[verified: 08]**
3. **`outputSchema` and `outputKey`.** The answer arrives through `set_model_response`, and the app re-parses it with zod, so `escalated` reflects what actually happened. **[verified: 08]**
4. **`beforeToolCallback`.** A name pattern refuses host tools as a second line of defense, and no host tool is ever offered. **[verified: 08]**

```bash
pnpm install && pnpm --filter @agent-speak/verify-google-adk test
```

## 13. Eight runnable examples back the [verified] claims

| File | Demonstrates |
|---|---|
| `01-function-tool.ts` | The zod declaration, `{error}` for invalid arguments, `{result}` wrapping, sequential calls |
| `02-workflow-agents.ts` | Sequential order with `outputKey` and `{key}`, parallel branches, `LoopAgent` limits and `exit_loop`, the deprecation warnings |
| `03-graph-workflow.ts` | `Workflow` sequences, `route` branching, `JoinNode` fan-in, `RequestInput` pause and resume |
| `04-sessions-state.ts` | The four state prefixes, `appendEvent` with a `stateDelta`, the fetched-session copy |
| `05-callbacks.ts` | Before and after agent, model and tool callbacks, plugin precedence, the positional plugin hook |
| `06-structured-output.ts` | `responseSchema`, `outputKey` parsing, unenforced schemas, `set_model_response` |
| `07-tool-confirmation.ts` | `requireConfirmation`: pause, approve, reject, the predicate, an unknown call id |
| `08-triage-agent.ts` | The capstone, combining state-scoped identity, approval and typed output |

## 14. TypeScript parity: 2.5.0 lacks 14 Python features, has 2 in weaker form, and has 15 the docs show only for Python

Python is ADK's primary language, so this reference compares the TypeScript package with Python `google-adk` 2.14.1. The method starts from the docs' "Supported in ADK" tags. Of the 261 tags, 97 include TypeScript and 152 list Python but not TypeScript (`verify/google-adk/results/factcheck-api.json`, `checks.supportTags`). For each of those features, the S7a harness searched the 2.5.0 `.d.ts` files for the class, option or method. Most of the 152 tags sit on third-party and Google Cloud integration pages, which the lists below omit. Full evidence, with Python source lines, is in [`verify/google-adk/results/parity-draft.md`](../../../verify/google-adk/results/parity-draft.md), and todo C5 carries it into `docs/comparison/typescript-gaps.md`.

**Missing from TypeScript 2.5.0** (no `.d.ts` declares them):
- **Models and context:** the LiteLLM connector, which also serves the Ollama, vLLM and LiteRT-LM pages; context caching; app-level event compaction, where TypeScript compacts per agent with `contextCompactors` instead; and `set_default_model`, so an agent tree without a model throws "No model found".
- **Runtime:** session rewind, Agent Config (YAML agents) and ambient-agent triggers.
- **Tools and auth:** toolset-level authentication, `McpInstructionProvider`, the Bash tool and environment toolset, the Pub/Sub, Spanner and Bigtable toolsets, the GKE code executor, and `AuthenticatedFunctionTool`, which adk-js main already exports.
- **Evaluation:** user simulation and custom metrics.

**Present in TypeScript, but weaker:** `outputSchema`, which is only logged (section 8), and parallel tool execution, which runs in sequence (section 3).

**Present in TypeScript, but documented only for Python:**
- **Gates and runtime:** `requireConfirmation` (section 9), resumability, live streaming with `runLive`, and task-mode delegation.
- **Agent features:** planners, code execution and the Gemini Interactions API.
- **Services and tools:** the database and Vertex AI session services, the OpenAPI toolset, computer use and files retrieval.
- **Plugins:** plugins on an `App`, the reflect-and-retry plugins, `DebugLoggingPlugin`, and the BigQuery Agent Analytics plugin in `@google/adk-integrations`.

The comparison runs both ways. `ChromeBuiltInLlm`, `WebMCPToolset` and `RoutedLlm` exist only in TypeScript. One limit applies to both languages alike: neither can yet use a `Workflow` as an `LlmAgent` sub-agent (`docs/workflows/patterns.md`). The parity check confirmed Python class names only, and ran no Python code. So before you drop a feature for TypeScript, check the 2.5.0 `.d.ts`: the Python-only tag on a page is no proof of absence.

## Conclusion: build on `LlmAgent` and `requireConfirmation`, and check every output yourself

ADK's TypeScript package suits teams that want Google's agent model, Gemini-first, inside a Node.js process. Its core held offline: `LlmAgent` and `Runner`, function tools, sessions with scoped state, both hook layers, tool confirmation and the graph `Workflow` all behaved as documented in eight examples, apart from the two gaps below. The package is stronger than its Python-first docs suggest: it ships `requireConfirmation`, `App` plugins and 13 other features that the docs document only for Python. In two places, it enforces less than the docs promise. `outputSchema` is never enforced, and tool calls in one turn run one at a time. The orchestration layer is also in transition, with the workflow agents deprecated and their replacement experimental. Before you deploy, re-validate structured output, put `requireConfirmation` on state-changing tools, lower `maxLlmCalls` and choose a persistent session service. Then copy [`08-triage-agent.ts`](../../../verify/google-adk/examples/08-triage-agent.ts), swap in your tools and schema, and run `pnpm --filter @agent-speak/verify-google-adk test` to confirm the gate still holds.
