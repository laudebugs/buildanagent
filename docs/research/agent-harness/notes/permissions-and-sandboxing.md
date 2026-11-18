# Permissions and sandboxing: how mature harnesses gate, isolate and keep secrets out

Working notes, written 2026-11-18. Versions are as of November 2026: Claude Agent SDK 0.3.327, Codex at commit `4389a526` (2026-11-18; sparse clone of `codex-rs/core` only), Pi 1.5.2, `@openai/agents-core` 0.21.0, `ai` 7.0.162, `langchain` 1.6.1. Paths shortened as follows:

- `CSDK` = `verify/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
- `CDOC` = `docs/reference/claude-agent-sdk/source/` (gitignored mirror, fetched 2026-11-18, `_manifest.json:3`)
- `CDX` = `/tmp/claude-0/-home-user-agent-speak/f25da082-478c-56cf-a445-d080f7917877/scratchpad/clones/codex/codex-rs/core/`
- `OAI` = `verify/openai-agents-sdk/node_modules/@openai/agents-core/dist/`; `OAIDOC` = `docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides/`
- `VDOC` = `docs/reference/vercel-ai-sdk/source/content/docs/`
- `LCM` = `verify/langchain/node_modules/langchain/dist/agents/middleware/`
- `PIDOC` = `docs/reference/pi/source/`

The thesis: every mature harness separates three decisions, and the weak ones conflate them. **Which call may run** (permission pipeline), **what a running call can touch** (sandbox), and **which secrets the call can see** (credential boundary). Claude and Codex implement all three; Vercel, OpenAI and LangChain implement only the first and delegate the other two; Pi implements none by default.

## 1. Permission pipelines: ordered, deny-first, fail-closed is the mature shape

### Claude runs six ordered steps, and deny beats every allow

- Order: PreToolUse hooks → deny rules → ask rules → permission mode → allow rules → `canUseTool` (`docs/reference/claude-agent-sdk/guide.md:136-142`, verified by examples 03a–03f). A hook `allow` does not skip deny or ask rules (guide.md:137).
- Six modes: `'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`; `auto` "use[s] a model classifier to approve/deny permission prompts", `dontAsk` denies anything not pre-approved, and `bypassPermissions` requires `allowDangerouslySkipPermissions` (CSDK:2692-2694, 2175).
- Deny rules win even in `bypassPermissions`; `canUseTool` never sees a denied call (guide.md:138). When `sandbox` settings merge, "a `deny` from either side win[s] over a `mask`" (CSDK:2363-2366).
- `canUseTool(toolName, input, {signal, suggestions, blockedPath, ...})` returns `allow` (optionally `updatedInput`, `updatedPermissions`) or `deny` (with `message`, optional `interrupt`) (CSDK:244-262, 2719-2731). `PermissionUpdate` can add/replace/remove rules, set mode or add directories, scoped to a destination (CSDK:2738-2760), which is how "always allow" persists.
- Settings sources are `'user' | 'project' | 'local'`, plus `managed` and `flag` at resolution (CSDK:10200, 3668). `allowManagedPermissionRulesOnly` in managed settings discards allow rules from all other sources while keeping their deny/ask rules (CSDK:8047-8049). Project settings cannot loosen sandbox network or `allowUnsandboxedCommands` once managed settings pin them (CSDK:9464, 9481).
- MCP servers can declare per-tool `always_ask` / `always_deny`; `always_ask` asks even when an allow rule covers the tool and even under `bypassPermissions` (CSDK:1321).
- Auto-denials are reported through `result.permission_denials`, and the streaming event is "best-effort advisory" (CSDK:6064).
- Gotcha: a bare tool name in `allowedTools` shadows `canUseTool`, so the callback never runs; the only warning is a Node warning (guide.md:152). Lesson: the allow-list step must not silently swallow the human step.

### Codex derives the approval requirement from policy, rules and a danger list

- Exec-policy rules (`*.rules` files, layered by config precedence) evaluate to `Allow`, `Prompt`/`PromptUser` or `Forbidden` and map to `ExecApprovalRequirement::{Skip, NeedsApproval, Forbidden}` (CDX `src/exec_policy.rs:61-63, 424-495, 764`).
- For commands no rule matches, a dangerous-command match forces `Prompt`, or `Forbidden` under `Never` ("we must forbid the command") (`exec_policy.rs:893-905`). Otherwise `Never` allows and relies on the sandbox; `OnRequest` in a restricted sandbox allows without prompting unless the command asks for a sandbox override; unrestricted or external sandboxes run directly (`exec_policy.rs:907-950`).
- "Always allow" persists as a prefix rule, but Codex refuses to suggest prefixes that grant a whole interpreter, such as `bash -c`, `sh -lc`, `bun run` (`exec_policy.rs:64-80, 1080-1086`). This prevents one approval from becoming arbitrary-code approval.
- Patches get their own check: `SafetyCheck::{AutoApprove, AskUser, Reject}` with a test that writes stay inside writable roots (`src/safety.rs:19-23, 67, 146`).
- A "Guardian" LLM reviewer can resolve approvals; its verdict "applies to the reviewed authority; escalating a sandboxed attempt requires a fresh review of the retry" (`src/tools/orchestrator.rs:1-3, 496-505`).

### Pi has one gate: an extension's `tool_call` handler

- "It does not ask for approval before every tool call"; tools and extensions run with the account's permissions (PIDOC `coding-agent/security.md:3`). The gate is `pi.on("tool_call", …)` returning `{block, reason}`; the sample blocks by default when there is no UI (PIDOC `examples/extensions/permission-gate.ts:13-29`). The block reason reaches the model as an error tool result (`docs/reference/pi/guide.md:106`, verified).
- Project trust only governs which `.pi/` resources load; "it does not limit what tool calls can access" and `AGENTS.md`/`CLAUDE.md` load regardless (security.md:29-33, 57).

### OpenAI, Vercel and LangChain gate per tool, with no modes

- OpenAI: `needsApproval: boolean | (runContext, input, callId) => Promise<boolean>`; conditional policies get an isolated plain-data copy and "after state restoration, the policy is evaluated again" (OAI `tool.d.ts:23-39`). Tool input/output guardrails return `allow`, `rejectContent` (short-circuit with a message) or `throwException` (tripwire) (OAI `toolGuardrail.d.ts:8-33`). Input guardrails run after approval by default; `preApprovalInputGuardrails: true` also runs them before the prompt, and again after (OAIDOC `human-in-the-loop.mdx:40`).
- Vercel: `toolApproval` rules return `'not-applicable'` (default, run), `'approved'`, `'denied'` or `'user-approval'` (VDOC `03-agents/06-tool-approvals.mdx:17-37`). Functions can combine role and argument checks, such as auto-deny non-admins and ask above an amount (same file:86-96).
- LangChain: `humanInTheLoopMiddleware` with `allowedDecisions` from `approve | edit | reject | respond` (LCM `hitl.d.ts:58-64`). `toolCallLimitMiddleware` caps calls per thread or run with `exitBehavior` `continue | error | end` (LCM `toolCallLimit.d.ts:46-67`).

## 2. Approval UX: synchronous callbacks are simple, pause-and-resume needs integrity

| Harness | Style | Where the pending approval lives |
|---|---|---|
| Claude | Synchronous `canUseTool` with an `AbortSignal` (CSDK:244-246) | In the CLI process |
| Codex | Synchronous prompt in the orchestrator; network approvals can be deferred (`orchestrator.rs:13-16, 45-48`) | In-process |
| Pi | Synchronous `ctx.ui.select` inside the handler (permission-gate.ts:25) | In-process |
| OpenAI | Pause: run returns `interruptions`; `state.approve/reject`, `alwaysApprove/alwaysReject` sticky per run (OAIDOC human-in-the-loop.mdx:36-54) | Serialized `RunState` (`toString`/`fromString`, :94-96) |
| Vercel | Pause: approval request in messages; client returns `approved: true/false` (06-tool-approvals.mdx:193-207) | The `messages` array the client sends back |
| LangChain | Pause: LangGraph `interrupt`, resume with `Command` | Checkpointer per `thread_id` |

Approval integrity is where pause-and-resume designs differ:

- **Vercel signs approvals.** Without a secret, "a client that crafts a valid-looking approval for a schema-conforming input can bypass the human-in-the-loop step", because history is client-controlled (06-tool-approvals.mdx:291-297). `experimental_toolApprovalSecret` HMAC-signs each request and binds it to "the exact tool name, tool call ID, and input arguments"; invalid signatures fail closed; the secret never reaches the client (:303-340). Server-side policy is re-evaluated anyway, and a policy denial wins over a valid signature (:299). Input is revalidated so a schema transform cannot swap the approved value (:282-285). The type is `string | Uint8Array` (`verify/vercel-ai-sdk/node_modules/ai/dist/index.d.ts:4025`). Signing is opt-in, so the default is unsigned (`docs/comparison/deep-comparison.md:45`).
- **OpenAI re-evaluates but does not sign.** `RunState` carries approvals and app context; the docs warn to treat `runContext.context` as persisted data and keep secrets out (human-in-the-loop.mdx:111). No HMAC or signature code appears in `OAI runState.mjs` (grep, 0 hits). A `RunState` from `fromString` "does not carry trusted live-container authority", so Docker restores from a snapshot rather than attaching to a container ID the state names (OAIDOC `sandbox-agents/clients.mdx:95`). Integrity therefore depends on storing state server-side.
- **LangChain's `when` predicate must be deterministic.** It "runs again when the run resumes … If it returns `false` on resume, the reviewer's answer is skipped and the tool runs, even if they rejected it" (LCM `hitl.d.ts:20-23`). A time- or state-dependent predicate turns a rejection into an execution.

The design rule: a resumed approval must be bound to (tool, call id, canonical input), verified server-side, and re-checked against current policy, with deny winning.

## 3. Policy languages: rules files and OPA, with defaults that matter

- Claude: `Tool(specifier)` rules in settings, with allow/deny/ask lists and managed precedence (CSDK:2734-2760, 8047).
- Codex: a dedicated `.rules` language (`codex_execpolicy`: `Policy`, `PolicyParser`, prefix rules, network rules), appended automatically on "always allow" (`exec_policy.rs:11-20, 537, 564`).
- Vercel `@ai-sdk/policy-opa`: Rego decisions `allow | deny | requires-approval | not-applicable`, evaluated in-process through `@open-policy-agent/opa-wasm` or against an OPA server; input `{tool:{name}, args, messages, runtimeContext}`, so rules can depend on history; testable with `opa test` (VDOC `03-agents/06-policy-tool-approvals.mdx:8-14, 45-48, 92-123, 140-154`).
- Fail-closed versus default-open: OPA backend errors and unknown decisions return `denied` (:156-162), but **no matching rule means allow** unless the policy declares `default decision := {"decision": "deny"}` (:61, 162). Every surveyed policy layer defaults to allow on no-match except Claude's `dontAsk` mode (CSDK:2692) and Codex `Never` for dangerous commands (`exec_policy.rs:900`).

## 4. Sandbox tiers: strength, cold start and cost

| Tier | Example | Strength (source) | Start / overhead | Cost |
|---|---|---|---|---|
| None, path checks in tools | OpenAI `UnixLocalSandboxClient`; Vercel `experimental_sandbox` | None: UnixLocal "adds no OS-level confinement" on macOS or Linux, and path grants don't restrict shell (OAIDOC clients.mdx:20, 33-37). Vercel's interface "does not sandbox the tool itself" (VDOC `07-reference/01-ai-sdk-core/34-sandbox.mdx:14-19`) | 0 | 0 |
| OS process sandbox | Claude/`srt` (Seatbelt, bubblewrap + seccomp); Codex (`SandboxType::MacosSeatbelt`, Linux bwrap+seccomp, Windows restricted token) (`src/sandboxing/mod.rs:103, 281`; `docs/research/harness-architectures.md:41`) | "Good (secure defaults)", but shares the host kernel (CDOC `secure-deployment.md:74, 97`) | "Very low" (:74) | Free, local |
| Container | Docker with `--cap-drop ALL --read-only --network none` (secure-deployment.md:113-138) | "Setup dependent" (:75) | Low (:75) | Self-hosted |
| gVisor | `runsc`; one of Modal's two Sandbox runtimes (gVisor or VM; Modal picks when unset, [Modal Sandboxes](https://modal.com/docs/guide/sandboxes), Runtimes) | "Excellent (with correct setup)" (:76): syscalls intercepted in userspace (:164-166) | CPU ~0%, simple syscalls ~2×, heavy file open/close 10–200× (:186-192) | Self-hosted or hosted |
| microVM | Firecracker (E2B, Vercel); Kata | "Excellent", but depends on hypervisor and device code (:77, 198) | Firecracker spec: ≤125 ms to guest init, ≤5 MiB VMM overhead per 1 vCPU/128 MiB VM ([SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md)); "High" overhead per Anthropic (:77) | Hosted, see below |
| WASM (Pyodide etc.) | Code interpreters | Weak as sole boundary: the host functions the embedder exposes are the attack surface (Cyera, cited in `docs/research/agent-sdks-and-harness-design.md:115`; not re-fetched, host blocked) | Low | Low |

Hosted prices, from the vendors' pricing pages as of November 2026: E2B charges $0.000014 per vCPU-second ($0.0504 per vCPU-hour), billed per second, and Pro costs $150/month plus usage ([E2B pricing](https://e2b.dev/pricing)); Daytona charges $0.0504 per vCPU-hour, billed per second ([Daytona pricing](https://www.daytona.io/pricing)); Modal Sandboxes are billed at the non-preemptible rate of $0.00003942 per physical core-second, where one core is 2 vCPUs, so $0.14 per core-hour and $0.071 per vCPU-hour are the same price ([Modal pricing](https://modal.com/pricing)). Isolation, from vendor docs: E2B runs Firecracker microVMs with dedicated kernels ([e2b.dev](https://e2b.dev)), Daytona's default Container class is a namespaced container sharing the host kernel, and only its Linux VM and Windows classes have their own kernel ([Daytona Isolation](https://www.daytona.io/docs/en/isolation.md); corrected 2026-11-18, see [fact-check, U11](../fact-check.md#daytona-isolation-re-checked-u11-2026-11-18); the docs overview's "a dedicated kernel" does not hold for the default class), and Modal runs gVisor or VMs. Cold starts: Daytona states sandbox creation under 90 ms ([Daytona docs](https://www.daytona.io/docs/en/)); the 27 ms lower bound, E2B's ~150 ms and Modal's sub-second figure appear only in comparison blogs (secondary: [softwareseni](https://www.softwareseni.com/e2b-daytona-modal-and-sprites-dev-choosing-the-right-ai-agent-sandbox-platform), [fly.io comparison](https://fly.io/learn/sprites-vs-e2b-vs-modal-vs-daytona/); no vendor page fetched states them). E2B resume from pause takes about 1 s, and pause about 4 s per GiB of RAM ([E2B persistence docs](https://e2b.dev/docs/sandbox/persistence), "Pause and resume performance"). gVisor's own README claims "many security benefits of VMs" with "fast startup" but gives no numbers ([google/gvisor](https://github.com/google/gvisor)).

OpenAI's hosted clients (Blaxel, Cloudflare, Daytona, E2B, Modal, Vercel) sit behind one `SandboxClient` interface, so the agent definition stays the same when the client changes (OAIDOC clients.mdx:41, 155-160). Docker's default networking is open unless `networkMode: 'none'` (:53).

## 5. Filesystem and network isolation are both required, and the network side is a proxy

- Anthropic: without network isolation an agent exfiltrates SSH keys; without filesystem isolation it escapes and reaches the network. The sandbox "safely reduces permission prompts by 84%" internally ([Claude Code sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)).
- `srt` defaults: reads allowed everywhere, writes denied except `allowWrite`, network denied; `denyWrite` beats `allowWrite`, and `deniedDomains` is checked first. On Linux the network namespace is removed and HTTP/SOCKS proxies are reached over bind-mounted Unix sockets. The proxies refuse allowed names that resolve to loopback, link-local or metadata addresses. A present but invalid settings file is an error, not a fallback to defaults ([sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)).
- Claude SDK knobs: `filesystem.allowWrite/denyWrite/denyRead/allowRead`, `network.allowedDomains/deniedDomains/strictAllowlist/allowManagedDomainsOnly`, Unix sockets macOS-only "(seccomp cannot filter by path)", and `failIfUnavailable`; the default is to warn and run unsandboxed (CSDK:9461-9553). `strictAllowlist` applies to sandboxed commands only, "in-process tools such as WebFetch are not gated" (CSDK:9488-9491).
- Known limits: same-host kernel; no TLS inspection by default, so domain fronting can bypass a name allowlist; credentials valid for an allowed domain can still exfiltrate data (CDOC secure-deployment.md:97-101). `srt` also documents narrower Linux globs, a proxy-username attribution ID that must hold 128 random bits, and `enableWeakerNestedSandbox` for Docker (README).
- Codex network proxy: per-environment allowed/denied domains, SOCKS5, local-binding toggle, MITM hooks, and exec-policy network rules compiled into the allowlist (`src/config/network_proxy_spec.rs:103-130, 173-200, 337-347`). A blocked host becomes an approval prompt ("Network access to \"{host}\" is blocked by policy.") (`orchestrator.rs:486-490`).

## 6. Separate sandbox and approval policies; escalation is an explicit, re-approved flow

- Codex keeps a sandbox mode (`read-only | workspace-write | danger-full-access`, CDX `config.schema.json:4925-4930`, plus `ExternalSandbox` as a filesystem kind, `exec_policy.rs:922`) apart from `AskForApproval`. The config schema at this commit offers `on-request`, `granular` (per-category booleans for `sandbox_approval`, `rules`, `request_permissions`, `skill_approval`, `mcp_elicitations`) and `never` (`config.schema.json:316-345, 2245-2266`). `UnlessTrusted` still exists internally but is rejected when set explicitly; it is derived only from an untrusted project (`src/config/mod.rs:4085-4101`). **This corrects `docs/research/harness-architectures.md:16, 37`, which lists `untrusted` as a user-selectable value; add a fact-check row.**
- Escalation, from `orchestrator.rs:406-580`: run sandboxed; on `SandboxErr::Denied`, stop if the tool doesn't escalate on failure, or if the policy forbids no-sandbox approval (`Never`/`OnRequest`, except for a network prompt). Then build a denial reason from the output, ask again unless a prior human/hook approval covers the retry (a Guardian approval never does), and retry with the escalated profile. Codex also refuses escalation on an exec-server that cannot preserve denied reads (:272-290).
- Claude's analogue is `dangerouslyDisableSandbox` per command, which `allowUnsandboxedCommands: false` turns off entirely (CSDK:9476-9478). `autoAllowBashIfSandboxed` lets the sandbox replace prompts, while deny and ask rules still apply (CSDK:9470-9474). That is the mechanism behind the 84% figure.

## 7. Secrets: allowlist the environment, inject credentials at the egress proxy

- **Inherited env is the common leak.** Claude's CLI inherits the parent environment; our harness saw host tools and the host proxy until it passed an allowlisted `env` (`docs/reference/claude-agent-sdk/fact-check.md:94`). Codex's default `ShellEnvironmentPolicy` inherits all variables with default excludes **ignored**, so `API_KEY` and `SECRET_TOKEN` reach commands unless `ignore_default_excludes = false` or `inherit = "core"|"none"`. A test pins this behavior (`src/exec_env_tests.rs:83-105, 107-128`; `config.schema.json:4966-5050`). Codex builds the map for `env_clear()` + `envs()`, the right primitive (`src/exec_env.rs:21-37`). Its `CODEX_PERMISSION_PROFILE` env var "must not be treated as proof of enforcement" (:18-20).
- **Proxy injection keeps the real secret outside.** Claude's `sandbox.credentials` gives files and env vars `deny` (unset or unreadable) or `mask`. With `mask`, the sandbox sees a sentinel that "the host proxy swaps sentinel→real on egress to `injectHosts`", with regex `extract`, JWT-aware masking, AWS SigV4 re-signing pairs, and plaintext-HTTP injection off by default. `mask` "degrades to `deny`" on macOS and Windows (CSDK:9554-9640). Codex has a `credential_broker` on its network proxy and requires it for SigV4 MITM hooks (`network_proxy_spec.rs:107-108, 192-200`). Anthropic's cloud git proxy checks a scoped credential and the operation (push only to the configured branch) before attaching the real token ([Claude Code sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)). Docker Sandboxes substitutes Pi's provider key at its proxy; Gondolin VMs still "inherit host environment variables" (PIDOC `coding-agent/containerization.md:9-16, 84-86`).
- **Credentials in sandbox helpers are rejected.** OpenAI refuses credential-bearing mounts whose helper runs inside the sandbox, "because model-controlled code can access that helper's process credentials" (OAIDOC clients.mdx:170). Vercel's sandbox client token persists in serialized session state (:166).
- Secure-deployment pattern: `--network none`, a proxy socket mounted read-only, and `ANTHROPIC_BASE_URL` pointed at a proxy that injects the key, allowlists domains and logs traffic (CDOC secure-deployment.md:38-50, 143-153).

## 8. Prompt-injection defenses at the harness level are mostly capability limits

- No surveyed harness claims to detect injection reliably. Pi: watching transcripts and project trust "do not create a security boundary" (security.md:5-7). Claude summarizes web search results rather than passing raw content (CDOC secure-deployment.md:29).
- Effective controls cut the data-to-action path. Vercel's fetch tool offers `allowedDomains` and `requireUrlInUserMessage`, which ignores URLs found in tool results "because the model can place arbitrary text there" (VDOC `03-ai-sdk-core/18-tools.mdx:319-328`). Context files are untrusted even when project trust is declined (security.md:57). Deny host tools by name as well as by type (`AGENTS.md:71`).
- Content filters exist but are advisory: LangChain `piiMiddleware` strategies `block | redact | mask | hash` on input, output and tool results (LCM `pii.d.ts:33, 103-115`); its guardrails guide pairs deterministic checks with model-based ones (`docs/reference/langchain/source/src/oss/langchain/guardrails.mdx:10, 28-31`). OpenAI tool output guardrails can reject content before the model sees it (`toolGuardrail.d.ts:8-10`). Classifier gates (Claude `auto`, Codex Guardian) are model judgments; Codex scopes a Guardian approval to the reviewed authority only (`orchestrator.rs:2-3`).

## Design implications for our harness

1. **One ordered, deny-first pipeline.** Order: hooks → deny → ask → mode → allow → host callback, as Claude does (guide.md:136-142). Deny wins over every allow and every mode. Unlike Claude, an allow rule must never silently bypass a registered approval callback; make shadowing a startup error (guide.md:152). Default no-match to `ask` in interactive mode and `deny` headless, which Vercel and OPA do not (policy-tool-approvals.mdx:61).
2. **Two independent policies plus escalation.** Keep `SandboxPolicy` (fs roots, network allowlist) separate from `ApprovalPolicy` (`on-request | granular | never`), and implement Codex's sandbox-denied → re-approve → retry flow as a tested state machine (`orchestrator.rs:406-580`). Under `never`, a denial returns to the model and never escalates (`config.schema.json:340`).
3. **"Always allow" must not widen to interpreters.** Persist prefix rules but ban `bash -c`, `python -c`, `node -e`-style prefixes (`exec_policy.rs:64-80`). Scope sticky approvals to a run or session and record them in the event log.
4. **Bind pause-and-resume approvals.** HMAC over (tool name, call id, canonical input, policy version), verified server-side, with current policy re-evaluated and deny winning (06-tool-approvals.mdx:299-320). Make it mandatory, not opt-in. Approval predicates must be pure functions of the call, to avoid LangChain's resume bypass (hitl.d.ts:20-23).
5. **Pluggable sandbox interface with honest tiers.** Define `SandboxClient` around a workspace manifest (OpenAI clients.mdx:41). Ship a `none` backend labelled unsafe, an OS backend that wraps `srt` (low cost, shares the kernel), and Docker with `--cap-drop ALL --read-only --network none`. Leave gVisor, Firecracker and hosted (E2B, Modal, Daytona) to adapters, chosen by threat model: gVisor for I/O-light untrusted code, given the 10–200× file-I/O penalty (secure-deployment.md:186-192). Fail closed when the requested sandbox is unavailable (`failIfUnavailable`, CSDK:9468); never fall back silently. Never treat WASM alone as a boundary.
6. **Network is a host-side proxy, default deny.** Remove the network namespace, expose a proxy socket, enforce allow/deny domains, refuse private and metadata IPs after resolution, and log every request (`srt` README). Gate in-process fetch tools by the same allowlist, which Claude's `strictAllowlist` does not do (CSDK:9488-9491).
7. **No secrets inside.** Spawn every tool with `env_clear()` plus an allowlist (AGENTS.md:84; `exec_env.rs:21-37`), not Codex's inherit-all default. Inject model and API credentials at the egress proxy using sentinel substitution scoped to hosts (CSDK:9554-9640). Model gateway keys stay in layer 1, outside the sandbox. Keep secrets out of serialized run state (human-in-the-loop.mdx:111).
8. **Injection defense equals capability shaping.** Cap tool calls per run (toolCallLimit.d.ts), restrict URL sources (18-tools.mdx:319-328), treat repo context files as untrusted, deny host tools by name, and add OTel attributes for every permission decision so the eval suite can measure prompt rate against the 84% baseline.

## Unresolved gaps

- Codex's `protocol`, `linux-sandbox` and `execpolicy` crates were not in the sparse clone, so the Seatbelt profile, bwrap/seccomp flags, `.rules` grammar and the default `SandboxMode` were not re-read from source.
- cyera.com and gvisor.dev did not resolve from this session; the Pyodide-escape claim rests on the main report's earlier citation.
- Hosted prices and E2B pause/resume times were re-checked against vendor pages on 2026-11-18 ([fact-check](../fact-check.md), R1). E2B's ~150 ms and Modal's sub-second cold starts remain secondary, and no vendor figure was measured by us.
- No measured cold start for `srt` or Docker on our hardware; we should benchmark before choosing a default backend.
