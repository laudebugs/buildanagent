# Observability and Evaluation for AI Agents and Agent Harnesses (as of Nov 2026)

Note on access: inspect.aisi.org.uk and arxiv.org could not be reached from this session (DNS blocked by the network allowlist), so I did not read them. Inspect findings come from the inspect_ai GitHub repo docs source and search snippets. Claw-SWE-Bench (arXiv 2606.12344) findings come from abstract and aggregator snippets, not the full paper. (Re-verification R1, November 2026: the Claw-SWE-Bench and Terminal-Bench marks the main report relies on were re-checked; results are inline, marked "R1", and logged in [fact-check-2026-11-18.md](../fact-check-2026-11-18.md#re-verification-against-primary-sources-r1).) I did not fetch the intelligentmachines.blog and parse.gl seed URLs either. No seed links were marked suspicious.

## What do the OTel GenAI agent span conventions specify (create_agent, invoke_agent, execute_tool, etc.) and how stable are they?

### Takeaway
The GenAI conventions now live in a separate repo, `open-telemetry/semantic-conventions-genai`. They define `create_agent`, `invoke_agent` (CLIENT and INTERNAL variants), `invoke_workflow`, `plan` and `execute_tool` spans under the `gen_ai.*` namespace. Every agent, tool and span item is still at **Development** status, not Stable. Only borrowed attributes such as `error.type`, `server.address` and `server.port` are Stable, so names can still change.

### Cited Findings
- **create_agent span:** the name SHOULD be `create_agent {gen_ai.agent.name}` and the kind SHOULD be `CLIENT`. — [semconv-genai agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
  - Required: `gen_ai.operation.name`, `gen_ai.provider.name`.
  - Conditionally required: `error.type`, `gen_ai.agent.description`, `gen_ai.agent.id`, `gen_ai.agent.name`, `gen_ai.agent.version`, `gen_ai.request.model`, `server.port`.
  - Recommended: `server.address`.
- **Invoke-agent (internal) span:** `gen_ai.operation.name` is `invoke_agent`, `invoke_workflow` or `invoke_{framework_entrypoint}`. The name is `{gen_ai.operation.name} {gen_ai.agent.name}` and the kind is `INTERNAL`. — [same](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
  - Required: `gen_ai.operation.name`.
  - Conditionally required: `error.type`, `gen_ai.agent.description`, `gen_ai.agent.name`, `gen_ai.conversation.id`, `gen_ai.data_source.id`, `gen_ai.output.type`.
  - Recommended: `gen_ai.request.*`, `gen_ai.response.finish_reasons`, and `gen_ai.usage.input_tokens`/`output_tokens`.
  - The client-side invoke_agent span is defined in a separate `client-invoke-agent.md`.
- **plan span:** the name is `plan {gen_ai.agent.name}` and the kind is INTERNAL. It requires `gen_ai.operation.name`. — [same](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- **Attributes needed at span start:** sampling-relevant attributes SHOULD be set at span creation time. For create_agent these are agent.name, operation.name, provider.name, request.model and server.address/port. — [same](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- **Opt-In content attributes:** `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions` and `gen_ai.tool.definitions` (plus `_ref` variants) are Opt-In. They are not captured by default for privacy reasons. — [same](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- **Stability:** the spans, `gen_ai.agent.*`, `gen_ai.provider.name` and the `gen_ai.invoke_agent.exception` event are all marked Development. `error.type`, `server.address` and `server.port` are Stable. — [same](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- **execute_tool span:** the name is `execute_tool {gen_ai.tool.name}`, the kind is INTERNAL and the status is Development. — [semconv-genai execute-tool](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/execute-tool.md)
  - Required: `gen_ai.operation.name`, `gen_ai.tool.name`.
  - Conditionally required: `error.type`, `gen_ai.agent.name`, `gen_ai.conversation.id` ("Don't invent a fallback value") and `gen_ai.tool.call.id` (only if the provider supplied one).
  - Recommended: `gen_ai.tool.description` and `gen_ai.tool.type`, which is `function` (client-side), `extension` (agent-side) or `datastore`.
  - Opt-In (sensitive): `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result`.
  - Event: `gen_ai.execute_tool.exception`.
  - Metric: `gen_ai.execute_tool.duration` is mentioned (I did not read that section).
- **Specialized execute_tool refinements (Development):**
  - Agent-as-a-tool adds `gen_ai.transfer.mode` and `gen_ai.transfer.target.name`, with no extra spans.
  - Load skill / read skill resource adds `gen_ai.skill.name` and `gen_ai.skill.source.uri`.
  - Command execution adds `process.executable.name`, `process.executable.path` and `process.exit.code`.
  - "MCP tool executions may also be traced by the corresponding MCP instrumentation", linking to the MCP client conventions.
  - Source: [semconv-genai execute-tool](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/execute-tool.md)
- **Earlier version in the main repo:** in semantic-conventions v1.41.0, execute_tool had the same name and kind, and `gen_ai.tool.name` was Required. — [semantic-conventions v1.41.0 gen-ai-spans](https://github.com/open-telemetry/semantic-conventions/blob/v1.41.0/docs/gen-ai/gen-ai-spans.md)
  - One secondary source says v1.41 split invoke_agent into CLIENT and INTERNAL. — [search summary of Greptime / Morph blogs](https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions)
- **Repo status:** secondary sources say the GenAI conventions moved to the separate semconv-genai repo, which has no tagged/versioned release ("living specification"). A July 2026 source says no GenAI span, event, metric or attribute is Stable. — [AuroraSRE](https://www.aurorasre.ai/blog/opentelemetry-ai-agent-observability), [hidekazu-konishi guide](https://hidekazu-konishi.com/entry/opentelemetry_genai_semantic_conventions_guide.html)
  - The repo main branch showed 162 open issues and 78 PRs when I fetched it. — [semconv-genai](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/execute-tool.md)
- **Backend support for gen_ai.* varies, and secondary sources conflict.** — [Langfuse/LangSmith/Phoenix/Braintrust comparison (dev.to)](https://dev.to/gabrielanhaia/langfuse-vs-langsmith-vs-phoenix-vs-braintrust-the-honest-2026-comparison-253p), [Last9](https://last9.io/blog/best-ai-observability-tools-2026), [Morph](https://www.morphllm.com/ai-agent-observability-tools)
  - One guide says Langfuse, LangSmith, Phoenix and Braintrust all ingest gen_ai.* natively.
  - Another rates LangSmith "Partial" and Braintrust "No".
  - Phoenix is built on OTel plus Arize's **OpenInference** conventions.
  - OpenLLMetry (Traceloop) historically used its own `traceloop.*`/`llm.*` namespace. Some instrumentations dual-emit, and this varies per package.
- **Vendor consolidation in 2026:**
  - Langfuse: ClickHouse announced the acquisition on Jan 16, 2026 and confirmed it complete by May 22, 2026. — [ClickHouse blog](https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability), [InfoWorld](https://www.infoworld.com/article/4118621/clickhouse-buys-langfuse-as-data-platforms-race-to-own-the-ai-feedback-loop.html)
  - Traceloop/OpenLLMetry: reportedly acquired by ServiceNow, completed May 5, 2026. The price of about $80M is unconfirmed. — [developersdigest](https://www.developersdigest.tech/blog/llm-observability-acquisitions-2026), [hackernoon](https://hackernoon.com/two-acquisitions-deep-two-still-standing-whats-really-happening-to-open-source-llm-observability)
  - Arize: reportedly acquired by Dynatrace (announced Aug 13, closed Oct 1, reportedly $915M), with Phoenix and AX to be maintained. This is secondary only; I did not see a press release. — [Last9 / comparison search summary](https://last9.io/blog/best-ai-observability-tools-2026), [Morph](https://www.morphllm.com/ai-agent-observability-tools)

### Inferences
- **Span layout for a custom harness:**
  - One `invoke_agent` INTERNAL span per agent run, which becomes the root for evals and replay.
  - Child chat/inference spans per model call.
  - `execute_tool {name}` child spans with `gen_ai.tool.call.id` so tool calls link back to the model output that requested them.
  - `create_agent` only when an agent is provisioned remotely.
  - Subagents as nested invoke_agent spans, or execute_tool with transfer attributes.
  - Shell tools should add the `process.*` attributes, and skills the `gen_ai.skill.*` attributes.
- **Pinning:** because everything is Development, teams should pin the convention version or commit they implement. They should keep a thin mapping layer (their own attribute constants), and expect renames such as the earlier `gen_ai.system` to `gen_ai.provider.name` change.
- **Content capture:** turn it on (Opt-In) for offline eval and debugging environments, and keep it off or redacted in production.
- **Lock-in:** acquisitions make emitting standard OTLP plus gen_ai.* the main hedge against vendor lock-in.

### Gaps
- I did not read the exact current text of `client-invoke-agent.md` or the GenAI metrics doc.
- I could not confirm whether `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` is still the recommended transition flag. It was not mentioned on the pages I fetched.
- No tagged release date or stabilization timeline for semconv-genai was found.
- Per-vendor gen_ai.* support claims conflict and were not verified against vendor docs.

## How does Inspect AI support evaluating custom agents/harnesses (agent bridge, sandboxing)?

### Takeaway
Inspect AI (UK AISI) has three ways to evaluate a custom harness:
- Wrap it as an Inspect agent via the in-process `agent_bridge()`.
- Run it unmodified, in any language, inside a sandbox via `sandbox_agent_bridge()`. A localhost proxy routes its model API calls to the eval's model and records everything in Inspect transcripts.
- Use `inspect_swe`, which packages Claude Code and Codex CLI this way.

Sandboxes are Docker by default. Kubernetes, Daytona, Modal and EC2 are available through extensions.

### Cited Findings
- **`agent_bridge()` (in-process):**
  - Your code wraps the run in `async with agent_bridge(state) as bridge:`. It supports agents written against "Python APIs for OpenAI Completions, OpenAI Responses, Anthropic, and Google". The agent sets `model="inspect"` so calls are intercepted to the evaluated model.
  - Warning: it "runs the agent and its tools in the Inspect process, with access to the host's network and files". It should not be used with adversarial models.
  - Source: [inspect_ai docs/agent-bridge.qmd](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/docs/agent-bridge.qmd)
- **`sandbox_agent_bridge()`:** — [same](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/docs/agent-bridge.qmd)
  - The agent runs inside the sandbox in any language, with its API base URL pointed at localhost port 13131. The proxy relays to the current Inspect model provider.
  - The wrapper reads `bridge.port`, runs the agent with `sandbox().exec()` and returns `bridge.state`.
  - By default it withholds provider-executed tools such as `web_search` and `code_execution`, and drops most client headers unless they are listed in `forward_client_headers`.
  - Inspect tools can be exposed to the sandboxed agent as MCP tools via `BridgedToolsSpec`.
- **Model routing and configuration in the bridge:** — [same](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/docs/agent-bridge.qmd)
  - `"inspect"` routes to the eval model, and `inspect/<provider>/<model>` routes to other models.
  - `model_aliases` and `model_resolver` remap names in the sandbox; unmatched names fall back to the eval model with a warning.
  - Generation params (max_tokens, temperature) are NOT forwarded unless `forward_generation_config=True`.
  - Tool approval policies apply to bridged tool calls.
  - Transcripts record all model calls and bridged tools. Tools the agent runs itself are visible only via the model calls it reports.
- **Documented bridge examples:** OpenAI Agents SDK, Pydantic AI and LangChain. Claude Code and Codex CLI run via the Inspect SWE package. — [same](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/docs/agent-bridge.qmd)
- **`inspect_swe`:** it exposes Claude Code and Codex CLI as standard Inspect agents (e.g. `claude_code()` as a solver with a scorer and `sandbox="docker"`), built on `sandbox_agent_bridge()`. It is maintained under meridianlabs-ai, and PyPI versions in the 0.2.5x–0.2.6x range were seen. — [Inspect SWE docs](https://meridianlabs-ai.github.io/inspect_swe), [PyPI inspect-swe](https://pypi.org/project/inspect-swe/0.2.62/)
- **Sandboxing:** sandboxes cover tools, agents and scorers. Docker is built in, and an extension API adds others. Built-in bash/python tools require a sandbox, which can be set at sample, task or eval level. — [Inspect sandboxing (search snippet)](https://inspect.aisi.org.uk/sandboxing.html)
  - Kubernetes: `inspect-k8s-sandbox` (AISI, v0.4.0, Mar 2026). — [inspect-k8s-sandbox](https://simple-repository.app.cern.ch/project/inspect-k8s-sandbox)
  - Daytona and other providers: the `inspect_sandboxes` collection. — [Inspect Sandboxes](https://meridianlabs-ai.github.io/inspect_sandboxes/)
- **Core agent loop:** the built-in `react()` agent implements the reason → tool call → observe loop. Task accepts it directly as a solver, and scorers such as `includes()` grade submissions. — [Inspect tutorial (search snippet)](https://inspect.aisi.org.uk/tutorial.html)
- **inspect_evals:** ready-made benchmark implementations, e.g. SWE-bench Verified with `sandbox_type` docker (default) or k8s. — [inspect_evals SWE-bench](https://ukgovernmentbeis.github.io/inspect_evals/evals/coding/swe_bench)
- **R port:** the R `vitals` package mirrors Inspect and bridges `claude_code()`/`codex()` solvers to inspect_swe. — [vitals agent solvers](https://vitals.tidyverse.org/reference/agent_solvers.html)

### Inferences
- **Recommended path for a custom harness:** package the harness CLI in a Docker image and point its model base URL to the bridge port. Wrap it in a small Inspect `@agent` using `sandbox_agent_bridge()`, then pair it with existing `inspect_evals` tasks (SWE-bench, GAIA, etc.). This tests the real harness binary rather than a reimplementation, and it gets transcripts, model swapping and approval policies for free.
- **Transcript blind spot:** tools the harness runs internally are not visible to Inspect except through model messages. Teams should also emit OTel spans from the harness to get a full trajectory.
- **Watch generation defaults:** the non-forwarding of generation config means harness-set temperature and max_tokens are ignored by default. That can silently change behavior versus production.

### Gaps
- I could not read inspect.aisi.org.uk (network blocked), so details on scorers are thin: model_graded_qa/fact, multi-scorer, epochs and reducers for pass^k-style aggregation.
- Not covered: the Inspect View log viewer, "human agent" baselining, and the current inspect_ai version number.

## How should a team build an eval suite for its own harness (offline benchmarks vs. online monitoring)?

### Takeaway
Start small with 20–50 tasks taken from real failures. Use code-based graders where possible, LLM judges calibrated against humans where not, and human review for calibration. Run multiple trials and report both pass@k and pass^k. Keep capability evals separate from regression evals. Layer offline evals (every commit) with production monitoring and A/B tests, because "no single evaluation layer catches every issue". Always read transcripts.

### Cited Findings
- **Vocabulary (Anthropic, "Demystifying evals for AI agents", Jan 9, 2026):** — [Anthropic post (GitHub mirror)](https://github.com/sullivan-street-projects/anthropic-docs-local/blob/master/engineering/demystifying-evals-for-ai-agents.md); original at [anthropic.com/engineering](https://anthropic.com/engineering/demystifying-evals-for-ai-agents)
  - Task: an input plus success criteria.
  - Trial: one attempt; multiple trials handle nondeterminism.
  - Grader: scoring logic; a task can have several.
  - Transcript: the full record of outputs, tool calls and reasoning.
  - Outcome: the final environment state.
  - Harness: the end-to-end eval infrastructure.
- **Metrics:** "pass@k measures the likelihood that an agent gets at least one correct solution in k attempts". pass^k "measures the probability that all k trials succeed" and is the right measure for customer-facing consistency. Example: 75% per-trial success gives about 42% pass^3. — [same](https://github.com/sullivan-street-projects/anthropic-docs-local/blob/master/engineering/demystifying-evals-for-ai-agents.md)
- **Capability vs. regression evals:** capability evals start at low pass rates. Regression evals target near-100%, and mature capability tasks "graduate" into the regression suite. — [same](https://github.com/sullivan-street-projects/anthropic-docs-local/blob/master/engineering/demystifying-evals-for-ai-agents.md)
- **Roadmap advice from the same post:** — [same](https://github.com/sullivan-street-projects/anthropic-docs-local/blob/master/engineering/demystifying-evals-for-ai-agents.md)
  - "20-50 simple tasks drawn from real failures is a great start."
  - Balance positive and negative cases ("One-sided evals create one-sided optimization").
  - "A good task is one where two domain experts would independently reach the same pass/fail verdict."
  - Make the eval agent behave like production, and isolate trials with clean starts.
  - Grade outputs, not paths: avoid brittle exact tool-sequence checks.
  - Read transcripts.
  - Watch saturation: SWE-bench Verified went from about 30% to over 80%.
  - "We do not take eval scores at face value until someone digs into the details of the eval and reads some transcripts."
- **Graders:** — [same](https://github.com/sullivan-street-projects/anthropic-docs-local/blob/master/engineering/demystifying-evals-for-ai-agents.md); [secondary summary](https://gist.github.com/pebeto/76c1e61120cb27445d53a00459db5fc8)
  - Three types: code-based (fast, cheap, brittle), model-based (flexible, nondeterministic, "requires human calibration") and human (gold standard, expensive).
  - LLM rubrics for research agents "should be frequently calibrated against expert human judgment."
  - Per a secondary summary, a 0% pass rate across many trials usually signals a broken task.
- **Grading by agent type:** coding agents use deterministic tests; conversational agents use end-state plus transcript constraints; research agents use groundedness checks; computer-use agents use sandbox state verification. — [secondary summary](https://gist.github.com/AnthonyAlcaraz/2f7390a78f6d05beba0c109b1a039523)
- **Offline vs. online:** automated evals are fast and reproducible on every commit but can give false confidence. Production monitoring shows real behavior but is reactive. A/B tests measure real outcomes but are slow. Combine all three. — [Anthropic post mirror](https://github.com/sullivan-street-projects/anthropic-docs-local/blob/master/engineering/demystifying-evals-for-ai-agents.md)
- **Tooling:** — [jacar.es DeepEval](https://jacar.es/en/deepeval-evaluating-agents/), [aitoolsatlas comparison](https://aitoolsatlas.ai/compare/promptfoo-vs-deepeval)
  - DeepEval agent metrics: ToolCorrectness (expected vs. actual tools, with an optional `should_consider_ordering=True`), TaskCompletion, argument correctness and step efficiency.
  - DeepEval is a Python/pytest-style tool; promptfoo is declarative YAML with strengths in model-matrix comparison and red-teaming (`promptfoo redteam run`).
- **Measuring reliability:** tau-bench popularized pass^k for tool-agent-user interaction (customer-service domains). tau2-bench adds "dual control", where the simulated user also acts on a shared environment. — [Arize: what is tau-bench](https://arize.com/?p=33410), [prefactor](https://prefactor.tech/learn/agent-benchmarks)
  - Scores from different releases should not be compared directly.
  - If the user simulator is stochastic, variance conflates agent and simulator inconsistency.
  - Empirical pass^k is often below (pass^1)^k, which points to correlated failures.

### Inferences
- **Suggested layering for a harness team:**
  - **Per-commit:** a regression suite of about 50 tasks (deterministic graders), run in sandboxes with k≥3 trials, reporting pass^k plus cost/tokens/latency per task.
  - **Nightly/weekly:** a capability suite plus a public benchmark subset, run through Inspect (bridge) or Harbor, with pinned resource specs.
  - **Online:** OTel gen_ai traces into a backend (Langfuse/Phoenix/etc.). LLM-judge scoring of sampled production traces, and new failures fed back into the offline task set.
  - **Trajectory checks:** use them for safety and efficiency properties (no forbidden tools, bounded steps), and avoid exact-path matching for correctness.
- **Harness changes are model changes:** A/B the harness itself (prompt, tool set, context management) holding the model fixed, since harness effects are large (see below).

### Gaps
- I did not read the intelligentmachines.blog guide or the parse.gl topic page (I avoided more fetches after the network blocks), so their specific recommendations are not included.
- Primary docs for promptfoo's agent/trajectory assertions and Braintrust/LangSmith online-eval features were not verified.

## What are known pitfalls (contamination, flaky environments, harness effects on scores)?

### Takeaway
Agentic benchmark scores are confounded by four things: contamination and broken tasks, the harness/scaffold, infrastructure resources, and benchmark version. Recent evidence from 2026:
- OpenAI dropped SWE-bench Verified (contamination; 59.4% of audited hard tasks flawed) and later reportedly retracted its SWE-bench Pro recommendation.
- On Terminal-Bench 2.0, resource configuration alone moved scores by 6 points.
- Harness choice moves the same model's score by 15–55 points (Terminal-Bench, Claw-SWE-Bench).

Trustworthy third-party evals must pin and publish the harness, resources, trial counts and versions.

### Cited Findings
- **OpenAI drops SWE-bench Verified:** on Feb 23, 2026, OpenAI stopped reporting it, saying it is increasingly contaminated. It recommended SWE-bench Pro instead. — [OpenAI: why we no longer evaluate SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)
  - An audit of 138 of the hardest tasks found 59.4% had material flaws in tests or problem descriptions. — [same](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/) (R1: still unverified; openai.com returns 403 to the research environment and no OpenAI-hosted copy was found on developers.openai.com; third-party GitHub mirrors are not primary.)
  - Context: Verified was itself a 500-task human-validated subset that OpenAI introduced in 2024 ([introducing SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/); I did not fetch this page).
- **SWE-bench Pro reversal (secondary only; R1: still unverified, primary is on openai.com, which returns 403):** tech-insider reports that on July 8, 2026 OpenAI said Pro no longer "reliably measures frontier coding capability" and retracted its recommendation. AIWeekly ties this to a May 2026 Datacurve audit, which reportedly found Pro graders mis-graded about one third of trials. The primary OpenAI source was not seen. — [tech-insider](https://tech-insider.org/ie/openai-swe-bench-pro-retraction-2026/), [AIWeekly](https://aiweekly.co/alerts/openai-drops-swe-bench-verified-backs-pro-after-flaw-audit)
- **Infrastructure noise (Anthropic, Feb 2026, "Quantifying infrastructure noise in agentic coding evals"):** — [Anthropic engineering](https://www.anthropic.com/engineering/infrastructure-noise) (via secondary summaries: [Gigazine](https://gigazine.net/gsc_news/en/20260206-quantifying-infrastructure-noise-agentic-coding), [ZenML](https://www.zenml.io/llmops-database/infrastructure-noise-in-agentic-coding-evaluations))
  - On Terminal-Bench 2.0, the gap between the most constrained and most generous pod resources was 6 points (p<0.01), with the same model, tasks and harness.
  - The cause is that GKE treated task specs as both floor and ceiling, so containers were OOM-killed.
  - A 3x headroom ceiling cut infra error rates from 5.8% to 2.1% with no significant score lift (p=0.40).
  - Anthropic recommends that maintainers publish resource specs.
  - The "distrust gaps under 3 points" heuristic comes from a blogger, not Anthropic.
- **Harness effects on Terminal-Bench 2.0:** — [Daniel Vaughan blog](https://codex.danielvaughan.com/2026/04/09/harness-performance-terminal-bench/), [Codesota](https://www.codesota.com/benchmark/terminal-bench)
  - Claude Opus 4.6 is reported at 58.0% in Claude Code vs. 74.7% in Terminus-KIRA (secondary; not checked against tbench.ai). (R1: partly corroborated. The official submission's [`result.json`](https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard/tree/main/submissions/terminal-bench/2.0/Terminus-KIRA__Claude-Opus-4.6) records a 74.4% mean over 442 trials for Terminus-KIRA + Opus 4.6. The Claude Code + Opus 4.6 58.0% is still unverified: the current [tbench.ai leaderboard](https://www.tbench.ai/leaderboard/terminal-bench/2.0) lists no Opus 4.6 entry, and the submissions dataset has no Claude Code + Opus 4.6 folder.)
  - Harness engineering moves the same model 20+ points.
  - Scores depend on version (2.0 vs. the cleaned 2.1), scaffold, subset and date.
  - The original paper picked each model's best scaffold, but notes that stronger models usually helped more than switching scaffolds. — [Terminal-Bench paper](https://arxiv.org/html/2601.11868v1)
  - Official runs use Harbor (the official harness, with Terminus 2 as default scaffold), 5 trials per task and no timeout or resource overrides. — [survey arXiv 2606.20683](https://arxiv.org/pdf/2606.20683)
- **Claw-SWE-Bench (arXiv 2606.12344, June 10, 2026):** — [HF papers](https://huggingface.co/papers/2606.12344), [opentrain summary](https://www.opentrain.ai/papers/claw-swe-bench-a-benchmark-for-evaluating-openclaw-style-agent-harnesses-on-codi--arxiv-2606.12344/), [arXiv PDF](https://arxiv.org/pdf/2606.12344) (not readable here)
  - It benchmarks OpenClaw-style agent harnesses ("claws") with an adapter protocol that fixes prompt, runtime budget, workspace contract and patch extraction.
  - The full set has 350 instances across 8 languages and 43 repos (from SWE-bench-Multilingual and SWE-bench-Verified-Mini, after future-commit cleanup). Lite has 80 instances, meant for screening and regression.
  - Same GLM 5.1 backbone: a minimal direct-diff adapter scored 19.1% Pass@1, while the full adapter scored 73.4%. **R1 correction:** those are v1 abstract figures; [v2](https://arxiv.org/abs/2606.12344) (Sept 28, 2026) reports 19.3% vs 71.2% (Table 1, mean of three runs) and a harness gap of up to 24.3 pts with the model fixed (§6.2).
  - Cost is treated as a primary axis.
  - Code and data: GitHub opensquilla/claw-swe-bench, HF TokenRhythm/Claw-SWE-Bench.
- **Single-run reporting:** GAIA, SWE-bench, WebArena and TheAgentCompany mostly report single-trial accuracy or pass@k, not reliability. — [channel.tel](https://www.channel.tel/blog/ai-agent-evaluation-benchmarks-predict-production)
  - One source says the best agents fall below 25% on tau-bench when all 8 runs must succeed. Single-trial retail figures conflict across secondary sources (about 61% for GPT-4o vs. under 50% for the best models), so verify against Yao et al. 2024. — [prefactor](https://prefactor.tech/learn/agent-benchmarks), [Arize](https://arize.com/?p=33410)
- **Saturation:** SWE-bench Verified went from about 30% to over 80%, which limits its signal. — [Anthropic evals post mirror](https://github.com/sullivan-street-projects/anthropic-docs-local/blob/master/engineering/demystifying-evals-for-ai-agents.md)

### Inferences
- **Practices for trustworthy (third-party) evals, synthesized from the above:**
  - Publish the exact harness/scaffold, version and adapter.
  - Publish the resource specs (CPU, memory, timeouts, ceiling policy).
  - Publish the number of trials and both pass@1 and pass^k with confidence intervals.
  - Publish the benchmark version and task subset, and any excluded tasks.
  - Publish cost and tokens.
  - Separate infra errors from agent failures.
  - Release transcripts.
  - Prefer fresh or held-out tasks (future-commit cleanup, post-cutoff repos) to limit contamination.
  - Audit tasks for broken tests: a 0% pass rate across many trials is a red flag.
- **Leaderboards measure model+harness:** gaps of a few points between entries with different harnesses or infra are not meaningful. For one's own harness, the relevant comparison is a controlled A/B with the model fixed.

### Gaps
- No primary source was found for the SWE-bench Pro retraction or the Datacurve audit.
- The live Terminal-Bench leaderboard was not checked.
- The full Claw-SWE-Bench paper was not readable (arxiv blocked); adapter details beyond the abstract are missing.
- No specific source was found on standards bodies' third-party eval guidance (e.g. AISI or METR reporting standards).
