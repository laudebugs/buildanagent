# S7a findings: Google ADK TypeScript (`@google/adk@2.5.0`)

The findings below come from the harness in `verify/google-adk/`, as of 2026-11-18. The docs are `google/adk-docs` at `ff7a5f56` (2026-11-17), mirrored in `docs/reference/google-adk/source/adk-docs/`. The SDK source is `google/adk-js` at tag `main-v2.5.0` (`b1b94c0d`), mirrored in `docs/reference/google-adk/source/adk-js/`.

Each finding was triaged as a docs error, an SDK behavior, or a TypeScript gap against Python. Harness faults were fixed and are not listed here; the README's "Gotchas" section records them.

## Docs errors

**F1. The TypeScript plugin example uses positional hook parameters, but `BasePlugin` hooks take one object.**
- **Docs:** `docs/plugins/index.md:141` (`count_plugin.ts`) declares `beforeAgentCallback(agent: BaseAgent, context: Context)` at `:162-165` and `beforeModelCallback(context, llmRequest)` at `:174`.
- **SDK:** the hooks take one parameter, `beforeAgentCallback(_params: { agent; callbackContext })` (`node_modules/@google/adk/dist/types/plugins/base_plugin.d.ts:215`) and `beforeModelCallback({ callbackContext, llmRequest })` (`:281`).
- **Effect:** tsc reports TS2416 twice (`results/typecheck-docs.json`, id `docs__plugins__index__01`). At run time the first argument is the params object and `context` is `undefined`. The page's counter still works only because it never reads its arguments.
- **Verified by:** `examples/05-callbacks.ts`, last two checks.

**F2. The confirmation docs say TypeScript has no `requireConfirmation`, but 2.5.0 has it.**
- **Docs:** `docs/tools-custom/confirmation.md:48-54` says TypeScript implements confirmation "manually within the `execute` function". The note at `:80` says "ADK for TypeScript currently requires manual implementation", and `:129` says the same for the predicate form. The TypeScript snippet `examples/typescript/snippets/tools/confirmation/boolean_confirmation.ts` implements it by hand with `toolContext.requestConfirmation`.
- **SDK:** `ToolOptions.requireConfirmation?: boolean | ((input, toolContext) => boolean | Promise<boolean>)` (`dist/types/tools/function_tool.d.ts`). The implementation is in `core/src/tools/function_tool.ts`, `checkConfirmation`: it pauses with `adk_request_confirmation`, and a rejection returns `{error: "This tool call is rejected."}` (`:418`).
- **Verified by:** `examples/07-tool-confirmation.ts` (pause, approve, reject, the predicate, a forged call id) and `examples/08-triage-agent.ts`.

**F3. Four blocks import a runtime function with `import type`, so they fail at run time.**
- **Where:** `docs/agents/custom-agents.md:323` imports `import type { Event, createEventActions }` and calls `createEventActions()` at `:332`. The same pattern appears at `:599`, at `:943` (`createEvent`), and in `docs/workflows/patterns.md:691`, `:693` and `:700`.
- **Effect:** TS1361, 6 errors in 4 files (`results/mismatch-causes.json`, `value-imported-as-type`). A type-only import is erased, so each call throws a ReferenceError.

**F4. Two blocks import ADK's event helpers from `@google/genai`.**
- **Where:** `docs/agents/custom-agents.md:930` (`import type { Part, createEvent, Event } from '@google/genai'`) and `docs/workflows/patterns.md:669` (`Event`, `createEvent`, `createEventActions`).
- **SDK:** all three are `@google/adk` exports (`dist/types/common.d.ts`, `events/event.js`, `events/event_actions.js`).
- **Effect:** TS2305, 5 errors (`event-helpers-from-genai`).

**F5. Two `BaseAgent` subclasses omit the abstract `runLiveImpl`.**
- **Where:** `docs/context/index.md:167` (`MyAgent`) and `:1652` (`MyControllingAgent`).
- **SDK:** `BaseAgent` declares `runLiveImpl` abstract (`dist/types/agents/base_agent.d.ts:207`).
- **Effect:** TS2515. Neither class compiles as written.

**F6. A partner page passes a plain function as a tool, which works in Python but not in TypeScript.**
- **Where:** `docs/integrations/zespan.md:164` puts `tools: [getWeather]`, where `getWeather` is `(city: string) => object`.
- **SDK:** `ToolUnion = BaseTool | BaseToolset | BaseNode` (`dist/types/agents/llm_agent.d.ts`).
- **Effect:** TS2322. TypeScript needs a `FunctionTool` around the function.

**F7. (Minor) A pseudocode block's typed default makes its own comparison impossible.**
- **Where:** `docs/context/index.md:559` calls `state.get('user_display_preference', 'default_mode')`. `State.get<T>(key, default?: T)` infers `T` as the literal `'default_mode'`, so the next line's `=== 'dark_mode'` is TS2367.
- **Effect:** a typing nit in pseudocode, not a behavior bug.

**F8. (Minor) The docs don't mark `Workflow` experimental for TypeScript, but 2.5.0 warns that it is.**
- **Docs:** `docs/graphs/index.md:4` tags graphs "TypeScript v2.0.0" with no Experimental marker. The only experimental note, at `:19-21`, covers Kotlin.
- **SDK:** constructing a `Workflow` logs "Class Workflow is experimental and may change in the future." (`core/src/workflow/workflow.ts:135` `@experimental`, `core/src/utils/experimental.ts`).
- **Verified by:** seen in the `examples/03-graph-workflow.ts` output; no check asserts it.

**F9. (Minor) The plugin page says only Python registers plugins on an `App`.**
- **Docs:** `docs/plugins/index.md:726-727` says "on the `Runner`, or in Python on the `App`".
- **SDK:** TypeScript's `AppOptions.plugins` exists (`dist/types/apps/app.d.ts`), and the adk-js sample `samples/confirm_writes/agent.ts` uses it.

## Surprising defaults and SDK behavior

**F10. `outputSchema` is not enforced.**
- **Behavior:** a reply that isn't JSON, or JSON that fails the schema, is only logged at ERROR. The run succeeds with no error event, and `outputKey` stores the raw text or the invalid object.
- **SDK:** `core/src/agents/llm_agent.ts:896-919`. A code comment there says rejecting would be "a separate behaviour change".
- **Docs:** the final response "*must* be a JSON string conforming to this schema" (`docs/agents/llm-agents.md:487-489`).
- **Python:** raises, via pydantic `model_validate_json` (`adk-python` v2.14.1 `src/google/adk/agents/llm_agent.py:1143`, `utils/_schema_utils.py:260`).
- **Verified by:** `examples/06-structured-output.ts`. The capstone re-validates with zod for this reason.

**F11. Several tool calls in one model turn run sequentially.**
- **SDK:** an `await` inside a `for` loop (`core/src/agents/functions.ts:571`).
- **Python:** runs them concurrently since 1.10.0 (`docs/tools-custom/performance.md:4`, tagged Python only; `flows/llm_flows/tools/_batch_executor.py:246`). This is a parity gap rather than a docs error, because the docs claim parallel execution only for Python.
- **Verified by:** `examples/01-function-tool.ts`, last check: the second call starts after the first ends.

**F12. Plugin hooks and agent callbacks name the same parameters differently.**
- **Agent callbacks:** `beforeToolCallback({ tool, args, context })` and `beforeModelCallback({ context, request })` (`dist/types/agents/llm_agent.d.ts`).
- **Plugin hooks:** `beforeToolCallback({ tool, toolArgs, toolContext })` and `beforeModelCallback({ callbackContext, llmRequest })` (`dist/types/plugins/base_plugin.d.ts:281`, `:377`).
- **Risk:** code moved between the two compiles only where the types are spelled out.
- **Verified by:** `examples/05-callbacks.ts`, which uses both forms.

**F13. All three workflow agents are deprecated in 2.5.0.**
- **SDK:** `SequentialAgent`, `ParallelAgent` and `LoopAgent` each log "X is deprecated in favor of Workflow" when constructed (`@deprecated` in `dist/types/agents/{sequential,parallel,loop}_agent.d.ts`). They also note that "a `Workflow` cannot yet be an `LlmAgent` sub-agent".
- **Docs:** consistent, with warnings at `docs/agents/workflow-agents/index.md:13` and `docs/workflows/patterns.md:12-19`. This is recorded as a fact, not a docs error.
- **Verified by:** `examples/02-workflow-agents.ts`, last check.

**F14. Invalid tool arguments go back to the model as `{error}`.**
- **Behavior:** arguments that fail the zod schema are returned to the model as `{error: "Error in tool '<name>': [zod issues]"}`. They don't throw, and the tool body doesn't run (`core/src/tools/function_tool.ts:283`, `runAsync`: `validateArgs` runs before `execute`, and the catch wraps the error).
- **Verified by:** `examples/01-function-tool.ts`.

**F15. A confirmation with an unknown call id restarts the turn and asks again.**
- **Behavior:** a confirmation `functionResponse` whose call id was never issued does not run the tool. ADK treats the message as a new turn, so the model calls the tool again and a fresh `adk_request_confirmation` is issued. This is safe.
- **Verified by:** `examples/07-tool-confirmation.ts`, last check.

**F16. (Unverified robustness note) Transfer recursion can exhaust the stack before the call limit.**
- **What happened:** two agents that transfer back and forth failed with "Maximum call stack size exceeded", reported as an `UNKNOWN_ERROR` event, before reaching the default 500-call `LlmCallsLimitExceededError`.
- **How it was seen:** the harness's earlier scripted model did this on `adk-js/dev/samples/agent_transfer_return.ts`. With `--stack-size=2000`, the limit error fired instead.
- **Caveat:** only a pathological model triggers it, and no example keeps it reproducible. Treat it as a note for S7b, not a finding.

## TypeScript parity (summary; details in `verify/google-adk/results/parity-draft.md`)

- **Missing in 2.5.0:**
  - LiteLLM, which also blocks Ollama, vLLM and LiteRT-LM.
  - Context caching, and app-level event compaction.
  - Session rewind.
  - `set_default_model`: TypeScript throws "No model found" instead.
  - Agent Config YAML.
  - Toolset-level auth.
  - `McpInstructionProvider`.
  - The Bash tool and the environment toolset.
  - Eval user simulation and custom metrics.
  - The Pub/Sub, Spanner and Bigtable toolsets.
  - The GKE code executor.
  - Ambient-agent triggers.
  - `AuthenticatedFunctionTool`, which is exported on adk-js main.
- **Weaker in 2.5.0:**
  - `outputSchema` validation (F10).
  - Parallel tool execution (F11).
- **In TypeScript but documented only for Python:**
  - Resume.
  - Live streaming (`runLive`).
  - Planners.
  - Code execution.
  - The database and Vertex AI session services.
  - The OpenAPI toolset.
  - The reflect-and-retry plugins.
  - `DebugLoggingPlugin`.
  - The Interactions API.
  - Computer use.
  - Files retrieval.
  - Task mode.
  - `App` plugins (F9).
  - `requireConfirmation` (F2).
- **Count:** 152 of the 261 "Supported in ADK" tags list Python but not TypeScript (`results/factcheck-api.json`, `checks.supportTags`).

## Checked and clean

- **No page runs ahead of 2.5.0.** No mismatch uses a name that only adk-js main exports, and no support tag names a TypeScript version above 2.5.0 (`results/latest-releases.json`, `checks.supportTags.typescriptNewerThanPinned`).
- **No documented option is missing from the package.** Every `LlmAgent`, workflow-agent, `Workflow`, `Runner` and session-service option or member the TypeScript sources use exists in the `.d.ts` files: `notInPackage` is empty in every check.
- **No doc run failed.** All 163 runnable sources ran or were skipped for a stated external need.
