# How real agent harnesses are built: Cloudflare, Pi, OpenAI

Source-level notes on four production harnesses, read from shallow clones of their `main` branches on 2026-11-18. Where a claim comes from a README or docs file rather than source code, it is marked. Companion to [agent-sdks-and-harness-design.md](agent-sdks-and-harness-design.md).

| | **Pi** (`earendil-works/pi`) | **Codex CLI** (`openai/codex`) | **OpenAI Agents SDK, sandbox agents** (`openai/openai-agents-python`) | **Cloudflare Agents + Think** (`cloudflare/agents`) |
|---|---|---|---|---|
| Language | TypeScript (Node ≥ 22.19) | Rust core (`codex-rs`), with TS and Python SDKs that wrap the CLI | Python (a JS SDK exists) | TypeScript on Workers |
| License | MIT | Apache-2.0 | MIT | MIT |
| Stars (Nov 2026) | ~123k | ~136k | ~31k | ~6k |
| Philosophy | Minimal, "make it your own"; no subagents, no plan mode, no permission system | Batteries-included local coding agent with OS sandboxing and approvals | General agent library; sandbox agents add a workspace harness on top of `Runner` | Durable, per-user stateful agents on Durable Objects |
| Loop owner | `pi-agent-core` `agent-loop.ts` (~950 lines) | `codex-core` (Rust) | `run_internal/run_loop.py` | Think owns the AI SDK `streamText` call |
| Default tools | `read`, `bash`, `edit`, `write` (a read-only set swaps in `read`, `grep`, `find`, `ls`) | shell / `unified_exec`, `apply_patch`, plan, view_image, MCP, tool_search, multi-agent, request_user_input, … | filesystem, shell, `apply_patch`, skills, memory, compaction (as "capabilities") | workspace file tools, `exec` (code mode), fetch, MCP tools, client tools |
| Session store | JSONL file whose entries form a **tree** (branching, fork, clone) | Threads persisted on disk; app-server exposes `thread/start`, `thread/resume`, `thread/fork`, … | `Session` protocol: SQLite, OpenAI Conversations, Responses-compaction session; sandbox snapshots | Durable Object SQLite (`agents/sessions`) |
| Compaction | Summary entry at `contextWindow - reserveTokens` (16,384 reserved), keeps last ~20k tokens, originals kept in tree | Dedicated `compact*.rs` modules incl. remote (server-side) compaction and retained tool outputs | Compaction capability; Responses-API compaction session | `compactAfter()` between turns, plus opt-in proactive (mid-turn) and reactive (retry on overflow) recovery |
| Sandbox | **None built in**; docs recommend running the whole process in a container/VM | Built in: `SandboxPolicy` = `read-only` (default) / `workspace-write` / `danger-full-access` / `external-sandbox`; Linux uses bubblewrap + seccomp (Landlock legacy flag) | Pluggable `SandboxClient`: UnixLocal, Docker, plus Blaxel, Cloudflare, Daytona, E2B, Modal, Vercel extensions | V8 isolates; code runs in a separate dynamically loaded Worker |
| Approvals | None (OS permissions of the process) | `AskForApproval` = `on-request` (default) / `granular` / `never`, plus an internal `untrusted` that Codex derives for untrusted projects and rejects when set in config (*corrected 2026-11-18, see [fact-check row 17](fact-check-2026-11-18.md#corrections-from-the-verified-sdk-references-round-c-2026-11-18)*); exec-policy rules; an LLM "Guardian" reviewer | `needs_approval` on tools, HITL interruptions via `RunState` | `beforeToolCall` returns a `ToolCallDecision`; client-tool approvals; workflows pause/resume |
| Extension model | In-process TS extensions (tools, commands, providers, event handlers, TUI); skills; prompt templates; npm/git "Pi packages" | MCP client and server, skills, plugins, hooks, AGENTS.md | Tools, MCP, handoffs, guardrails, capabilities | Subclass hooks (`beforeTurn`, `beforeStep`, `beforeToolCall`, `afterToolCall`, `onStepFinish`, …), sub-agents over RPC, messengers |
| Interfaces | Interactive TUI, print, JSON event stream, JSONL-over-stdio RPC, in-process SDK, all on one session mechanism | TUI, `codex exec` (non-interactive), JSON-RPC app-server, SDKs that spawn the CLI and read JSONL events | Python API, streaming events, realtime/voice | WebSocket chat protocol, RPC, HTTP, messenger webhooks |

## Pi: the minimal harness

Pi is the clearest example of a harness designed around **few primitives with strong composability**.

- **Layering.** `pi-ai` is a provider-neutral streaming LLM API. `pi-agent-core` is a stateful `Agent` with a tool loop and event stream (`agent.subscribe(event => …)`). `pi-coding-agent` adds the tools, sessions, TUI and extensions. Each layer is a separate npm package, so you can take the loop without the coding agent.
- **Loop hooks** in `pi-agent-core/types.ts`: `convertToLlm`, `transformContext`, `beforeToolCall`, `afterToolCall`, and steering callbacks. Steering messages enter after the current assistant turn; follow-ups enter when the agent is idle. That steering/follow-up queue split is worth copying for any interactive harness.
- **Sessions are a tree, not a list.** Each JSONL entry has an id and a parent; the active branch is the path to the current entry. Continuing from an earlier entry creates a branch in the same file. Compaction appends a summary entry and the model context is rebuilt from it. The originals stay in the tree, so compaction is always reversible. (`docs/how-pi-works.md`, `docs/compaction.md`)
- **Compaction details.** It triggers when `contextTokens > contextWindow - reserveTokens` (default reserve 16,384). It walks back to keep about 20k recent tokens and summarizes the rest iteratively with the previous summary. Summary requests disable prompt-cache writes. A provider overflow error or an early `stopReason: "length"` triggers one compact-and-retry.
- **Security stance.** Pi "does not include a built-in permission system". Tools run with the OS permissions of the process, and the docs say the strongest practical option is to run Pi entirely inside a container or VM. *Project trust* only gates whether a folder's `.pi/settings.json`, `.pi/mcp.json`, extensions and the like load. It is explicitly not a security boundary. (`docs/security.md`)
- **One mechanism, many interfaces.** Interactive mode, print mode, JSON event mode, RPC mode and the SDK all drive the same agent and session code.

**Lesson:** a 4-tool, tree-session, hookable loop is enough for a serious coding agent. Sandboxing can live entirely outside the harness, provided you say so loudly.

## Codex CLI: the sandbox-first harness

Codex is the opposite trade-off: a large Rust core where **safety policy is a first-class part of the protocol**.

- **Two independent policies.** `SandboxPolicy` controls what a command can touch: `read-only` (the default `SandboxMode`), `workspace-write` with `writable_roots` and a `network_access` flag, `danger-full-access`, and `external-sandbox` for when Codex itself runs inside a container. `AskForApproval` controls when a human is asked: `on-request` (default, the model decides), `granular` per category, or `never`. *Corrected 2026-11-18 ([fact-check row 17](fact-check-2026-11-18.md#corrections-from-the-verified-sdk-references-round-c-2026-11-18)): the earlier text listed `untrusted` as a fourth selectable value. At commit `4389a52`, `approval_policy = "untrusted"` in config fails with "no longer supported; remove this setting", and Codex applies `UnlessTrusted` only as the derived default for a project marked untrusted (`codex-rs/core/src/config/mod.rs:249-252, 4085-4101`; `protocol/src/protocol.rs:1199-1204`).* Both are defined in `codex-rs/protocol/src/protocol.rs`.
- **Tool orchestrator.** `core/src/tools/orchestrator.rs` "coordinates tool approval, sandbox selection, and retries after sandbox denial". A command first runs sandboxed. If the sandbox denies it, the retry with escalated permissions needs a fresh approval.
- **Guardian review.** `core/src/guardian*` implements an LLM reviewer pool that assesses approval requests, so some approvals can be delegated to a model rather than a human.
- **Exec policy.** Rule files can pre-allow or forbid specific commands (`exec_policy.rs`, `docs/execpolicy.md`).
- **Linux sandbox.** `codex-rs/linux-sandbox` bundles bubblewrap plus seccomp filters and a managed TCP/DNS proxy for network policy. Landlock remains only behind a hidden `--use-legacy-landlock` flag.
- **Tool surface** (`core/src/tools/handlers`): `shell`/`unified_exec`, `apply_patch`, `plan`, `view_image`, MCP tools and resources, `tool_search`, `multi_agents` (v1 and v2), `request_user_input`, `request_permissions`, `get_context_remaining`, `new_context_window`, plus a `code_mode` host. Tools are registered and routed through `registry.rs` and `router.rs`, with parallel execution in `parallel.rs`.
- **Context.** `context_manager/` normalizes history. More than ten `compact*.rs` modules handle local and remote compaction, token budgets and retained tool outputs. AGENTS.md discovery has its own manager (`agents_md_manager.rs`).
- **Headless core, thin clients.** The JSON-RPC app-server (`thread/start`, `thread/resume`, `thread/fork`, `thread/archive`, …) serves the TUI and IDE clients. The TypeScript SDK "spawns the CLI and exchanges JSONL events over stdin/stdout", the same pattern as the Claude Agent SDK.

**Lesson:** if your agent runs untrusted commands on a user's machine, model *what may run* (sandbox) separately from *who must approve* (approval policy). Make "sandbox denied → escalate → re-approve" an explicit, testable flow.

## OpenAI Agents SDK sandbox agents: harness as library

Since 2026 the general-purpose Agents SDK ships a coding/workspace harness as an optional layer, `agents.sandbox`.

- `SandboxAgent` + `Manifest` declare the workspace: entries such as `GitRepo` and `LocalDir`, materialized into the sandbox. *Capabilities* add sandbox-native tools: filesystem, shell, `apply_patch`, skills (lazily loaded), memory and compaction. `SandboxRunConfig(client=…)` chooses where it runs. The normal `Runner` loop is unchanged. (`docs/sandbox_agents.md`, `src/agents/sandbox/`)
- **Pluggable compute.** `UnixLocalSandboxClient` and `DockerSandboxClient` are built in. Extensions add Blaxel, Cloudflare, Daytona, E2B, Modal and Vercel (`docs/sandbox/clients.md`). Snapshots and session state let a run resume on a replacement sandbox.
- **Honest warning.** On Linux, `UnixLocalSandboxClient` "adds no OS-level confinement". On macOS it uses `sandbox-exec` for files but provides no network isolation, so untrusted work needs Docker or a hosted client.
- **Loop internals** are split into small modules under `run_internal/`: `run_loop.py`, `turn_preparation.py`, `tool_planning.py`, `tool_execution.py`, `approvals.py`, `guardrails.py`, `model_retry.py`, `session_persistence.py`, `streaming.py`. That is a good map of the concerns any harness loop has to cover.

**Lesson:** separating *workspace description* (manifest) from *compute provider* (client) makes the harness portable across sandbox vendors. This is the "harness separate from compute" idea that Anthropic's Managed Agents also uses.

## Cloudflare Agents + Think: harness as durable object

Cloudflare's contribution is the **runtime**, not a novel loop.

- **`agents` core.** Each agent is a Durable Object with its own SQLite, `setState` synced to connected clients, `@callable()` RPC, scheduling (one-off, recurring, cron), WebSockets, hibernation when idle, workflows with human-in-the-loop pause/resume, and MCP as both client and server.
- **`@cloudflare/think`** (experimental) is the opinionated loop. It "owns the `streamText` call" from the Vercel AI SDK (`ai@^7`), persists messages, resumes streams after a page refresh, and exposes lifecycle hooks (`beforeTurn`, `beforeStep`, `beforeToolCall` returning a decision, `afterToolCall`, `onStepFinish`, `onChunk`, `onChatResponse`, `onChatError`, `classifyChatError`).
- **Context as declared blocks.** `configureContext()` returns labelled prompt blocks. A block without a provider is auto-backed by SQLite and writable by the model via a `set_context` tool, which makes it a simple durable memory. The frozen system prompt is persisted so a cold wake reuses the exact cached prompt string, which preserves prompt-cache hits.
- **Overflow handling** goes beyond between-turn compaction (`compactAfter(100_000)`, keep 20k recent). It adds opt-in proactive compaction mid-turn (before a step crosses about 90% of the window) and a reactive compact-and-retry when the provider rejects with a context-overflow error, with a provider-agnostic error classifier.
- **Code execution.** A Workspace (`@cloudflare/computer`) gives every agent file tools and an `exec` tool. Code Mode lets the LLM write JavaScript that calls tools, run in a separate dynamically loaded Worker.
- **Churn.** Several entry points are already deprecated (`@cloudflare/shell`, `agents/ai-chat-agent`, the old `execute` tool), so pin versions.

**Lesson:** for many long-lived, mostly idle, per-user agents, put the session in an actor with its own database and make wake-from-hibernation cheap. Persisting the exact system prompt string is a small trick that protects prompt-cache hits across restarts.

## Cross-cutting patterns to adopt in buildanagent

1. **Layer the packages** like Pi: model API → loop core → product (tools, sessions, UI). Ship the loop core as its own module.
2. **Use an event-sourced session with branching.** Pi's tree-shaped JSONL makes compaction reversible and forking free. Codex and Cloudflare expose resume and fork as first-class API calls.
3. **Keep hook points consistent** across all four: before/after model step, before/after tool call (with allow/deny/modify), context transform, steering queue.
4. **Keep two policies, not one:** sandbox scope (Codex `SandboxPolicy`) and approval policy (`AskForApproval`). Treat "sandbox denied → escalate" as a flow, not an error.
5. **Abstract compute:** a manifest plus a pluggable sandbox client (OpenAI). Default to "no isolation, say so" (Pi) only for trusted local use.
6. **Compact in layers:** a between-turn threshold, mid-turn proactive compaction, and one reactive retry on overflow (Cloudflare, Pi). Keep the originals (Pi).
7. **Run one engine behind many interfaces:** TUI, print/JSON, JSONL-over-stdio RPC, SDK (Pi, Codex). The stdio-JSONL protocol is the de facto way SDKs wrap a harness binary (Codex SDK, Claude Agent SDK).

## Sources

- Pi: [github.com/earendil-works/pi](https://github.com/earendil-works/pi) (`packages/agent`, `packages/coding-agent/docs/{how-pi-works,compaction,security,mcp}.md`, `src/core/tools/index.ts`). Note that `badlogic/pi-mono` now resolves here.
- Codex: [github.com/openai/codex](https://github.com/openai/codex) (`codex-rs/protocol/src/{protocol,config_types}.rs`, `codex-rs/core/src/{tools,guardian,compact*}`, `codex-rs/linux-sandbox`, `codex-rs/app-server-protocol`, `sdk/typescript/README.md`).
- OpenAI Agents SDK: [github.com/openai/openai-agents-python](https://github.com/openai/openai-agents-python) (`README.md`, `docs/sandbox_agents.md`, `docs/sandbox/clients.md`, `src/agents/{sandbox,run_internal,memory}`).
- Cloudflare: [github.com/cloudflare/agents](https://github.com/cloudflare/agents) (`README.md`, `packages/think/README.md`, `packages/think/package.json`).
- Not reachable from this environment: developers.openai.com, openai.github.io, developers.cloudflare.com, mariozechner.at (Pi author's design post). Sandbox details for macOS Seatbelt and Windows in Codex were not re-read from source.
