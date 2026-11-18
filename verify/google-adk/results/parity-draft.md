# TypeScript parity draft: `@google/adk@2.5.0` against Python `google-adk` 2.14.1

Python is ADK's primary language, and the TypeScript package trails it in three ways. Some features have no TypeScript counterpart at all. Others exist in a weaker form. A third group exists in TypeScript, but the docs document them only for Python. This draft lists each gap with the Python evidence and the TypeScript evidence. Todo S7b turns it into the fact-check's parity section, and C5 into `docs/comparison/typescript-gaps.md`.

**Sources, as of November 2026:**

- **Python source:** `google/adk-python` at tag `v2.14.1` (commit `ae1265b1`). Paths below are relative to `src/google/adk/`.
- **Python docs:** `google/adk-docs` at `ff7a5f56` (2026-11-17), mirrored in `docs/reference/google-adk/source/adk-docs/`.
- **TypeScript types:** `@google/adk@2.5.0`, `node_modules/@google/adk/dist/types/` (`d.ts:` below).
- **TypeScript source:** `google/adk-js` at tag `main-v2.5.0` (commit `b1b94c0d`).

**Method:** each docs section opens with a "Supported in ADK" tag that names the languages and the first version supporting the feature. `scripts/factcheck-api.mjs` reads all 261 tags (`results/factcheck-api.json`, `checks.supportTags`). 152 of them list Python but not TypeScript. For each of those features, the TypeScript `.d.ts` files were searched for the class, option or method. A feature counts as **missing** when no `.d.ts` file declares it. It counts as **weaker** when TypeScript has it but behaves less strictly; a behavioral example verifies each weaker entry. It counts as **Python-only docs** when TypeScript exports it but the docs omit a TypeScript tag or tab. Most of the 152 tags are third-party or Google Cloud integration pages, which the tables below don't list one by one.

## 1. Missing from the TypeScript package

| Feature | Python evidence | TypeScript evidence of absence |
|---|---|---|
| LiteLLM connector, which also serves the Ollama, vLLM and LiteRT-LM pages | `docs/agents/models/litellm.md:4` (Python v0.1.0); `models/lite_llm.py:4588` `class LiteLlm(BaseLlm)` | No `LiteLlm` in `d.ts`. The model classes are `Gemini`, `ApigeeLlm`, `ChromeBuiltInLlm` and `RoutedLlm` (`d.ts: common.d.ts`), plus Claude in the separate `@google/adk-integrations` package |
| Context caching | `docs/context/caching.md:4` (Python v1.15.0); `agents/context_cache_config.py:23`, `apps/app.py:86` `context_cache_config` | `AppOptions` has only `name`, `rootAgent`, `plugins` and `resumabilityConfig` (`d.ts: apps/app.d.ts`); no `ContextCacheConfig` anywhere |
| App-level event compaction | `apps/app.py:83` `events_compaction_config` | Not on `AppOptions`. TypeScript compacts per agent instead, through `LlmAgentConfig.contextCompactors` (`d.ts: agents/llm_agent.d.ts`), so this gap is a different design rather than a pure absence |
| Session rewind | `docs/sessions/session/rewind.md:4` (Python v1.17.0); `runners.py:1389` `rewind_async` | `Runner` declares no `rewind` member (`d.ts: runner/runner.d.ts:116`; `checks.runner.members`) |
| A default model for agents without one | `docs/agents/llm-agents.md:444` (Python v1.22.0); `agents/llm_agent.py:786` `set_default_model`, default `gemini-3.5-flash` (`:297`) | No `setDefaultModel`. `canonicalModel` walks the agent's ancestors and then throws `No model found for <name>` (adk-js `core/src/agents/llm_agent.ts:688-705`) |
| Agent Config (YAML agents) | `docs/agents/config.md:4` (Python v1.11.0); `agents/config_agent_utils.py:705` `from_config`, deprecated in Python (`agents/llm_agent.py:306-307`) | No `fromConfig` or YAML loader in `d.ts` |
| Toolset-level authentication | `docs/tools-custom/authentication.md:474` (Python v1.24.0); `tools/base_toolset.py:248` `get_auth_config` | `BaseToolset` declares no auth member (`d.ts: tools/base_toolset.d.ts:28`) |
| Dynamic MCP instructions | `docs/tools-custom/mcp-tools/advanced.md:359` (Python v1.18.0); `agents/mcp_instruction_provider.py:29` | No `McpInstructionProvider` in `d.ts` |
| Bash tool and environment toolset | `docs/integrations/bashtool.md:11`, `docs/integrations/environment-toolset.md:11`; `tools/bash_tool.py:172` `ExecuteBashTool`, `tools/environment/_environment_toolset.py:45` | TypeScript has `LocalEnvironment` (`d.ts: environment/local_environment.d.ts`) but no toolset that offers it to the model; no `ExecuteBashTool` |
| Evaluation by user simulation, custom metrics and environment simulation | `docs/evaluate/user-sim.md:4` (v1.18.0), `custom_metrics.md:4`, `environment_simulation.md:4`; `evaluation/simulation/user_simulator.py:95` | TypeScript has `runEvals` and the eval-set managers (`d.ts: index.d.ts`) but no `UserSimulator` or custom-metric API |
| Google Cloud toolsets: Pub/Sub, Spanner, Bigtable | `docs/integrations/{pubsub,spanner,bigtable}.md:11`; `tools/pubsub/pubsub_toolset.py:33`, `tools/spanner/spanner_toolset.py:38`, `tools/bigtable/bigtable_toolset.py:291` | Not in `@google/adk` or `@google/adk-integrations` (adk-js `integrations/src/index.ts` exports BigQuery, CrewAI, LangChain and Anthropic only) |
| GKE code executor | `docs/integrations/gke-code-executor.md:11`; `code_executors/gke_code_executor.py:53` | TypeScript's executors are `BuiltInCodeExecutor`, `UnsafeLocalCodeExecutor`, `ContainerCodeExecutor` and `AgentEngineSandboxCodeExecutor` (`d.ts: index.d.ts`, `common.d.ts`) |
| Ambient agents (event triggers) | `docs/runtime/ambient-agents.md:4` (Python v1.29.0); `cli/trigger_routes.py:17` (`/trigger/pubsub` and `/trigger/eventarc` endpoints) | No trigger or ambient API in `d.ts` |
| `AuthenticatedFunctionTool` | `docs/tools-custom/authentication.md:721` | Not in 2.5.0, but exported on adk-js main (`results/latest-releases.json`, `exportsOnMainNotIn250`), so it is due in a later release |

## 2. Present in TypeScript, in a weaker form

| Feature | Python behavior | TypeScript 2.5.0 behavior | Verified by |
|---|---|---|---|
| `outputSchema` validation | `validate_schema()` runs pydantic `model_validate_json`, which raises on bad output (`agents/llm_agent.py:1143`, `utils/_schema_utils.py:260`). The docs say the final response "*must* be a JSON string conforming to this schema" (`docs/agents/llm-agents.md:487-489`) | Invalid JSON and schema violations are only logged at ERROR. The run succeeds, and `outputKey` holds the raw text or the invalid object (adk-js `core/src/agents/llm_agent.ts:896-919`, where a comment says rejecting is "a separate behaviour change") | `examples/06-structured-output.ts` |
| Parallel tool execution | Calls from one model turn run concurrently since v1.10.0 (`docs/tools-custom/performance.md:4`; `flows/llm_flows/tools/_batch_executor.py:246` `_gather_or_cancel`) | Calls run one after another: an `await` inside a `for` loop (adk-js `core/src/agents/functions.ts:571`) | `examples/01-function-tool.ts`, last two checks |

## 3. In TypeScript, but documented only for Python

The docs give these sections a Python tag and no TypeScript tag, or describe the TypeScript path wrongly. Each one exists in 2.5.0's `.d.ts`.

| Feature | Docs | TypeScript evidence |
|---|---|---|
| Tool confirmation with `requireConfirmation` | `docs/tools-custom/confirmation.md:48-54` and the note at `:80` say TypeScript "requires manual implementation of confirmation logic within the tool's `execute` function" | `ToolOptions.requireConfirmation?: boolean \| (args, ctx) => boolean` (`d.ts: tools/function_tool.d.ts`); `examples/07-tool-confirmation.ts` verifies pause, approve, reject and the predicate |
| Resuming stopped agents | `docs/runtime/resume.md:4` (Python v1.16.0 and Kotlin only) | `createResumabilityConfig`, `App.resumabilityConfig` and `RunnerConfig.resumabilityConfig` (`d.ts: apps/app.d.ts`, `runner/runner.d.ts`) |
| Live (bidi) streaming | `docs/live/index.md:4` and every `docs/live/*` page (Python only) | `Runner.runLive` (`d.ts: runner/runner.d.ts:265`), `LiveRequestQueue` (`d.ts: common.d.ts`) |
| Planners | `docs/agents/llm-agents.md:734` (Python v0.1.0) | `BuiltInPlanner`, `PlanReActPlanner`, `LlmAgentConfig.planner` |
| Code execution | `docs/agents/llm-agents.md:927`, `docs/integrations/code-execution.md:11` | `BuiltInCodeExecutor`, `LlmAgentConfig.codeExecutor` |
| Database and Vertex AI session services | `docs/sessions/session/index.md:280`, `:398` | `DatabaseSessionService` and `VertexAiSessionService` (`d.ts: index.d.ts`) |
| OpenAPI tools | `docs/tools-custom/openapi-tools.md:4` | `OpenAPIToolset` (`d.ts: index.d.ts`) |
| Reflect-and-retry plugin | `docs/integrations/reflect-and-retry.md:11` | `ReflectAndRetryToolPlugin`, `ReflectAndRetryModelPlugin` (`d.ts: common.d.ts`) |
| `DebugLoggingPlugin` | `docs/observability/logging.md:387` | `DebugLoggingPlugin` (`d.ts: index.d.ts`) |
| Gemini Interactions API | `docs/agents/models/google-gemini/index.md:144` | `INTERACTIONS_REQUEST_PROCESSOR` (`d.ts: common.d.ts`) |
| Computer use | `docs/integrations/computer-use.md:11` | `ComputerUseToolset` (`d.ts: common.d.ts`) |
| Files retrieval | `docs/integrations/filesretrieval.md:11` | `FilesRetrieval` (`d.ts: index.d.ts`) |
| Task-mode delegation (collaborative teams) | `docs/workflows/collaboration.md:4` (Python v2.0.0) | `LlmAgentConfig.mode?: 'single_turn' \| 'task'` and `finishTaskTool` (`d.ts: agents/llm_agent.d.ts`) |
| Plugins registered on an `App` | `docs/plugins/index.md:726-727` says "on the `Runner`, or in Python on the `App`" | `AppOptions.plugins` (`d.ts: apps/app.d.ts`); the adk-js `samples/confirm_writes/agent.ts` sample uses it |
| BigQuery Agent Analytics plugin | `docs/integrations/bigquery-agent-analytics.md` (Python tags only) | In `@google/adk-integrations/bigquery` (adk-js `integrations/src/bigquery_analytics/plugin.ts`), a separate package this harness doesn't install |

## 4. TypeScript-only features, for balance

`ChromeBuiltInLlm` (Chrome's on-device Prompt API), `WebMCPToolset` and `RoutedLlm`/`RoutedAgent` appear in `d.ts: common.d.ts`. A class-name search of `src/google/adk` in Python 2.14.1 finds none of them. `LangGraphAgent` exists in both (`agents/langgraph_agent.py`).

Not a gap: "a `Workflow` cannot yet be used as an `LlmAgent` sub-agent" applies to Python and TypeScript alike (`docs/workflows/patterns.md:12-19`, a note headed "Python and TypeScript"; `d.ts: agents/sequential_agent.d.ts:23`).

## Not checked

- Python behavior behind each "missing" entry. Only the class names were confirmed in the Python source; none of it was run.
- The 100 or so third-party integration pages without a TypeScript tag (observability vendors, vector stores, Slack and LiveKit runners). Most ship as separate Python packages or partner plugins.
- Kotlin, Go and Java parity.
