# Observability and evals: what an agent harness must record, and how to measure it

Status: research note, 2026-11-18. Working material for the agent-harness design. The main report ([agent-sdks-and-harness-design.md](../../agent-sdks-and-harness-design.md)) and the [fact-check log](../../fact-check-2026-11-18.md) supersede it where they disagree.

**Thesis.** A harness needs two measurement layers, and they share one data model. The first is *structural telemetry*: a span tree of run → model call → tool call that carries token classes, cost with its provenance, latency, stop reasons and approval waits, with message content **off by default**. The second is an *eval suite*: real models, k trials per task in a clean sandbox, outcome graders, and a report of pass rate, pass^k and **cost per task** against a mini-swe-agent baseline with the model held fixed. Mature SDKs agree on the span shape but not on names. Vercel follows OTel `gen_ai.*`, OpenAI and Claude use vendor schemas, and Pi uses its own vendor-neutral contract. The OTel GenAI conventions are still entirely at Development status, have no release tags, and were renamed during 2026, so we must pin them by commit behind our own constants. Evidence on harness differences says cost resolves far better than pass rate, so token efficiency is a first-class metric, not a footnote.

Versions as of November 2026: `ai` 7.0.162 and `@ai-sdk/otel` 1.0.162 (`verify/vercel-ai-sdk/package.json:20,23`), `@openai/agents-core` 0.21.0, `@anthropic-ai/claude-agent-sdk` 0.3.327 (`verify/claude-agent-sdk/package.json`), `@earendil-works/pi-*` 1.5.2 (`verify/pi/node_modules/@earendil-works/pi-ai/package.json:3`), mini-swe-agent 2.4.6 (clone at `04d809c`, `src/minisweagent/__init__.py:11`), inspect_ai docs at `8012060` (2026-11-17).

Path abbreviations:
- `VOT` = `verify/vercel-ai-sdk/node_modules/@ai-sdk/otel/src/open-telemetry.ts`; `VDOC` = `docs/reference/vercel-ai-sdk/source/content/docs/03-ai-sdk-core/60-telemetry.mdx`
- `OAC` = `verify/openai-agents-sdk/node_modules/@openai/agents-core/dist`; `OADOC` = `docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides/tracing.mdx`
- `CL` = `verify/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`; `COBS`/`CCOST` = `docs/reference/claude-agent-sdk/source/{observability,cost-tracking}.md`
- `PIT` = `verify/pi/node_modules/@earendil-works/pi-telemetry/README.md`; `PIAT` = `verify/pi/node_modules/@earendil-works/pi-ai/dist/telemetry.d.ts`
- `SC` = `open-telemetry/semantic-conventions-genai` at `main` (HEAD `d28355d`, fetched 2026-11-18), `docs/gen-ai/<file>`; `MSWE` = mini-swe-agent clone `src/minisweagent/`; `INS` = inspect_ai clone `docs/`
- `LC` = `langchain-ai/docs` at `9d9747d` (the commit in `docs/reference/langchain/source/_manifest.json`), fetched raw because `observability.mdx` and `test/evals.mdx` are not in our mirror

## 1. Every mature harness emits the same three-level span tree; only the names differ

| | Run / turn | Model call | Tool call | Other |
|---|---|---|---|---|
| OTel GenAI (`SC`) | `invoke_agent {agent.name}`, INTERNAL; `invoke_workflow` when the app owns control flow (`gen-ai-agent-spans.md:181-219`) | `{operation} {request.model}`, CLIENT (`client-inference.md:28-50`) | `execute_tool {tool.name}`, INTERNAL (`execute-tool.md:58-60`) | `create_agent`, `plan`; skill-load spans (`gen-ai-agent-spans.md:32-48,536-562`; `execute-tool.md:336-371`) |
| Vercel `OpenTelemetry` | `invoke_agent {modelId}` (or `functionId`) root | `chat {modelId}` per step, CLIENT | `execute_tool {toolName}` under the step | `LegacyOpenTelemetry` still emits `ai.*` spans (`VDOC:595-649,891-924`; `VOT:1459-1468`) |
| OpenAI Agents | `Trace` → `TaskSpan` → `AgentSpan` → `TurnSpan` | `GenerationSpan` / `ResponseSpan` | `FunctionSpan` (+ `mcp_data`) | `GuardrailSpan`, `HandoffSpan`, `mcp_tools` (`OADOC:55-68`; `OAC/tracing/spans.d.ts:5-117`) |
| Claude Agent SDK (CLI) | `claude_code.interaction` | `claude_code.llm_request` | `claude_code.tool` with children `tool.blocked_on_user` and `tool.execution` | `claude_code.hook`; subagent spans nest under the parent's tool span (`COBS:145-152`) |
| Pi | none in agent-core | `pi.ai.request`, `pi.ai.poll`, with events `pi.ai.first_chunk` and `pi.ai.block` | none | only pi-ai imports pi-telemetry (grep of `pi-agent-core/dist`, `pi-coding-agent/dist`) (`PIAT:8-101`) |

The target tree for our harness, combining the table's rows (attribute names per `SC` at `d28355d`):

```text
invoke_agent {agent.name}            INTERNAL  gen_ai.conversation.id, usage sums, exit status, cost.total (ours)
├─ turn {n}                          INTERNAL  turn usage (OpenAI TurnSpan shape)
│  ├─ chat {request.model}           CLIENT    provider, request.*, response.id, finish_reasons,
│  │                                           usage.input_tokens (incl. cache), cache_read, cache_creation,
│  │                                           output_tokens (incl. reasoning), ttft, cost + cost.source
│  ├─ execute_tool {tool.name}       INTERNAL  tool.call.id, tool.type, error.type
│  │  ├─ approval.wait               INTERNAL  decision (allow_once|allow_always|deny), decided_by
│  │  └─ tool.execution              INTERNAL  sandbox id, exit code
│  └─ event: compaction | retry | fallback | budget_stop
└─ invoke_agent {subagent}           nested only when user-facing (SC gen-ai-agent-spans.md:207-211)
```

Content attributes (`input.messages`, `tool.call.arguments`, `tool.call.result`) are absent from this tree by design (§3).

Three design points recur:
- **Approval wait is its own span.** Only Claude separates permission wait (`tool.blocked_on_user`) from execution (`COBS:149`). Without that split, tool latency mixes human think-time with machine time.
- **Usage is aggregated at the turn and the run.** OpenAI turn spans carry `input_tokens`, `output_tokens`, `cached_input_tokens` and `cache_write_input_tokens`; task spans add `requests` and `total_tokens` (`OAC/tracing/spans.d.ts:12-31`). OTel puts the same sums on `invoke_agent` (`SC/gen-ai-agent-spans.md:250` and footnotes 14-15 at `:326-344`).
- **Context crosses process boundaries through W3C trace context.** The Claude SDK injects `TRACEPARENT`/`TRACESTATE` into the CLI and the CLI forwards them to Bash commands (`COBS:164-170`). Pi exposes `inject`/`extract` carriers and span links, and keeps no ambient context (`PIT:141-150,519`). Vercel derives durable span IDs so that workflow steps reported later still join one trace (`VDOC:256-290`; `verify/vercel-ai-sdk/node_modules/@ai-sdk/otel/src/durable-span-ids.ts`).

## 2. The OTel GenAI conventions are Development-only and moving, so pin them by commit

- Every GenAI document and every agent, inference and tool span is **Development** (`SC/README.md:7`; `gen-ai-agent-spans.md:7,39,175,543`; `client-inference.md:7,34`). Only borrowed attributes such as `error.type` are Stable (`gen-ai-agent-spans.md:225`).
- The conventions **moved out of the main repo** in 2026. `open-telemetry/semantic-conventions/docs/gen-ai/*` now carries only a "Moved" stub ([raw](https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/docs/gen-ai/gen-ai-agent-spans.md)). The new repo has **no tags or releases** (`git ls-remote --tags` returned none, 2026-11-18). A version therefore means a commit SHA.
- Names are still changing. `main` defines the model span as `gen_ai.client.inference` with the `gen_ai.client.inference.duration`/`time_to_first_chunk` metrics and `gen_ai.client.inference.usage.*` token counters (`client-inference.md:11-25`; `gen-ai-token-metrics.md:72-918`). The older `gen_ai.client.operation.duration` remains in `gen-ai-metrics.md:54`. `@ai-sdk/otel` 1.0.162 shows the drift. It records the new histogram, pinned to commit `3fe8460` (`VDOC:564-567`; `VOT:251-271`), but still writes span attributes named `gen_ai.client.operation.duration`/`time_to_first_chunk` (`VOT:154-158`; `VDOC:637-639`).
- New agent-level metrics exist: `gen_ai.invoke_agent.duration` (buckets up to 86,400 s), `gen_ai.invoke_agent.inference_calls`, `gen_ai.invoke_agent.tool_calls` and `gen_ai.execute_tool.duration` (`gen-ai-metrics.md:600-793`; `execute-tool.md:906`).
- No convention defines **cost**. Token counters "serve as a proxy for cost approximation", and the per-operation histograms "should not be used for total usage or cost calculations" (`gen-ai-token-metrics.md:32-44`). Cost needs our own attribute; Pi (`pi.ai.cost`), Claude (cost counter) and Vercel's gateway metadata each invent one (`PIAT:265`; `COBS:244`).

The main report's advice holds and becomes more specific: keep convention names behind our own constants module, stamp the semconv commit SHA in resource attributes, and treat a rename as a versioned migration (`docs/research/agent-sdks-and-harness-design.md:99,119`).

## 3. Content capture must default to off, and two of the four SDKs default it on

The spec is explicit. Instructions, inputs and outputs "are considered sensitive and are often large"; instrumentations "SHOULD NOT capture them by default" but should offer opt-in. Spans should record content only where "privacy regulations do not apply… for example, in pre-production environments", and production should upload content externally and record `*_ref` URIs (`SC/gen-ai-spans.md:466-500`; `_ref` attributes at `gen-ai-agent-spans.md:253-259`). Tool arguments and results are `Opt-In` (`execute-tool.md:82-83`).

| SDK | Default | Switch |
|---|---|---|
| Vercel | **records inputs and outputs** ("By default, both inputs and outputs are recorded"); telemetry is opt-out once an integration is registered | `recordInputs`/`recordOutputs: false` (`VDOC:54-75,107-117`; `select-telemetry-attributes.ts:39-63` "default to true") |
| OpenAI Agents | **records** (`traceIncludeSensitiveData ?? true`), tracing on in server runtimes, off in browsers and when `NODE_ENV=test` | `traceIncludeSensitiveData`, `OPENAI_AGENTS_DONT_LOG_MODEL_DATA`/`_TOOL_DATA` (`OAC/run.mjs:120-121`; `OAC/config.mjs:76-97`; `OADOC:14-19,102-104`) |
| Claude Agent SDK | telemetry off until `CLAUDE_CODE_ENABLE_TELEMETRY=1`; content **not recorded** ("structural by default") | four opt-in variables: `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT` (truncated at 60 KB), `OTEL_LOG_RAW_API_BODIES` (`COBS:47,239-248`) |
| Pi | never records content; `pi.ai.block` keeps only kind, index, char count and tool name; errors capped at 500 chars | schema policy: avoid "prompts, completions, tool arguments or output… credentials" unless the schema allows them (`PIAT:73-101`; `PIT:517`) |
| LangSmith | records once `LANGSMITH_TRACING=true` | `LANGSMITH_HIDE_INPUTS/OUTPUTS`, regex anonymizers (`LC/src/oss/langchain/observability.mdx:36-43`; `LC/src/langsmith/mask-inputs-outputs.mdx:10-27`) |

Two further lessons from the code:
- **A disabled content flag must not disable metrics.** Vercel keeps duration metrics when inputs and outputs are off (`VDOC:589-593`).
- **Cardinality is a policy, not a backend heuristic.** Pi annotates attributes `cardinality: "high"` (for example `response.id`), and its metric schemas reject high-cardinality attributes (`PIAT:64`; `PIT:209,236`). Claude's `OTEL_LOG_TOOL_DETAILS` gates real MCP server and skill names on its cost metrics for the same reason (`COBS:244`).

## 4. Default exporters create lock-in; OTLP plus a collector is the hedge

- **OpenAI** registers its own exporter at import. `@openai/agents` calls `setDefaultOpenAITracingExporter()` at module load (`verify/openai-agents-sdk/node_modules/@openai/agents/dist/index.mjs:5`). That exporter batches to `https://api.openai.com/v1/traces/ingest` (`.../agents-openai/dist/openaiTracingExporter.mjs:6,328-332`), with a queue of 1000, batches of 100 and a 5 s delay (`OAC/tracing/processor.mjs:48-49`). Tracing "is unavailable" under Zero Data Retention (`OADOC:21`). `setTraceProcessors()` replaces the default and `addTraceProcessor()` adds to it (`OADOC:121-124`). Core ships no OTel exporter. The listed integrations are third-party processors (`OADOC:126-132`). Our verify harness had to disable tracing so that tests made no network calls (`docs/research/agent-sdk/notes/testability.md:70`).
- **Claude** exports OTLP directly from the CLI and the SDK produces nothing itself (`COBS:18,28`). Export errors are **silent** unless `CLAUDE_CODE_OTEL_DIAG_STDERR=1`, and a killed process loses its batch buffer (traces every 5 s, metrics every 60 s by default) (`COBS:110,121-123`).
- **Vercel** delegates to the global OTel SDK. A `TracerProvider` alone does not export the metrics, so a `MeterProvider` is also needed (`VDOC:568-570`). Integrations are pluggable (`registerTelemetry(...)`, per-call `integrations`, Node tracing channel) (`VDOC:292-346`).
- **Pi** ships no exporter. It has an in-memory store with `findTraces`/`findMetrics`, a SQLite store, `renderTrace()` and an **adapter conformance suite** (`PIT:11-15,287-309,310-335`).
- **LangSmith** accepts OTLP at `<endpoint>/otel` and documents collector fan-out to several backends (`LC/src/langsmith/trace-with-opentelemetry.mdx:20-58,81-86`).
- Vendor churn is real: ClickHouse acquired Langfuse in 2026 (`docs/research/agent-sdks-and-harness-design.md:119`).

## 5. The metrics that matter are outcome, reliability, cost, latency and friction

| Metric | Definition / source |
|---|---|
| pass@1 (mean reward) | τ-bench's main metric, `E[c/n]` ([arXiv 2406.12045](https://arxiv.org/abs/2406.12045), §3) |
| **pass^k** | probability that all k i.i.d. trials succeed; the unbiased estimator is `E_task[C(c,k)/C(n,k)]` with n ≥ k trials ([arXiv 2406.12045 html](https://arxiv.org/html/2406.12045), §3). gpt-4o retail: >60% pass^1 but pass^8 <25% (abstract, §5). Inspect ships this as the `pass_k_{k}` reducer (`INS/metrics.qmd:390`) |
| pass@k | `1 − E_task[C(n−c,k)/C(n,k)]` (same §3); Inspect `pass_at_{k}` (`INS/metrics.qmd:389`). Use it for tools where one success suffices, pass^k where consistency matters ([Anthropic, Jan 2026](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)) |
| **cost and tokens per task** | the harness effect that does resolve: up to **3×** cost across harnesses with the same model, tasks and prices. The gap "is set at the first call, by the preamble of system prompt and tool schemas", scaled by step count ([arXiv 2610.04433](https://arxiv.org/abs/2610.04433)). τ-bench agent cost is 95.9% input tokens ([arXiv 2406.12045 html](https://arxiv.org/html/2406.12045), cost analysis) |
| steps / model calls per run | `gen_ai.invoke_agent.inference_calls`, `tool_calls` (`SC/gen-ai-metrics.md:700,793`); mini-swe-agent `api_calls` (`MSWE/agents/default.py:164-168`) |
| latency | run duration, model duration, TTFT (`SC/client-inference.md:225`: measured from the start of the logical operation, *including* auth, failed attempts and backoff); tool duration |
| tool error rate | `execute_tool` spans with `error.type` (`SC/execute-tool.md`); Pi sets span status to error only for `provider_error`, while "Aborted stays ok" (`PIAT:101`) |
| approvals | count and wait time (`claude_code.tool.blocked_on_user`, `COBS:149`); Claude's `tool_decision` events classify user_temporary/permanent/reject (`CL:2673`) |
| exit status mix | `LimitsExceeded`, `TimeExceeded`, `FormatError` and submitted, per run (`MSWE/agents/default.py:80,110,132-145`); infra errors tracked separately (§7) |

Anthropic notes that once evals exist, "latency, token usage, cost per task, and error rates can be tracked on a static bank of tasks" ([Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)). Our fact-check already asks to make token efficiency, meaning preamble and tool-definition size, a primary metric (`docs/research/fact-check-2026-11-18.md:106`).

## 6. Cost accounting needs four token classes, a fixed "input" convention and a cost-provenance flag

- **The input-token convention differs.** OTel says `gen_ai.usage.input_tokens` "SHOULD include cached tokens", with `cache_read` a subset of it, and `output_tokens` includes reasoning (`SC/client-inference.md:235,245,263`). Vercel follows that: `inputTokens.total = input + cacheWrite + cacheRead` (`docs/research/agent-sdk/notes/provider-abstraction.md:89`; `VOT:1214-1219`). Pi's `input` is "Uncached input tokens" (`PIAT` span attributes; `pi-ai/dist/types.d.ts:292-305`). Anthropic's raw `input_tokens` also excludes cache. A summed dashboard that mixes the two conventions double-counts or under-counts cache tokens.
- **Cache writes have two prices.** Claude splits `cacheCreationEphemeral5mInputTokens` and `…1hInputTokens` and prices each at its own rate (`CL:1568-1577`). Pi records `cacheWrite1h ⊂ cacheWrite` (`pi-ai/dist/types.d.ts:297`). Anthropic charges 1.25× base input for 5-minute writes, 2× for 1-hour writes and 0.1× for reads (`provider-abstraction.md:73`). τ-bench's 95.9% input share shows that cache hit rate drives the bill.
- **Every figure is an estimate unless the provider bills it.** Claude's `total_cost_usd` and `costUSD` are "client-side estimates, not authoritative billing data… Don't bill end users" (`CCOST:17-25`). `costBasis: 'list'|'managed'|'unknown'` records the price table used (`CL:1591-1593`). Pi's `cost.totalFromProvider` marks a provider-billed total (`pi-ai/dist/types.d.ts:315-318`). mini-swe-agent prices through litellm and **raises** when the cost is ≤ 0 or the model is unregistered, unless `cost_tracking: ignore_errors` (`MSWE/models/litellm_model.py:108-126`).
- **Aggregation traps.** Claude's top-level `usage` covers the main loop only, and the docs say to use `modelUsage` (`CL:6238-6244`). Parallel tool calls repeat one message id with identical usage, so totals must deduplicate by id. Per-step `output_tokens` is a placeholder (`CCOST:48,146-150`). `total_cost_usd` is cumulative across turns, so read the latest value and never sum (`CL:6234`). OpenAI attributes usage from failed retry attempts as well (`provider-abstraction.md:86`).
- **Budgets act after the fact.** Claude's `maxBudgetUsd` stops only after the response that crosses it (`docs/reference/claude-agent-sdk/guide.md:243`). mini-swe-agent stops "after exceeding (!)" `cost_limit` (default $3, with `step_limit: 250` on SWE-bench) (`MSWE/agents/default.py:26-29,132`; `MSWE/config/benchmarks/swebench.yaml:112-113`). Inspect checks cost limits at each `generate()` (`INS/_cost_limits.md:1`).

## 7. Eval design: tasks from real failures, outcome graders, clean trials, held-fixed comparisons

Anthropic's guidance ([Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), Jan 9, 2026):
- **Tasks.** "20-50 simple tasks drawn from real failures is a great start". Early changes have large effects, so small samples suffice, and mature agents need more. A good task is one where "two domain experts would independently reach the same pass/fail verdict". Suites must be balanced, testing where a behavior should *and* should not occur.
- **Graders.** Use code-based graders where possible, model-based graders where necessary (calibrated against humans, with an "Unknown" way out), human graders judiciously, and partial credit for multi-part tasks. Graders must resist hacks. Grading bugs are common: Opus 4.5 went from 42% to 95% on CORE-Bench once grading and scaffold bugs were fixed. "You won't know if your graders are working well unless you read the transcripts."
- **Suites.** Capability evals start low. Regression evals sit near 100%, and saturated capability tasks "graduate" into the regression suite.
- **Isolation.** Each trial should start "from a clean environment". In one case Claude gained an unfair advantage "by examining the git history from previous trials".
- **Layers.** Combine automated evals, production monitoring, A/B tests, user feedback and transcript review (the "Swiss Cheese Model").

The baseline and the comparison design:
- **mini-swe-agent is a cheap, neutral baseline with a reusable output format.** A linear loop with bash only, per-instance Docker images (`MSWE/run/benchmarks/swebench.py:68-95`), a trajectory JSON with `instance_cost`, `api_calls`, `exit_status` and `trajectory_format: "mini-swe-agent-1.1"` (`MSWE/agents/default.py:159-180`), and a `preds.json` keyed by `instance_id` (`swebench.py:97-110`). Grading happens outside the agent, through `sb-cli submit` or `swebench.harness.run_evaluation` (`docs/usage/swebench.md:108-135`). It ships a `DeterministicModel` for offline runs (`MSWE/models/test_models.py:90-115`).
- **Hold the model fixed to measure the harness, and the harness fixed to measure the model.** Harness choice moved Pass@1 by 27.4 points on Claw-SWE-Bench (arXiv 2606.12344, as cited in the introduction of [arXiv 2610.04433](https://arxiv.org/html/2610.04433); `docs/research/agent-sdks-and-harness-design.md:7`), but among mature harnesses swapping "flips as many tasks as rerunning the same harness, 13% in both cases" ([arXiv 2610.04433](https://arxiv.org/abs/2610.04433), abstract).
- **Sample size.** "45 tasks catch a 13-point gap only half the time… 447 tasks resolve 5 points" ([arXiv 2610.04433](https://arxiv.org/abs/2610.04433)). Treat leaderboard gaps below 3 points with skepticism until configurations match. Naive binomial CIs already span 1-2 points ([Anthropic, infrastructure noise](https://www.anthropic.com/engineering/infrastructure-noise)). Inspect provides `ci_wilson()` for binary scores and clustered standard errors (`INS/metrics.qmd:62-64,206`).
- **Infrastructure is a variable.** On Terminal-Bench 2.0, infra errors fell from 5.8% (strict limits) to 0.5% (uncapped), and success rose +6 points. Specify both the guaranteed allocation and the kill limit per task ([infrastructure noise](https://www.anthropic.com/engineering/infrastructure-noise)). Record infra failures as their own exit status and keep them out of the agent's score.
- **Public benchmarks decay.** OpenAI stopped reporting SWE-bench Verified (Feb 23, 2026). An audit of 27.6% of the set found at least 59.4% of audited problems with flawed tests, and frontier models could reproduce gold patches (secondary: search summary; openai.com still returned 403 on 2026-11-18, and developers.openai.com does not carry the post; [OpenAI](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/), [aiweekly](https://aiweekly.co/alerts/openai-drops-swe-bench-verified-backs-pro-after-flaw-audit)). A later blog claims OpenAI also retracted its SWE-bench Pro recommendation. That claim is unverified (secondary, [Vaughan](https://codex.danielvaughan.com/2026/07/31/swe-bench-reliability-crisis-paichecker-change2task-codex-cli-evaluation-benchmark-vacuum/)). Our own suite of real failures is therefore the durable asset.
- **Inspect runs an unmodified harness.** `sandbox_agent_bridge()` proxies OpenAI, Anthropic or Google API calls from inside the sandbox via localhost:13131 (`INS/agent-bridge.qmd:15,76-80`). By default it does **not** forward client generation parameters, and `forward_generation_config=True` makes them authoritative (`INS/agent-bridge.qmd:291-298`). Tools such as `web_search` run at the provider, outside the sandbox (`:129`). Epoch reducers include `pass_at_k`, `pass_k_k`, `at_least_k` and `majority` (`INS/metrics.qmd:380-392`).
- **Trajectory graders complement outcome graders.** LangChain's `agentevals` matches trajectories in `strict`, `unordered`, `subset` (no extra tools) or `superset` (required tools present) mode, or uses an LLM judge (`LC/src/oss/langchain/test/evals.mdx:34-77`). Use these for safety and scope properties. Anthropic advises grading outcomes over paths.

## 8. Offline replay checks the harness; live evals check the model; online signals close the loop

- **Offline replay** feeds a recorded, normalized session log back through a scripted model. It catches harness regressions such as orchestration drift and parsing, deterministically and for free. It cannot show that a real model still chooses well (`docs/research/agent-sdk/notes/testability.md:76-88`).
- **Live offline evals** run against real models and fixed datasets with reference outcomes, k epochs, in a sandbox. LangSmith calls these "offline evaluations" (benchmarking, regression, backtesting on historical data) (`LC/src/langsmith/evaluation-concepts.mdx:19-31`).
- **Online evals** score production runs and threads *without* reference outputs, so they rely on heuristics, safety checks and LLM judges. Issues they surface "become offline test cases" (`LC/src/langsmith/evaluation-concepts.mdx:33-42,82-84,142-156`). Anthropic lists production monitoring as "ground truth" but "reactive" and noisy ([Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
- **Production signals worth emitting as events:** stop reason and exit status, budget and step-limit hits, approval decisions and denials (Claude `tool_decision`, `CL:2673`; `COBS:235`), compaction events, retries and fallbacks, user abort or rewind, and user feedback joined to the trace by `gen_ai.conversation.id` (`SC/README.md:36-49`).

## Design implications for our harness

1. **Emit OTel `gen_ai.*` spans from the harness core, behind one internal schema module.** Use `invoke_agent {name}` per run, a turn span (OpenAI's `TurnSpan`, `OADOC:66`), a model span per call and `execute_tool {name}` with `gen_ai.tool.call.id`. Name constants in one file and stamp `semconv.genai.commit=<sha>` as a resource attribute. Evidence: Development-only status, no tags, and in-flight renames (§2), with Vercel mixing two generations of names (`VOT:154-158` vs `:251`).
2. **Use a Pi-style vendor-neutral telemetry interface with explicit parent passing, plus an OTel adapter and a no-op default.** Ship Pi's conformance-suite idea for adapters. Evidence: `PIT:73-139,310-335`. This keeps OTel optional and avoids ambient-context bugs across workers (`PIT:519`).
3. **Keep content off by default everywhere,** with three levels matching the spec: none, attributes (dev only) and external refs (`*_ref`, production). Gate tool arguments and outputs separately from prompts, as Claude does. Evidence: `SC/gen-ai-spans.md:466-500`; Vercel and OpenAI default content on (§3).
4. **Split approval wait from execution in tool spans,** and emit an approval-decision event. Evidence: `COBS:149`; approvals are a product metric.
5. **No default remote exporter.** OTLP only, configured explicitly, with export errors surfaced and a flush on shutdown. Telemetry stays off under test. Evidence: OpenAI's import-time exporter and ZDR gap (`agents/dist/index.mjs:5`; `OADOC:21`); Claude's silent drops (`COBS:110,121`).
6. **Store usage and cost on every assistant event in the session log, and make telemetry a projection of it.** Record four input classes (uncached, cache read, cache write 5 m, cache write 1 h), output and reasoning ⊂ output, and `cost {total, source: provider|catalog|unknown, priceTableVersion}`. Document that our OTel `input_tokens` *includes* cache, per the spec. Evidence: §6; `provider-abstraction.md:115`.
7. **Make budgets pre-emptive where possible.** Before each call, estimate the worst-case cost from input tokens and `max_tokens`, and stop before crossing the cap. Evidence: Claude and mini-swe-agent both overshoot by one response (§6).
8. **Build the eval runner around Inspect rather than writing our own.** Expose a base-URL-overridable gateway and a JSONL/CLI mode so that `sandbox_agent_bridge()` can drive the unmodified harness. Report `mean`, `pass_k_k` and `pass_at_k` with Wilson CIs, and set `forward_generation_config` deliberately. Evidence: §7 Inspect bullets; `testability.md:99`.
9. **Every eval report shows pass rate *and* cost, tokens, steps and preamble size per task,** next to a mini-swe-agent run with the same model, tasks, price list and resource limits. Emit trajectories in a format convertible to `mini-swe-agent-1.1`. Evidence: 3× cost spread decided by the preamble ([arXiv 2610.04433](https://arxiv.org/abs/2610.04433)); `fact-check-2026-11-18.md:106`.
10. **Size suites to the claim.** Use 20-50 real-failure tasks with k ≥ 3 trials to catch large regressions. Claim a harness improvement under about 10 points only with a few hundred tasks, a rerun calibration of same-config discordance, or clustered/paired statistics. Evidence: Anthropic; 45 vs 447 tasks (§7).
11. **One clean sandbox per trial, with resources pinned as both a guarantee and a limit, and infra failures scored separately.** Evidence: git-history leakage and the +6-point resource swing (§7).
12. **Three suites:** offline replay of recorded logs on every commit, a live regression suite near 100% on each harness or model change, and a capability suite that starts low. Graduate saturated tasks, and feed production failures, found through online signals, back into the capability suite. Evidence: §7-§8.

## Unresolved gaps

- openai.com still returns 403 to this session (re-tried 2026-11-18), so the SWE-bench Verified audit figures come from a search summary. They differ in framing from the main report's "59.4% of 138" (`docs/research/agent-sdks-and-harness-design.md:119`), and neither is checked against the primary page.
- I read the OTel conventions at `main` HEAD `d28355d` only. I did not find a stability-transition mechanism (`OTEL_SEMCONV_STABILITY_OPT_IN` does not appear in the fetched GenAI files) or a GenAI cost attribute proposal.
- I did not read the Claude Code Monitoring reference (code.claude.com) for metric names, so the cost and token counter names are unchecked.
- No runnable example in `verify/` exercises any SDK's telemetry. All claims here come from code or docs, and none is **[verified]**.
- The 2610.04433 figures come from the arXiv abstract. I did not read the paper body for its estimator or discordance model.
- LangSmith and agentevals were read from docs only; their TS APIs were not type-checked.
