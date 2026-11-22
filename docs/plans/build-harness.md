# Plan: build our agent harness as four packages around one session log, in 55 todos that start on the SDK's seams

- **Status:** Draft (P2, 2026-11-18), revised on 2026-11-18 with the fixes from the [P4 review](reviews/plan-review.md), and on 2026-11-18 for three deployment targets ([ADR 0033](../decisions/0033-three-deployment-targets.md), [coding agent plan §4](build-coding-agent.md#4-changes-to-the-sdk-and-harness-plans)): stage 8 (§4.8) adds todos N41–N49. Revised on 2026-11-19 (plan review 2) to apply [ADR 0043](../decisions/0043-standalone-safety-core.md) and the [close-sdk-gaps plan](close-sdk-gaps.md), Anthropic's thinking prefix check (HD3), MCP tool pinning (HD14) and the owner's HD8 amendment. Revised on 2026-11-19 from the [retrieval and memory report][u18] (U18), whose twelve proposed changes the owner approved that day: HD17 and todo N52 add file-based long-term memory, N21 gains read-only `grep` and `glob` built-ins, HD11 is amended so a memory delete reaches the session log ([ADR 0056](../decisions/0056-file-based-memory-and-log-purge.md)), and HD17 records the memory side of the untrusted-source decision that plan review 2 proposes as HD16. Revised on 2026-11-19 from the A2A (U19) and voice (U20) research, whose proposed changes the owner approved that day (owner decision 2026-11-19): §1 records that v1 ships no A2A client or server, §3.3 defaults remote-agent tools to untrusted output, and HD6 records what a voice front end would need from the protocol and the log. Revised on 2026-11-19 from the book's Chapter 5, by the owner's decision that day ("yes, i accept these"): §3.2 and N3 key every session lookup by user and session id. Revised on 2026-11-22 by N2: §3.2's entry union is built in `@buildanagent/protocol`, which also owns `PermissionMode`, `ApprovalPolicy` and `SandboxTier`. Revised on 2026-11-22 by N11: §3.3's registry is built, with `remoteAgent` as a flag, `preambleTokens()` taking the system prompt and not a model, and tool search taking an explicit `activated` set.
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18), through the [implementation plans](implementation-plans.md#2-what-each-plan-contains)
- **Builds on:** the [harness guide][hg] (G2b), its [reference architecture][hg12] and its [twelve open decisions][hg13], and the [SDK plan][sdk] (P1), whose [seams][sdk34] this plan consumes by name
- **Decision records:** [ADRs 0012–0021](../decisions/README.md), beside the SDK's 0001–0011, and [ADR 0056](../decisions/0056-file-based-memory-and-log-purge.md) for HD17 and the HD11 amendment
- **Todos:** Round N ("build harness") on the [todo board](../todos/README.md); §4 lists them.

The harness is the layer that moves agent results most: with the model held fixed, Pass@1 across seven harnesses differed by up to 24.3 points, and cost among mature harnesses differed by up to 3× ([harness guide, introduction][hg]). The [harness guide][hg] settles the design in five parts. One append-only, tree-shaped session log is the only source of truth, and context layers are added from the cheapest upward. The permission pipeline, the sandbox and the credential boundary stay three components the host owns. One typed protocol sits under every interface, and evals report cost beside pass rate against mini-swe-agent.

The guide left twelve decisions open, and the [SDK plan][sdk] has since fixed the loop, the event union and eleven named seams the harness must use as written ([SDK plan §3.4][sdk34]). This plan makes the twelve decisions plus four the guide did not list, lays out four packages with their public APIs, and turns the architecture into 55 todos, each one reviewable batch tested offline. Of the 55, 41 come from P2 and P4 (N1–N40 with N38b), 12 were added on 2026-11-18 for portability (N41–N49 with N46a/b, N47a/b and N48a/b), N50 is a verification todo added in plan review 2, and N52, the memory extension, came from U18 on 2026-11-19. N51 is left free for the vault todo that the [agent connectors report](../research/connectors/agent-connectors.md) proposes. Where the harness needed more than the SDK plan provided, §3.6 lists it, and P4 moved those needs into the SDK plan. In one sentence: **build the session log first, fill the SDK's interceptors with the context, tool and permission layers, add the sandbox, credentials and protocol, and judge every removable component by cost per task beside pass rate.**

## 1. Goal and non-goals

**Goal.** At the end of Round N, `@buildanagent/protocol`, `@buildanagent/harness`, `@buildanagent/cli` and `@buildanagent/evals` build, type-check and pass `pnpm test` offline beside the SDK's two packages. Together they implement the ten components of the [reference architecture][hg12] on top of `@buildanagent/sdk` and `@buildanagent/gateway`. A triage capstone runs on the harness, pauses for approval, resumes in a second process and replays byte for byte from its log. An eval runner compares the harness with mini-swe-agent on cost and pass^k. Every component other than the log, the permission pipeline and the protocol can be switched off for an ablation, as [AGENTS.md](../../AGENTS.md#planned-architecture-when-code-starts) and [harness guide §11][hg11] require.

The goal covers every recommendation in the guide's design sections, §2 to §11. The table maps each section to the todos that build it:

| Guide section | Recommendation | Todos |
| --- | --- | --- |
| [§2 Session log][hg2] | typed JSONL tree, persisted HEAD, one writer lock, immutable files, `SessionStore`, pauses as entries, user entry first, write-time size bound, playback and re-run, documented schema and retention, search and replay CLI | N2–N7, N13, N30, N33 |
| [§3 Context][hg3] | five removable layers, cheapest first; compaction as a visible entry with a focus hint and hooks; cache-prefix rationing; a budget below the window; a plan and progress file convention | N8–N10, N23, N39 |
| [§4 Tools][hg4] | one registry, canonical names, per-source exposure, MCP as a removable built-in with per-server protocol eras, untrusted annotations, three host-tool patterns | N11, N24, N25 |
| [§5 Permissions][hg5] | ordered deny-first pipeline, no-match ask or deny, shadowing as a startup error, signed approval entries re-evaluated on resume, sticky approvals without interpreter prefixes, path-based ask rules, code-initiated calls through the same pipeline | N12–N14, N40 |
| [§6 Sandbox and credentials][hg6] | separate sandbox and approval policies, escalation as a state machine, honest tiers that fail closed, launched by the host, cleared env, default-deny egress proxy with host-scoped sentinels | N15–N21 |
| [§7 Extensions][hg7] | three tiers behind one project-trust gate, declared hook composition, skills from `.agents/skills`, content-hash pinning, native `AGENTS.md` | N22, N23 |
| [§8 Protocol][hg8] | one typed union, JSON-RPC 2.0 with `jsonrpc`, disposition plus `turn/settled`, cancellation, bounded queues, capabilities and pending set in `initialize`, stdio JSONL first | N26–N30 |
| [§9 Telemetry][hg9] | spans projected from the log, an approval-wait span, content off, OTLP only, a pinned convention commit, a running cost with a warning | N31 |
| [§10 Evals][hg10] | Inspect bridge, mini-swe-agent baseline, cost beside pass^k, three suites, isolated grader, infra failures apart, completion checked in code | N32, N36–N39, N38b |
| [§11 Ablation][hg11] | every component behind an interface with a no-op, reported in the §10 format | N34, N39 |

**Non-goals.** These belong to other plans or later work, each for a stated reason:
- **The loop, the gateway, tool validation, interceptors, signed pauses and the scripted model.** The SDK plan builds them; the harness only fills their seams ([SDK plan §1][sdk1]).
- **Agent-product concerns:** the tier table, N-of-M quorum policies, the trusted run context's fields, provenance rules, cross-run counters and the shadow rollout. P3 decides them. The harness provides the hook each one needs (§3.7) and no policy.
- **A WebSocket or HTTP-with-SSE transport, until 2026-11-18.** It moved into scope that day: the coding agent's CLI attaches to a Durable Object over WebSocket, so N44 adds the transport ([ADR 0033](../decisions/0033-three-deployment-targets.md)). The guide made stdio JSONL the first remote transport ([harness guide §8][hg8]), and stdio stays first.
- **An MCP-server facade.** Codex ships none, and MCP lacks steering, session trees and approval replay; a thin `run_task` facade can follow a consumer ([harness guide §8][hg8]).
- **gVisor and self-run microVM backends.** The guide makes them adapters chosen by threat model, and the `SandboxClient` interface leaves room for them ([harness guide §6][hg6]). Hosted backends (Cloudflare Sandbox, E2B and Vercel Sandbox) left this list on 2026-11-18 and are todos N46b, N47b and N48b ([ADR 0033](../decisions/0033-three-deployment-targets.md)).
- **TLS interception in the egress proxy.** The first proxy injects credentials through a local reverse-proxy route and filters HTTPS by name through `CONNECT`, so no per-session CA is needed yet (§2, HD15).
- **A full-screen TUI, a SQLite listing projection and branch summaries.** The CLI is line-mode; listing scans JSONL headers until session counts make that slow; branch summaries need a tree-navigation UI, which P3 or later work owns ([harness guide §2][hg2]).
- **An A2A client or server** (added 2026-11-19, owner decision 2026-11-19). Version 1 neither calls agents over A2A nor exposes one, because the coding agent, the first agent we build, has no outside caller yet. The A2A research's rule is to expose an agent only when an outside caller needs to delegate to it, and to call one only when someone else owns it ([A2A report][u19-when]). Revisit this when an outside caller exists. The revisit would map A2A's `TASK_STATE_INPUT_REQUIRED` and `TASK_STATE_AUTH_REQUIRED` onto N13's signed pause. The [source-update report](../research/source-update-2026-11-19.md#proposed-plan-changes) proposes the same pause for MCP's `input_required` results, and that proposal still awaits the owner's decision. Credentials for `AUTH_REQUIRED` would then arrive out of band, through the connector vault, as the [connector notes](../research/connectors/notes/protocol-auth-security.md) suggest, never inside the task.
- **The third host-tool pattern,** where a tool with no executor suspends the turn into continuation state. The SDK's `ToolResult.pause` carries only `clarification`, and the first two patterns serve every planned client ([interfaces note §9][n-if-9]). P4 dropped the matching SDK need for Rounds B and N (§3.6).

## 2. Decisions

Decisions HD1 to HD12 answer the twelve open decisions of [harness guide §13][hg13], in the same order. HD13 and HD14 are decisions the guide's sketch left implicit: the package split and the MCP client's base. HD15 records the credential proxy's first shape, and HD17 adds long-term memory as a file-based extension (U18). HD16 is not in this plan: plan review 2 proposes it for untrusted-source tools, and it still waits on the owner. The `HD` prefix keeps these apart from the SDK plan's D1–D12 and from the `H` todos. Statuses follow the SDK plan's three: **Decided**, **Decided, provisional** (a named todo checks it), and **Accepted (owner, 2026-11-18)** for HD4, HD5, HD8 and HD11 ([SDK plan §2][sdk2]). HD17 and the HD11 amendment were accepted by the owner on 2026-11-19. No decision in this plan still waits on the owner.

Three decisions merge with the SDK's. For each, this plan references P1's choice and adds only the harness side: HD5 builds on SDK D5, HD7 on SDK D3 and HD9 on SDK D9.

| # | Decision | Choice | Status | ADR |
| --- | --- | --- | --- | --- |
| HD1 | Log granularity | One entry per content block, written from the SDK's end events; deltas are never persisted | Decided, provisional (N35) | [0013](../decisions/0013-log-entry-per-content-block.md) |
| HD2 | Lock primitive | An exclusive lock file with pid, host and a renewed lease; stale only when the lease has lapsed and the pid is gone; local disk only | Decided, provisional (N4) | [0014](../decisions/0014-session-writer-lock.md) |
| HD3 | Default context layers and budget | Layers 1, 2, 3 and 5 on; layer 4 on only below 128K; budget `min(window − 16,384, 200,000)` | Decided, provisional (N39) | none: tunable defaults |
| HD4 | Default sandbox backend | `srt` for interactive local runs, Docker for headless runs and evals; `none` only with an explicit unsafe flag | Accepted (owner, 2026-11-18) | [0020](../decisions/0020-default-sandbox-backend.md) |
| HD5 | Approval signing key (with SDK D5) | The harness always passes `hmacSigner()` over a persistent, host-only key ring; every approval is a pause first | Accepted (owner, 2026-11-18); storage and rotation revised by ADR 0035 | [0015](../decisions/0015-harness-approval-key-ring.md), superseded by [0035](../decisions/0035-read-only-key-store.md) |
| HD6 | Protocol framing | Strict JSON-RPC 2.0 with the `jsonrpc` field; v1 ships twelve methods and three server requests | Decided | [0016](../decisions/0016-protocol-json-rpc-framing.md) |
| HD7 | Telemetry commit and cost attribute (with SDK D3) | Pin semconv-genai `d28355d`; name cost `buildanagent.cost.usd` with `buildanagent.cost.basis`; sum classes only in the projection | Decided | [0017](../decisions/0017-telemetry-convention-pin-and-cost-attributes.md) |
| HD8 | Eval suite seed | 30 tasks: 20 recreated real failures from this repo's history and 10 triage tasks shared with P3; k = 5. Amended: 20 repository tasks now, plus 10 coding-agent tasks (W12) before W8's baseline | Accepted (owner, 2026-11-18); amended (owner, 2026-11-19) | none: eval data |
| HD9 | Budget timing (with SDK D9) | SDK D9's check per call, plus a session cap, a pre-checked summary call and an 80% warning | Decided | [0009](../decisions/0009-pre-emptive-budget.md), whose consequences record the session cap |
| HD10 | Completion check | Configured checks, else discovered `package.json` scripts, run in the sandbox after `done`; flagged diff patterns are recorded, not fatal | Decided, provisional (N38) | none: tunable defaults |
| HD11 | Retention and transcript schema | No automatic deletion by default; opt-in archive or purge; `EntryBase` and the entry type names are stable per `formatVersion`. Amended: a memory delete marks the log entries that carry the fact, and a targeted purge or the retention purge removes them | Accepted (owner, 2026-11-18); amended (owner, 2026-11-19) | [0018](../decisions/0018-retention-and-transcript-schema.md), amended by [0056](../decisions/0056-file-based-memory-and-log-purge.md) |
| HD12 | Approval modes | Path-based ask rules, scoped sticky allowances and grouped approvals; no classifier allows except through the host callback | Decided (harness side) | [0019](../decisions/0019-permission-pipeline-and-approval-modes.md) |
| HD13 | Package split | Four packages: `protocol`, `harness` with subpath exports per component, `cli` and `evals` | Decided | [0012](../decisions/0012-harness-packages.md) |
| HD14 | MCP client base | `@modelcontextprotocol/client` 2.4.0 behind our `McpConnection` interface | Decided, provisional (N24) | [0021](../decisions/0021-mcp-client-base.md) |
| HD15 | Credential proxy shape | Default-deny egress; credentials injected on local reverse-proxy routes by sentinel; no TLS interception | Decided | [0020](../decisions/0020-default-sandbox-backend.md), whose decision records the proxy shape |
| HD17 | Long-term memory | A removable extension: a `memory` tool over `.agents/memory/`, sourced records that expire unless a check renews them, an index capped at 200 lines or 25 KB, and low-trust records from sessions that read untrusted content | Accepted (owner, 2026-11-19) | [0056](../decisions/0056-file-based-memory-and-log-purge.md) |

### HD1. One entry per content block, written from the SDK's end events (provisional)

**Options.** One JSONL line per stream delta, per content block, or per completed message ([harness guide §13, decision 1][hg13]).

**Choice: one entry per content block.** On `model_call_end`, the session runner writes one `message_block` entry per block of the `AssistantMessage`, then a `message_end` entry with its stop reason and a `usage` entry with its `Usage` and `Cost`. Each `tool_call_end` becomes one `tool_result` entry. Deltas (`text_delta` and the rest) reach live clients as protocol events and are never written.

**Evidence.** The real Claude Code transcript writes one entry per content block, which lets parallel tool calls interleave with their results without ambiguity ([sessions note, addendum][n-sess-add]). The SDK's `*_end` events carry the authoritative item, so a block entry needs no reassembly ([SDK plan §3.4][sdk34]). Per-delta lines would multiply file size for a playback that only needs completed blocks, and a per-message line cannot place a tool result between two calls of the same message. The block is also the natural unit for agent decision 5's provenance label ([agent guide §10][ag10]). The guide's settling test, recording the capstone at all three granularities and comparing size, playback fidelity and resume code, runs in N35; the choice stays unless per-block playback loses information that per-delta keeps.

### HD2. A lock file with a renewed lease, on local disk only (provisional)

**Options.** A lock file with pid and lease, `flock`, or an actor process per session, plus a rule for a stale lock after a crash ([harness guide §13, decision 2][hg13]).

**Choice: a lock file.** `acquire` creates `<session>.lock` with the exclusive-create flag (`open(path, "wx")`) and writes `{ pid, host, token, leaseUntil }`. The holder renews the lease every 10 seconds for a 30-second lease. A second writer gets `"would_block"` at once. A lock counts as stale only when its lease has lapsed *and*, on the same host, its pid no longer exists; a lock from another host needs an explicit `session unlock --force`. Readers never lock and tolerate a torn last line. The supported storage target is local disk; the docs say NFS and other network file systems are unsupported.

**Evidence.** Codex returns `WouldBlock` to a second writer, and Pi uses lock files for its settings and trust stores, though not for sessions ([sessions note §5][n-sess-5]; [sessions note §1][n-sess-1]). OpenHands' `flock` "does NOT work reliably on NFS", and Node 22's `node:fs` exposes no `flock` call, so `flock` would need a native addon ([sessions note §6][n-sess-6]; [Node 22 fs API](https://nodejs.org/docs/latest-v22.x/api/fs.html)). An actor per session suits a server, which is a non-goal (§1). The 30-second lease mirrors OpenHands' 30-second lock timeout as a starting value ([sessions note §6][n-sess-6]). N4 runs the guide's settling test: it kills a writer with `SIGKILL` mid-append, and a new writer must then recover within one lease while readers load every complete entry.

**Revision (2026-11-18).** `fileLock()` stays the local implementation. [ADR 0033](../decisions/0033-three-deployment-targets.md) adds off-host `SessionLock` implementations (a Durable Object, a DynamoDB lease row and a Postgres lease row, in N46a, N47a and N48a), which treat a lapsed lease as the only staleness signal; the dead-pid check applies on the same host only. Renewal moves onto `Scheduler.wake` (N41).

### HD3. Layers 1, 2, 3 and 5 on by default, and a budget capped at 200K tokens (provisional)

**Options.** Which of the five layers are on for 128K+ models, and where the default budget sits below the window ([harness guide §13, decision 3][hg13]).

**Choice.** Layer 1 (a 64 KiB write cap with spill to a file) and layer 2 (masking older tool results to 500 characters, with a cutoff that moves every 8 messages) are always on. Layer 3 (a between-turn summary keeping a 20K-token tail) is on and fires at the budget. Layer 4 (mid-turn compaction at 90% of the window) is on only for windows under 128K tokens. Layer 5 (one compact-and-retry on provider overflow) is on. The default budget is `min(window − 16,384, 200,000)` tokens. Every value is a setting and is recorded in the `session_header`.

**Evidence.** The cheap layers carry most of the measured value: masking matched LLM summarization's solve rate at about half the raw agent's cost ([harness guide §3][hg3]). The gain from context management fell from 35.7 to 2.7 points as windows grew from 32K to 128K, so the mid-turn layer earns least on large windows ([harness guide §3][hg3]). Practitioners report a quality threshold of 200–300K tokens on 1M-token models, so the cap starts at the low end; Pi reserves 16,384 tokens below the window for its trigger ([harness guide §3][hg3]). The 64 KiB cap is Codex's persistence bound, and the 500-character mask and the 8-message step are Cloudflare Think's ([sessions note §5][n-sess-5]; [harness guide §3][hg3]). The layer-3 default stays on despite the decay result because a 1M-window session without it ends in an overflow error, and practitioners object to compaction they cannot see more than to compaction itself ([harness guide §3][hg3]). N39 runs the guide's settling test: each layer on and off on the seed suite, scored on cost and pass^k.

**Revision (plan review 2, 2026-11-19): the request view stays append-only for signed thinking.** Anthropic models with preserved thinking (Claude Opus, Sonnet and Haiku 5.5, and Fable and Mythos 5.1–5.2) run a prefix check on every thinking block sent back. If the request changes `system`, `tools` or an earlier message, every thinking block after the change fails the check, which is a 400 on Fable 5.2 and Mythos 5.x and a possible 400 on the others. When no error comes back, the stale blocks reach the model and are billed ([Anthropic, preserved thinking prefix checks](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks), as of November 2026). Layers 2, 3 and 4 edit earlier messages, so on these models the request view follows five rules:

1. The view sends each assistant turn back exactly as the API returned it, including thinking blocks whose text is empty. When a layer edits or removes an earlier message, the view drops every thinking block after the edit point. A view may leave out the oldest run of thinking blocks, the newest run or all of them, never one in between.
2. The harness builds `system` and `tools` once per session.
3. A tool change mid-session is announced in a `role: "system"` message, not by changing `tools` (N25).
4. On a 400 that says a block is "bound to a different conversation", the adapter retries with `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta header `thinking-binding-controls-2026-08-01`) and sends that setting on every later request of the same conversation (the same branch of the session log), because the setting acts only on the request that carries it.
5. Because a failed check may return no error, the adapter sends the beta header on every request and records each `thinking_mismatch_allowed` entry in the response's `input_transformations` as a warning event, so a layer that breaks rule 1 shows up in the trace.

N8, N9 and N10 test the first rule, N25 the third, and B8 surfaces the 400 as a typed error kind. N39's ablation measures the extra cost of the dropped blocks in its own arm.

### HD4. `srt` for interactive runs and Docker for headless runs (accepted)

**Accepted by the owner on 2026-11-18.**

**Options.** `srt`, Docker, or `none` with a loud warning for local use ([harness guide §13, decision 4][hg13]).

**Choice.** Interactive local runs default to the OS backend over `srt`; N19's measurement can only change this through a superseding ADR. Headless runs and every eval trial default to Docker with `--cap-drop ALL --read-only --network none`. The `none` backend runs only with an explicit `sandbox: { tier: "none", unsafe: true }`, writes the choice to `env_stamp` and prints a warning at session start. Every backend fails closed when it cannot start.

**Evidence.** `srt` is rated good with very low overhead but shares the host kernel, and Docker's strength depends on its setup ([harness guide §6][hg6]). Practitioners trust sandbox-plus-no-prompts for background runs, while about 92 say containers are too weak against malice, so we claim neither tier stops a hostile process ([harness guide §6][hg6]). Claude's settings-file sandbox runs unsandboxed with only a warning when it cannot start, which is the fail-open default we refuse ([harness guide §6][hg6]). Nobody has measured either tier's cold start on our hardware ([permissions note, unresolved gaps][n-perm-gaps]). N19 measures both. If the numbers argue for Docker on interactive runs, N19 proposes a new ADR that supersedes 0020, because an accepted record is never rewritten.

**What the owner still supplies.** A review of N19's numbers. The threat model and the supported hosts stay as accepted: neither tier is claimed to stop a hostile process, and macOS runs `srt` over Seatbelt.

### HD5. The harness always passes `hmacSigner()` over a persistent key ring (accepted, with SDK D5)

**Accepted by the owner on 2026-11-18.** **Revision (2026-11-18):** [ADR 0035](../decisions/0035-read-only-key-store.md), also accepted by the owner, supersedes ADR 0015. It makes `KeyStore.rotate()` and `prune()` optional so a read-only cloud secret can back the ring; the rest of this decision stands (N42). **Revision (plan review 2, 2026-11-19):** under [ADR 0043](../decisions/0043-standalone-safety-core.md), `hmacSigner()` is defined in `@buildanagent/agent-safety` ([E3](../todos/done/E3-signed-approvals-third-party.md)) and reaches the harness through the SDK's re-export, so N13 keeps importing it from `@buildanagent/sdk`.

[SDK D5][sdk-d5] covers the SDK side: key-id signers, an `ephemeralSigner()` default and a fail-closed resume.

**Harness side: the key.** The harness's deployment model is one host process per session. That process may restart between a pause and its resolution, and the resolving process may differ from the one that wrote the pause. An ephemeral key would strand every pause across a restart, so the harness never relies on the SDK default. It keeps a key ring in a `KeyStore` outside every sandbox and outside the session log, by default `$XDG_STATE_HOME/buildanagent/keys.json` with mode `0600`. It passes `hmacSigner({ keys, current })` on every `run` and `continueRun`. Rotation adds a new current key; an old key stays in the ring until no unresolved `approval_requested` entry names its `keyId`, and `keys prune` removes it then.

**Harness side: the pause path.** Every `ask` ends the run in the SDK's `awaiting_approval` state: the harness writes the `SignedPendingRequest` as an `approval_requested` entry before it asks any client, and it never uses `blockingApprovals()`. On resume, the harness re-runs its permission pipeline on each approved call and turns the approval into a denial if current policy now denies it. The SDK then verifies the signature and runs the allowed call without calling `beforeToolCall` again (SDK §3.3, `continueRun`).

**Evidence.** Pauses must be entries because a callback dies with its process, and approvals in production wait minutes or hours ([harness guide §2][hg2]; [agent guide §1][ag1]). LangChain's re-run predicate shows why re-evaluation must let a deny win and never skip a rejection ([harness guide §5][hg5]). The guide's settling rule ties the key to the deployment model: a multi-process host needs a shared key store ([harness guide §13, decision 5][hg13]). The owner kept the SDK's ephemeral default for library users, so `signer` stays optional there and the harness always sets it.

### HD6. Strict JSON-RPC 2.0, with the `jsonrpc` field and twelve v1 methods

**Options.** Strict JSON-RPC 2.0 with the `jsonrpc` field, or Codex's field-less variant, and which methods ship in v1 ([harness guide §13, decision 6][hg13]).

**Choice: strict JSON-RPC 2.0.** Every message carries `"jsonrpc": "2.0"`. Version 1 ships these client methods: `initialize`, `session/create`, `session/open`, `session/list`, `turn/start`, `turn/steer`, `turn/followUp`, `turn/interrupt`, `approval/list`, `session/checkout` and `session/fork` (both behind the `experimental` gate) and the notification `$/cancelRequest`. The server sends three requests: `approval/request`, `clarification/request` and `tool/call`. Events travel as `event` notifications carrying a sequence number, and every turn ends with a `turn/settled` notification.

**Evidence.** To settle the framing, the guide asks whether a generic JSON-RPC client or an MCP-style library needs the field. Both do by specification: JSON-RPC 2.0 requires a `jsonrpc` member of exactly `"2.0"`, and MCP messages are JSON-RPC 2.0 messages ([JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification); [harness guide §8][hg8]). Codex drops the field and gains nothing by it ([harness guide §8][hg8]). N29 still runs the settling test, wrapping our stdio transport with one generic client and with `@modelcontextprotocol/client`'s JSON-RPC layer. The method list covers the guide's sketch plus the session operations the CLI needs; fork and checkout stay experimental until a client other than ours uses them ([harness guide §8][hg8]).

**Note for later work (2026-11-19): a voice front end.** The voice research (U20) found that a voice agent keeps the tool loop and runs it inside a live session, and the owner approved recording what that would ask of the harness (owner decision 2026-11-19; [voice report][u20-changes], change 5). No plan we searched has an agent that speaks, so nothing changes now. A voice front end would drive the harness through `turn/interrupt` when the person cuts in and `turn/steer` for speech that arrives mid-turn. It would also need two things v1 lacks. First, the interrupt would carry how much of the reply the person heard. Second, the log would hold a truncated block, because HD1 writes only completed blocks. Each change would need its own decision, and a protocol addition would ship behind the `experimental` gate first, as [ADR 0016](../decisions/0016-protocol-json-rpc-framing.md) asks of new methods. This note changes neither HD1 nor HD6.

### HD7. Pin semconv-genai `d28355d`, and name cost in our own namespace (with SDK D3)

[SDK D3][sdk-d3] settles the guide's in-memory-field question with four token classes and `totalInput()`.

**Harness side.** The telemetry projection pins `open-telemetry/semantic-conventions-genai` at commit `d28355d`, the HEAD the observability note read on 2026-11-18, and stamps it as the resource attribute `buildanagent.semconv.genai.commit`. The commit constant and the `gen_ai.*` names come from `@buildanagent/sdk/otel` (`SEMCONV_GENAI_COMMIT`, `GEN_AI_ATTRIBUTES`), so the live observer and the log projection share one module. It writes `gen_ai.usage.input_tokens` as `totalInput(usage)` and `gen_ai.usage.output_tokens` as `usage.output`. Our own attributes are `buildanagent.cost.usd` (omitted when `Cost.total` is `null`), `buildanagent.cost.basis` and `buildanagent.usage.cache_read_tokens` and `.cache_write_tokens`. They sit outside `gen_ai.*`, so a future convention cannot collide with them.

**Evidence.** The conventions are Development-only and had no tags on 2026-11-18, so a version means a commit ([harness guide §9][hg9]; [observability note §2][n-obs-2]). OTel's `input_tokens` "SHOULD include cached tokens", and no convention names cost, so the cost attribute is ours to name ([harness guide §9][hg9]). SDK D3 already ran the guide's settling test, writing the projection and the cost fold against both conventions ([SDK plan, D3][sdk-d3]). Cost keeps its `basis`, because Claude calls its costs "client-side estimates, not authoritative billing data" ([harness guide §9][hg9]).

### HD8. A 30-task seed suite of 20 repository and 10 coding-agent tasks, at k = 5 (accepted, amended)

**Accepted by the owner on 2026-11-18.**

**Options.** Which 20–50 real-failure tasks seed the capability suite, at what k, with which resource guarantees and kill limits ([harness guide §13, decision 8][hg13]).

**Choice.** Thirty tasks. Twenty come from this repository's history: each is a commit that fixed a failing `pnpm run verify` or `pnpm test`, recreated at its parent commit and graded by running that same check outside the agent's writable sandbox. N38 runs these twenty. Ten are the agent's classification-slice tasks, so agent decision 6 owns their labels. N38b adds them once the agent's task format (A17) and the owner's labelled tickets (A19) exist, so the harness baseline never waits for Round A. The suite commits task ids and graders; the ticket text stays in the agent's eval package, which holds only synthetic and de-identified tickets (agent AD8). Each task runs k = 5 trials. Each trial gets a guaranteed 2 vCPUs and 4 GiB, a 30-minute kill limit and a $3 cost cap, which is mini-swe-agent's default `cost_limit`. Infra failures record `exit: "infra_error"` and are scored apart. After the first run, the discordance between two runs of the same configuration sets the size of the regression suite.

**Evidence.** Anthropic recommends 20–50 tasks drawn from real failures with outcome graders and a clean environment per trial, and practitioners add that such a suite catches only large regressions ([harness guide §10][hg10]). Public benchmarks are a weak guide, and the durable asset is our own failures ([harness guide §10][hg10]). The repository's commit history holds real failures with a ready grader, which is the check that failed. Lifting resource caps on Terminal-Bench 2.0 cut infra errors from 5.8% to 0.5%, so the guarantee is pinned and recorded ([harness guide §10][hg10]). The $3 cap is mini-swe-agent's default, which keeps the baseline comparison fair ([observability note §6][n-obs-6]). k = 5 matches the agent guide's pass^5 gate ([agent guide §10][ag10]).

**What the owner still supplies.** The budget for each live run, which N37's live script refuses to start without.

**Amended (owner, 2026-11-19; [ADR 0045](../decisions/0045-hd8-coding-agent-eval-tasks.md)):** N38 ships 20 repository tasks; [W12](../todos/ready/W12-coding-agent-eval-tasks.md) adds 10 coding-agent tasks to reach 30 before W8 publishes its baseline. The owner's answer was "20 now, plus coding tasks". When Round A resumes, N38b adds its 10 triage tasks on top of the 30.

### HD9. SDK D9's per-call check, plus a session cap and a pre-checked summary call (with SDK D9)

[SDK D9][sdk-d9] covers the per-call check: the loop stops with `stopReason: "budget"` before the call that would cross `budgetUsd`.

**Harness side.** A session has its own `budgetUsd`. The harness folds the `usage` entries of the session into its spend and passes `budgetUsd: sessionCap − spend` to each `run` and `continueRun`, including the resume inside `Approvals.resolve` (§3.4). The harness makes summary and mid-turn compaction calls with `Model.complete()`, outside the loop. It therefore projects their cost with the SDK's exported `projectCallCost()`, and skips the layer when the projection would cross the cap, leaving the overflow layer as the fallback. [ADR 0009](../decisions/0009-pre-emptive-budget.md) records the session cap as a consequence. Summary calls write `usage` entries with `source: "summary"`. At 80% of the cap the harness emits a `budget_warning` protocol event, and the CLI shows the running total. A session whose spend includes a `Cost.total` of `null` refuses a budgeted turn, as SDK D4 does for a run.

**Evidence.** Loops cause the runaway-cost anecdotes, and practitioners want a running cost with a warning threshold, because quota opacity is the widest-supported complaint in the corpus ([harness guide §9][hg9]). Inspect checks cost limits at each `generate()`, which matches the per-call rule ([harness guide §10][hg10]). The guide's settling test, measuring a post-response check's overshoot on our longest recorded runs, runs in N39 on the runs N38 records.

### HD10. Configured or discovered checks, run in the sandbox after `done`, with flags recorded (provisional)

**Options.** Which project checks run after the model claims completion, how they are discovered, and which diff patterns are flagged ([harness guide §13, decision 10][hg13]).

**Choice.** A project lists its checks in `.agents/harness.json` under `completionChecks`. Without that list, the harness runs the `package.json` scripts `typecheck`, `test` and `check`, in that order, when they exist, and a `Makefile` `test` target otherwise. The checks run inside the session's sandbox after a `done` result. The harness then diffs the workspace against the turn's starting state. It flags added skip markers (`.skip(`, `xit(`, `@pytest.mark.skip`), placeholder strings (`TODO`, `FIXME`, `not implemented`), new files whose names contain `mock`, `stub` or `fake`, deleted test files, and test files with fewer assertion lines than before. The result is a `completion_check` entry. A failed or flagged check does not change the run's stop reason; the CLI shows it, the protocol emits it, and the eval reports count it.

**Evidence.** Agents claim success they did not achieve and game visible tests, so the harness checks completion in code and flags new mocks, stubs, placeholders and skip markers ([harness guide §10][hg10]). Tests, types and linters are the oracle practitioners trust, which makes the project's own scripts the default checks ([harness guide §5][hg5]). The guide's settling test, tuning the flags on recorded false claims, needs recorded runs, so N38 records them and tunes the patterns.

### HD11. Keep transcripts until the owner sets a retention period, and keep the entry base stable (accepted)

**Accepted by the owner on 2026-11-18.**

**Options.** The default retention period, where expired entries go, and which entry fields are documented as stable ([harness guide §13, decision 11][hg13]).

**Choice.** No automatic deletion by default. A `retention` setting takes `{ days, action: "archive" | "purge" }`. `archive` gzips an expired session's files into `archive/` and keeps them searchable; `purge` deletes them. The stable surface is `EntryBase` (`id`, `parentId`, `seq`, `timestamp`, `type`, `origin`), the entry type names and `formatVersion`. Every other field is documented but may change with a `formatVersion` bump, which arrives with a migration that writes a new file (HD2). N2 publishes the JSON Schema at `packages/protocol/schema/session-entry.schema.json`, beside the union (HD13).

**Evidence.** Practitioners treat local transcripts as their system of record, and their named limit is the 30-day purge that matches Claude's `cleanupPeriodDays` default ([harness guide §2][hg2]). The HN synthesis asks for a documented schema, configurable retention and a search and replay CLI ([harness guide §2][hg2]). The guide's settling test needs a month of runs to cost disk; N33 measures the disk cost of the capstone and eval runs instead and reports a projection.

**What the owner still supplies.** A retention period, once a product needs one. Agent AD8 makes the agent's shadow and later stages refuse to start without it ([agent guide §10][ag10]).

**Amendment (owner, 2026-11-19): a memory delete reaches the session log.** The [retrieval and memory report][u18-changes] proposed twelve plan changes, and the owner approved all twelve on 2026-11-19. Change 7 amends this decision, and [ADR 0056](../decisions/0056-file-based-memory-and-log-purge.md) records it beside ADR 0018, which stays as written. The default is unchanged: nothing is deleted automatically. A memory delete (HD17) now also marks every log entry that carries the deleted fact, and a marked entry leaves the log in one of two ways. The retention purge deletes its whole session, as before. A targeted purge removes it sooner: it rewrites the session into a new file, as a `formatVersion` migration does, with each marked entry's content removed and its `EntryBase` kept, so the tree still resolves. An `archive` keeps marked entries until the targeted purge runs. Without the marks, a fact deleted from memory would still sit in the entry that recorded its write. Zep warns that deleted episode data "may still exist" in nodes shared with other episodes, and Claude Code's transcript sweep leaves its memory files alone ([retrieval and memory report][u18-forget]). N52 builds the marks and the targeted purge.

### HD12. Three middle-ground modes, and no classifier allow outside the host callback

**Options.** Path-based ask rules only, grouped approvals, a per-session allowance, and whether a classifier may approve at all ([harness guide §13, decision 12][hg13]).

**Choice: all three middle-ground mechanisms, with classifier allows confined to the host callback.**
- **Path-based ask rules** ship as defaults: edits that delete, skip or weaken tests, and edits to hooks, CI config and rules files.
- **Sticky allowances** are scoped to a run or a session, written as `approval_resolved` entries with `sticky`, and refuse interpreter prefixes (`bash -c`, `sh -lc`, `node -e`, `bun run` and similar) and any pattern containing a secret.
- **Grouped approvals** resolve, in one decision, every pending request of one step that has the same tool and the same canonical input hash; for `bash`, the hash is taken over the normalised command. A group resolution counts as one approver's resolution on each request, so a quorum above one still needs further distinct approvers.
- **Opting out.** A tool that sets `RegisteredTool.approvalReuse: "none"` takes neither sticky nor grouped resolutions, and the pipeline refuses both for it; products set this for every tool a person must see each time.

The pipeline's permission modes are `default`, `accept_edits`, `read_only`, `bypass` and `shadow`. A classifier may only run as a pipeline hook, which can deny or ask but never allow, or as the host callback at the end of the pipeline, whose allows are recorded with `by: "classifier:<id>"`. Whether the agent uses a classifier, and for which tiers, is P3's agent decision 10.

**Evidence.** Codex refuses to persist "always allow" for a whole interpreter, and practitioners found credentials embedded in committed allow rules ([harness guide §5][hg5]). The HN synthesis adds the default path rules and asks the UI to group equivalent calls ([harness guide §5][hg5]). Approval fatigue drives users to run without prompts, and they use Claude's classifier without trusting it, so a classifier allow must stay visible in the log and must never sit ahead of deny rules ([harness guide §5][hg5]). The `shadow` mode is the hook for the agent's R5 (§3.7). The guide's settling test, counting prompts per task under each mode against Anthropic's 84% reduction, runs in N39.

### HD13. Four packages, with one subpath export per removable component

**Options.** (a) One `@buildanagent/harness` package with everything. (b) A package per component, as many as ten. (c) A protocol package, a harness package with subpath exports per component, a CLI package and an evals package.

**Choice: (c).** `@buildanagent/protocol` holds the typed union, the session-entry union it carries, the framing and the generated JSON Schema. Its emitted JavaScript imports nothing at run time, so a client in any language can depend on its schema alone; it declares `@buildanagent/gateway` and `@buildanagent/sdk` as dependencies only for the transcript and pause types. `@buildanagent/harness` depends on it, never the reverse. `@buildanagent/harness` holds the session log, context policy, registry, MCP client, permissions, sandbox, credentials, extensions, telemetry and the dispatcher, each behind its own subpath. `@buildanagent/cli` is the `buildanagent` binary and a client of the in-process transport. `@buildanagent/evals` holds the report builder, the trajectory converter and the offline replay suite; the Inspect task lives beside it in Python.

**Evidence.** The guide defines the protocol package first, and generates TypeScript and JSON Schema from one union, so that clients need nothing else ([harness guide §8][hg8]). The CLI must be a replaceable client, because practitioners blame UI flicker and CPU on a harness apart from its model ([harness guide §8][hg8]). Subpath exports keep each removable component importable, and ablatable, on its own without the cost of ten `package.json` files, the same trade the SDK plan made for adapters ([SDK plan, D1][sdk-d1]).

### HD14. Build the MCP client on `@modelcontextprotocol/client` 2.4.0 (provisional)

**Options.** (a) Our own client over the protocol package's framing. (b) `@modelcontextprotocol/client` 2.4.0. (c) `@ai-sdk/mcp` 2.0.90.

**Choice: (b), behind our `McpConnection` interface.** The registry sees only `McpConnection`, so the base can change without touching it.

**Evidence.** The client must negotiate per server between the 2026-07-28 revision and the legacy era, because mixing eras in one aggregate client drops the fleet to legacy ([harness guide §4][hg4]). The 2.4.0 client's type declarations include the `server/discover` method that the 2026-07-28 revision uses for that probe, although its sibling `@modelcontextprotocol/core` 2.4.0 still names `2025-11-25` its latest version (observed in the installed packages on 2026-11-18; [harness guide §4][hg4]). Version 2.4.0 is Apache-2.0, already in our lockfile through `verify/cloudflare-agents`, and its `@modelcontextprotocol/server` sibling gives the conformance tests a real server. Option (c) would pull in the `ai` package, and option (a) means writing stdio, streamable HTTP, SSE and OAuth transports ourselves. N24 checks that the client probes with `server/discover` and falls back to `initialize` per server; if it does not, N24 adds the probe on our side and records the gap.

**Revision (plan review 2, 2026-11-19): MCP tool definitions are pinned.** N25 no longer re-registers tools silently when a server's tool list changes. N25 pins tool definitions in N22's lock-file format. A new or changed tool starts disabled, is announced in a system message under HD3's append-only rule, and needs an approval before the model can call it. In MCP's 2026-07-28 revision, list-change notifications arrive only on an opt-in `subscriptions/listen` stream, and HTTP+SSE is deprecated, so N25 keeps SSE for legacy servers only ([MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), as of November 2026; [agent connectors report](../research/connectors/agent-connectors.md)).

### HD15. The credential proxy injects on reverse-proxy routes, not by intercepting TLS

**Options.** (a) A TLS-intercepting proxy with a per-session CA that swaps a sentinel for the real credential, as Claude's `mask` mode does. (b) A default-deny `CONNECT` proxy for name filtering, plus local reverse-proxy routes that add credentials.

**Choice: (b).** A tool that needs a credential talks to `http://127.0.0.1:<port>/<route>/…`, and the host-side proxy forwards to the route's HTTPS host, adding the credential header when the sentinel in the request matches and the method is allowed. Everything else leaves only through `CONNECT` to allowlisted names, which resolve outside loopback, link-local and metadata ranges.

**Evidence.** Injection at the egress proxy keeps secrets out of the sandbox, and practitioners scope each injected credential by host and method ([harness guide §6][hg6]). Claude's `mask` degrades to `deny` on macOS and Windows, a sign that TLS interception is the hard part ([harness guide §6][hg6]). `srt` refuses allowed names that resolve to private ranges, and we copy the rule ([harness guide §6][hg6]). A CA inside every sandbox image is work the first consumers do not need, so (a) waits for a tool that cannot take a base URL.

### HD17. Long-term memory is a file-based extension of sourced records that expire unless a check renews them (accepted)

**Accepted by the owner on 2026-11-19.** The [retrieval and memory report][u18-changes] proposed twelve plan changes, and the owner approved all twelve on 2026-11-19. Change 5 is this decision.

**Options.** (a) No long-term memory until an eval failure calls for it, the guide's staged path. (b) A memory service, such as AgentCore Memory or Zep. (c) Files under the project, written through one tool, as Anthropic's memory tool, Claude Code's auto memory and Letta's MemFS do ([retrieval and memory report][u18-file]).

**Choice: (c), as an extension that is off until a host loads it.** N52 builds it.
- **Tool.** One `memory` tool with the commands `view`, `create`, `str_replace`, `delete` and `rename`, over paths under `.agents/memory/` only. The extension resolves every path to its canonical form and refuses one that leaves the directory, because Anthropic's docs warn that "Your implementation must validate every path in every command to prevent directory traversal attacks" ([Claude, memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)). Each call is an ordinary tool call, so each write already appears in the session log as an entry.
- **Records.** One record per durable fact, with a subject, the fact, a source (a `file:line`, a URL or the user's own words), a type (`project`, `task` or `preference`), a created date, a last-validated date, an expiry and a trust level.
- **Recall.** At session start the extension loads an index of one line per record, capped at 200 lines or 25 KB, whichever comes first, as Claude Code caps `MEMORY.md`. The agent finds the rest with the `grep` and `glob` built-ins (N21). A recalled record is a claim about the past, so its `view` result shows its source and last-validated date beside the fact.
- **Forgetting.** A project fact expires 90 days after its last successful validation, a task record expires when its session ends, and a preference lasts until the user changes it. Reading a record never renews it, following Copilot's rule that "Simply retrieving a memory does not reset this period" ([retrieval and memory report][u18-forget]); N52 decides how a successful check renews `validated`. A delete removes the record and its index line in one step, and it marks the log entries that wrote or returned the record (HD11's amendment).
- **Untrusted input.** Once a tool result from a tool whose `outputTrust` is `"untrusted"` enters a session, every memory write in that session is stored as low-trust. A low-trust record expires before any trusted record of its type, at a period N52 sets, and the index labels it. The memory tool cannot write procedural memory, meaning skills, context files and rules, because its paths stay inside `.agents/memory/`. This is the memory side of the untrusted-source decision that [plan review 2](reviews/plan-review-2.md#6-eleven-owner-actions-are-still-open-and-only-one-a-test-project-for-n50-touches-waves-15) proposes as HD16, and the owner approved widening HD16's scope to it on 2026-11-19. HD16, once decided, applies the same rule to `write` and `edit` on procedural paths.

**Evidence.** Long inputs degrade well before the window, so an agent should carry a small core and search for the rest ([retrieval and memory report][u18]). MINJA planted records in memory through queries alone, and later sessions obeyed them in 76.8% of attempts, which is why writes carry a source and a trust level ([retrieval and memory report][u18]). Copilot checks a memory's citations before using it and expires memories after 90 days by default ([retrieval and memory report][u18-recall]). A file store also gives rollback through git history and needs no index for a few hundred records. None of our eight SDKs expires a memory inside the process, so the expiry belongs in our harness ([retrieval and memory report][u18-sdks]).

## 3. Package and module layout

### 3.1 Four packages under `packages/`, beside the SDK's two

The SDK plan puts our code in `packages/` and expects P2 to add the harness there ([SDK plan §3.1][sdk31]). N1 adds four packages; `pnpm-workspace.yaml` already gains `packages/*` in B1.

```text
packages/
  protocol/                     @buildanagent/protocol   (types from gateway and sdk; no runtime imports)
    src/entries.ts              SessionEntry, EntryBase, Origin (the harness re-exports them from ./session)
    src/messages.ts             ClientCommand, ServerRequest, ServerNotification, Response, errors
    src/framing.ts              JsonlFramer (splits on \n only), encode(), decode()
    schema/protocol.schema.json generated from messages.ts and committed
    schema/session-entry.schema.json generated from entries.ts and committed
  harness/                      @buildanagent/harness
    package.json                exports: ".", "./session", "./session/jsonl", "./context", "./context/file", "./tools", "./mcp",
                                "./permissions", "./sandbox", "./sandbox/srt", "./sandbox/docker",
                                "./credentials", "./extensions", "./memory", "./telemetry", "./server",
                                "./ablation", "./testing"
    src/session/                SessionStore (memory, jsonl), SessionLock, runner, rebuild, replay
    src/context/                write cap, masking, summarizer, mid-turn, overflow retry, policy composer
    src/tools/                  ToolRegistry, tool search, built-ins (read, write, edit, bash, fetch, grep, glob)
    src/mcp/                    McpConnection, per-server negotiation, McpManager
    src/permissions/            rules, PermissionPipeline, approvals, code-initiated calls, KeyStore, sticky allowances
    src/sandbox/                SandboxClient, none backend, spawnEnv, escalation; srt/ and docker/
    src/credentials/            EgressProxy, sentinel routes, proxiedFetch, secret scrubber
    src/extensions/             Extension, composition, TrustStore, extensions.lock.json, skills, context files
    src/memory/                 memory extension: the memory tool, records, index, expiry, purge marks (HD17)
    src/telemetry/              projectSpans(), harness attribute names, budget meter
    src/completion/             completion checks and diff flags
    src/server/                 Dispatcher, inProcessTransport(), stdioTransport()
    src/ablation.ts             AblationConfig and its hash
    src/testing/                fakeSandbox(), memoryStore(), scriptedClient(), conformance suites
  cli/                          @buildanagent/cli        bin: buildanagent
  evals/                        @buildanagent/evals      (private)
    src/                        reports, mini-swe-agent trajectories, offline replay suite
    inspect/                    harness_task.py, requirements.txt (Python, outside pnpm)
```

**Dependencies.** `protocol` depends on `@buildanagent/gateway` and `@buildanagent/sdk` (`workspace:*`) for types only. N26 checks that its emitted JavaScript imports neither. pnpm resolves a type import only from a declared dependency, so the dependency is declared even though nothing loads at run time ([AGENTS.md "Workspace layout"](../../AGENTS.md#coding-standards)). `harness` depends on `@buildanagent/sdk`, `@buildanagent/gateway` and `@buildanagent/protocol` (`workspace:*`), and on `@modelcontextprotocol/client` 2.4.0 (HD14). The `srt` and Docker backends spawn the `srt` and `docker` binaries and add no npm dependency; N16 records which `srt` release it was tested against. `cli` depends on `harness` and, for the optional OTLP exporter, on `@opentelemetry/exporter-trace-otlp-http` 0.223.2 and `@opentelemetry/sdk-trace` 2.12.1, both already in the lockfile; the exporter itself depends on `sdk-trace` 2.12.1. *(Revision, plan review 2, 2026-11-19: the plan first named `@opentelemetry/sdk-trace-base` 2.12.0, which npm marks deprecated in favour of `sdk-trace`, as of November 2026.)* Dev dependencies: `@modelcontextprotocol/server` 2.4.0 for MCP tests and a JSON Schema generator that N26 pins. Every new pin follows [AGENTS.md "Versions"](../../AGENTS.md#coding-standards).

**Tooling.** The same as the SDK's: ESM, `tsconfig.base.json`, Vitest ([ADR 0046](../decisions/0046-vitest-test-runner.md)), `typecheck` and `test` scripts picked up by the root ([SDK plan §3.1][sdk31]). The Python Inspect task has its own `requirements.txt` with exact pins and runs only in the opt-in eval job.

### 3.2 Session log API

Every type below uses the SDK plan's names unchanged. `ContentBlock`, `ModelContent`, `ModelRef`, `Usage` and `Cost` come from `@buildanagent/gateway`, and `SignedPendingRequest`, `Resolution`, `RunResult` and `Context` from `@buildanagent/sdk`, which re-exports the first two from `@buildanagent/agent-safety` ([ADR 0043](../decisions/0043-standalone-safety-core.md)). The entry union lives in `@buildanagent/protocol` (HD13), and the harness re-exports it. Revisions of the [guide's sketch][hg12] are marked.

```ts
// @buildanagent/protocol entries, re-exported by @buildanagent/harness/session (guide §2; HD1, HD2, HD11, HD13)
type Origin = "user" | "operator" | "model" | "tool" | "harness";   // R3 hook (§3.7); one label per block entry
interface EntryBase { id: string; parentId: string | null; seq: number; timestamp: string; origin: Origin }
type SessionEntry = EntryBase & (
  | { type: "session_header"; formatVersion: 1; harnessVersion: string; sdkVersion: string;
      defaultsHash: string; capabilities: string[]; ablationHash: string; parent?: { session: string; entryId: string };
      product?: { name: string; version: string; bundleHash: string } }     // Revision (agent AH8): the product's stamp
  | { type: "turn_start"; runId: string; mode: "run" | "continue"; system: string } // Revision (R6): the frozen prompt, byte for byte
  | { type: "message_block"; messageId: string; role: "user" | "assistant"; index: number; block: ContentBlock;
      delivery?: "input" | "steer" | "follow_up" }                       // Revision: one entry per block (HD1)
  | { type: "message_end"; messageId: string; model: ModelRef; stopReason: AssistantMessage["stopReason"];
      error?: AssistantMessage["error"] }
  | { type: "tool_result"; callId: string; tool: string; content: ModelContent[]; isError: boolean;
      details?: unknown; spill?: { path: string; bytes: number };
      trust: "trusted" | "untrusted" }                                   // Revision: ModelContent[]; trust from RegisteredTool.outputTrust (agent AH10)
  | { type: "code_call"; callId: string; tool: string; input: unknown; inputHash: string } // Revision (R3): a call code chose, no model step (N40)
  | { type: "permission_decision"; callId: string; tool: string; decision: "allow" | "deny" | "ask";
      rule?: string; by?: string; policyVersion: string; inputHash: string }   // Revision (agent AH9): one per decide()
  | { type: "usage"; source: "model_call" | "summary" | "judge"; usage: Usage; cost: Cost } // Revision: SDK Cost, total may be null
  | { type: "turn_end"; runId: string; stopReason: RunResult<unknown>["stopReason"]; steps: number }
  | { type: "checkout"; headId: string }                                  // persisted HEAD (guide decision 2)
  | { type: "compaction"; layer: "summarize" | "mid_turn" | "overflow_retry"; summary: string;
      firstKeptEntryId: string; tokensBefore: number; tokensAfter: number; model: ModelRef;
      promptVersion: string; usageEntryId: string; focus?: string }
  | { type: "approval_requested"; request: SignedPendingRequest; input: unknown } // Revision: the SDK record, unchanged, and the input the resume needs
  | { type: "approval_resolved"; resolution: Resolution; sticky?: "run" | "session"; groupId?: string;
      allowance?: { tool: string; inputHash?: string; commandPrefix?: string[] } }   // built in N14: what a sticky allowance matches
  | { type: "env_stamp"; cwd: string; permissionMode: PermissionMode; approvalPolicy: ApprovalPolicy;
      sandbox: SandboxClient["tier"]; model: ModelRef; effort?: string }
  | { type: "loadout"; tools: string[]; model?: ModelRef; effort?: string }   // tool-loadout and model changes
  | { type: "completion_check"; checks: Array<{ command: string; exitCode: number }>; passed: boolean; flagged: string[] }
  | { type: "skill_loaded"; name: string; path: string }
  | { type: "extension_loaded"; name: string; tier: "in_process" | "mcp" | "skill"; contentHash: string }
  | { type: "subagent_link"; childSession: string; spawningCallId?: string; stepId?: string } // Revision (agent AH3): one of the two
  | { type: "shadow_call"; callId: string; tool: string; inputHash: string }  // R5 hook (§3.7)
  | { type: "product_record"; name: string; data: unknown }   // Revision (agent AH8): name is namespaced ("triage.record");
);                                                            // data sits outside HD11's stable surface

interface SessionKey { readonly userId: string; readonly sessionId: string }   // revision (N3, owner amendment 2026-11-19): no lookup by id alone
type EntryInput = Omit<SessionEntry, "seq">;                  // revision (N3): the store assigns seq; Omit applies to each variant of the union, so the type keeps its discriminant
interface SessionStore {                                      // revision (N3): keyed by user and session
  append(key: SessionKey, entries: EntryInput[], options?: { expectedLastId?: string | null }): Promise<SessionEntry[]>; // idempotent by id; returns the stored entries
  load(key: SessionKey, options?: { fromSeq?: number; onTornLine?: (line: { bytes: number }) => void }): AsyncIterable<SessionEntry>; // skips a torn last line and reports it once
  list(userId: string): AsyncIterable<SessionSummary>;
  delete(key: SessionKey): Promise<void>;
}
declare function memoryStore(options?: { maxEntryBytes?: number }): SessionStore;      // @buildanagent/harness/session
declare function jsonlStore(options: { dir: string; maxEntryBytes?: number }): SessionStore; // @buildanagent/harness/session/jsonl, Node only; default 64 KiB, larger is an EntryTooLargeError
interface SessionLock { acquire(key: SessionKey): Promise<LockHandle | "would_block"> }    // HD2; keyed like the store (N3)
interface LockHandle { readonly token: string; held(): boolean; release(): Promise<void> } // revision (N4): held() turns false when a renewal finds another token
declare function fileLock(options: { dir: string; leaseMs?: number; renewMs?: number }): SessionLock; // @buildanagent/harness/session/jsonl, Node and local disk only
declare function unlockSession(options: { dir: string }, key: SessionKey): Promise<LockRecord | "unreadable" | undefined>; // revision (N4): the library behind `session unlock --force`

interface Session {
  readonly key: SessionKey;
  head(): string | null;                                     // the entry id HEAD points at; null before the first entry (revision N5)
  append(entries: EntryInput[]): Promise<SessionEntry[]>;    // revision (N5): extends the current file under the writer lock and moves HEAD
  path(headId?: string): Promise<SessionEntry[]>;            // root → head, following parentId
  checkout(entryId: string): Promise<void>;                  // appends a checkout entry
  fork(entryId: string): Promise<Session>;                   // a new file whose header names the parent prefix
  child(link: { spawningCallId: string } | { stepId: string }): Promise<Session>; // Revision (agent AH3): a subagent's or a workflow step's log
  revert(entryId: string): Promise<Session>;                 // a new immutable file; moves the pointer
  toContext(headId?: string): Promise<Context>;              // rebuild the SDK Context from entries (§3.6, item 6)
  playback(): AsyncIterable<SessionEntry>;                   // no model or tool calls
  // built in N7 as `rerunFrom(session, harness, entryId, options)` beside runTurn, because a re-run needs the harness
  rerunFrom(entryId: string, options: TurnOptions): Promise<TurnResult>; // branches, then calls the model again
}
declare function openSession(options: { store: SessionStore; index: SessionIndex; key: SessionKey; lock?: SessionLock }): Promise<Session>; // revision (N3, N5): the key names the user; with a lock the session writes, without one it only reads
interface SessionIndex { get(key: SessionKey): Promise<string | undefined>; set(key: SessionKey, file: string): Promise<void> } // revision (N5): the one mutable pointer, to the session's current file; memoryIndex() keeps it in memory, and fileIndex({ dir }) replaces its file by rename
declare function migrateSession(options: { store: SessionStore; index: SessionIndex; key: SessionKey; lock: SessionLock; migrations: Migration[] }): Promise<MigrationResult>; // revision (N5): takes the writer lock, then writes, verifies and publishes a new file
```

**Amended by the owner on 2026-11-19 ("yes, i accept these"): every session lookup takes the user.** The book's Chapter 5 found that a session id finds a session but proves nothing about who may open it, and that of our eight SDKs only ADK's `getSession` scopes a lookup by user ([Chapter 5, "A session id finds a session; your server decides whose it is"](../../apps/manual/src/content/chapters/memory-and-sessions.md)). So `SessionStore` keys each session by its user and its id: `append`, `load` and `delete` take both, `list` takes the user, and a session under another user looks exactly like a missing one. No method finds a session by its id alone, so no caller can forget the owner check. [N3](../todos/done/N3-session-store.md) built the store that way and updated the sketch above. N3 also settled the open point: `openSession({ key })` and `SessionLock.acquire(key)` take the same `{ userId, sessionId }`, so neither an open nor a lock can reach another user's session.

The session runner turns SDK events into entries. It is an `Observer` that the harness passes in `RunOptions.observers`, and it appends inside the same lock:

```ts
interface TurnOptions<H = unknown> {
  input: string | ContentBlock[];
  inputOrigin?: "user" | "operator";        // Revision (R7): origin of the input blocks; default "user"
  budgetUsd?: number;                       // session cap; the runner passes the remainder (HD9)
  signal?: AbortSignal;
  hostContext?: H;                          // Revision (agent AH2): per turn; reaches execute, never a schema or the log. Follow-up (B23): N6 and N11 pass it as RunOptions.app, which tools read as ctx.app, instead of binding it in a ToolWrapper
  system?: string; tools?: string[];        // Revision (agent AH1): per-turn settings; tools is an allowlist of registered names
  output?: ToolDefinition<any, any>; model?: Model; maxSteps?: number; modelOptions?: StreamOptions;
  turnRetries?: number; onRun?: (run: Run<unknown>) => void;   // built in N6: onRun hands the caller the run, to steer it
  history?: Message[];                      // built in N7: left out, runTurn rebuilds it from the log
  clock?: Clock; newId?: () => string;      // built in N7: the same bytes twice, for a determinism test
}
type TurnResult = RunResult<unknown> & { sessionKey: string; lastEntryId: string };
declare function runTurn<H>(session: Session, harness: Harness<H>, options: TurnOptions<H>): Promise<TurnResult>;
// writes the input message_block entries durably before the first model call (guide §2), labelled inputOrigin,
// then turn_start with the system prompt, block entries on model_call_end, tool_result on tool_call_end, usage, turn_end.
```

**Revision (plan review 2, 2026-11-19): the effect scope's tenant.** [E2](../todos/done/E2-effect-identity-crash-rule.md)'s `EffectScope` needs a `tenant`, and the key hashes it. The harness reads `tenant` from its config as a plain string, with the default `"local"` for single-user hosts, and the N7 and N40 revisions pass it with the session key, the branch and the tool call id. A multi-user host sets one tenant per user, as SG3 scopes business keys.

**Revision (2026-11-18): `Scheduler`.** Off-host hosts cannot keep a timer alive between requests, so todo N41 adds one seam beside `SessionStore` and `SessionLock` ([storage-and-wake note](../research/deployment/storage-and-wake.md)):

```ts
interface Scheduler { wake(at: Date, sessionId: string): Promise<void>; cancel(sessionId: string): Promise<void> } // at-least-once
declare function processScheduler(): Scheduler; // local default; DO alarms, EventBridge Scheduler and Workflow sleep in N46a–N48a
```

### 3.3 Context policy and tool registry APIs

**Revision (N10, 2026-11-22): layers 4 and 5.** `ContextPolicyOptions.midTurnRatio` (0.9) sets the share of the window at which a turn compacts mid-turn. `layers.mid_turn` defaults to on below a 128K window, and `layers.overflow_retry` to on. `TurnContext.attach({ append, settle })` hands the turn's writer to the mid-turn layer once it exists. `TurnContext.onOverflow({ path, append, signal })` replaces the planned `ContextPolicy.onOverflow(result, session)`: `runTurn()` calls it after a run ends with `error.kind: "overflow"` and goes on with `continueRun()`. The policy's interceptors now run before the harness's own and the permission gate, so the policy indexes the run's transcript and a harness `afterToolCall` hook sees a capped result.

**Revision (N9, 2026-11-22): the summary layer's options.** `summarize` takes `model`, `focus`, `tailTokens` (20,000), `toolOutputChars` (2,000), `maxOutputTokens` (4,096) and `capUsd`. The harness has no session-wide cap yet, so `capUsd` is the cap the projected summary cost is checked against. `hooks.beforeCompact` receives `{ span, tokens, focus? }`. `ContextPolicyOptions.log` reports each compaction and each skipped one. `TurnContext.compact({ path, append, signal? })` runs between turns, and `contextOf()` applies the latest `compaction`.

**Revision (N8, 2026-11-22): the policy is built once and starts per turn.** A harness serves many sessions, so `createContextPolicy(options)` takes no session. `forTurn()` binds the policy to one session and model, and returns the turn's interceptors, its spill lookup and its fill. The write cap counts the log's JSON-escaped bytes and keeps 1 KiB for the entry's own fields, so a capped entry fits the 64 KiB entry bound.

```ts
// @buildanagent/harness/context (guide §3; HD3, HD9)
type LayerName = "write_cap" | "mask" | "summarize" | "mid_turn" | "overflow_retry";
interface SpillStore { write(key: SessionKey, callId: string, text: string): Promise<string> }   // N8: fileSpillStore() is Node only, in "./context/file"
interface ContextPolicyOptions {
  spill?: SpillStore;                       // N8: required while the write_cap layer is on
  budgetTokens?: number;                    // default min(window − 16,384, 200,000)
  writeCapBytes?: number;                   // 64 KiB of the log's bytes: JSON-escaped, with 1 KiB left for the entry's own fields (N8)
  mask?: { keepChars: number; stepMessages: number };      // 500, 8
  summarize?: { tailTokens: number; toolOutputChars: number; model?: Model; focus?: string }; // 20,000, 2,000
  midTurnRatio?: number;                    // 0.9; layer off for windows ≥ 128K unless set
  layers?: Partial<Record<LayerName, boolean>>;
  hooks?: { beforeCompact?(e: CompactEvent): Promise<{ summary?: string } | void>; afterCompact?(e: CompactionEntry): Promise<void> };
}
interface ContextPolicy { forTurn(turn: { session: Session; model: Model; onFill?(fill: ContextFill): void }): TurnContext }   // N8
interface TurnContext {
  interceptors: Pick<Interceptors, "transformContext" | "afterToolCall">;  // layers 2–4 and layer 1
  spillOf(callId: string): { path: string; bytes: number } | undefined;   // fills tool_result.spill
  onOverflow(result: RunResult<unknown>, session: Session): Promise<Context | undefined>; // layer 5: one retry (N10)
  fill(): { tokens: number; budget: number; window: number };            // shown by the CLI
}
declare function createContextPolicy(options?: ContextPolicyOptions): ContextPolicy;   // HarnessOptions.context; one per harness

// @buildanagent/harness/tools (guide §4)
type ToolSource = "builtin" | "extension" | `mcp:${string}` | "client";
type HostPattern = "in_process" | "client_request";       // the third pattern is deferred (§1)
interface RegisteredTool {
  canonicalName: string; name: string; alias?: string; source: ToolSource; pattern: HostPattern;
  exposure: "direct" | "deferred" | "hidden";             // written to ToolDefinition.exposure
  outputTrust?: "trusted" | "untrusted";                  // Revision (agent AH10): default "untrusted" for mcp:*, else "trusted"; revision (U19, 2026-11-19): also "untrusted" for any tool that calls a remote agent
  approvalReuse?: "sticky" | "group" | "both" | "none";   // Revision (R8): default "both"; "none" refuses sticky and grouped resolutions
  remoteAgent?: boolean;                                  // revision (N11): marks a tool that calls a remote agent, so its output defaults to "untrusted"
  definition: ToolDefinition<any, any>;
}
interface ToolRegistry {
  register(tool: Omit<RegisteredTool, "canonicalName"> & { name: string; override?: boolean }): RegisteredTool;
  // throws DuplicateToolError; an MCP collision gets a deterministic suffix; replacing a built-in needs override: true
  setExposure(source: ToolSource, exposure: RegisteredTool["exposure"]): void;    // MCP defaults to "deferred"
  definitions<H>(wrap: ToolWrapper<H>, hostContext: H): ToolDefinition<any, any>[]; // per turn, for RunOptions.tools
  activeTools(activated: ReadonlySet<string>): string[];                         // the registry's own tools a request sends; revision (N11): toolSearchInterceptors() builds its list from the request, so a tool from outside the registry stays in it
  preambleTokens(options?: { system?: string }): number;                         // printed at session start; revision (N11): no model, the estimate is character-based
}
type ToolWrapper<H = unknown> = (tool: RegisteredTool, hostContext: H) => ToolDefinition<any, any>; // write cap, shadow mode, sandbox binding; the turn's host context
declare function toolSearchTool(registry: ToolRegistry, options: { activated: Set<string>; maxResults?: number }): ToolDefinition<{ query: string }, { activated: string[] }>; // revision (N11): the caller owns the activated set
declare function toolSearchInterceptors(registry: ToolRegistry, activated: ReadonlySet<string>): Interceptors; // sends the run's tools plus the activated ones
declare function builtinTools(sandbox: Sandbox, proxy?: EgressProxy): RegisteredTool[];  // read, write, edit, bash, fetch, grep, glob

// @buildanagent/harness/mcp (guide §4; HD14)
interface McpServerConfig {
  name: string; transport: { kind: "stdio"; command: string; args: string[]; env?: string[] } | { kind: "http"; url: string };
  exposure?: RegisteredTool["exposure"]; trusted?: boolean;   // project-supplied servers need project trust (guide §7)
}
interface McpConnection { readonly era: "2026-07-28" | "legacy"; listTools(): Promise<McpTool[]>; callTool(name: string, args: unknown, signal: AbortSignal): Promise<ModelContent[]>; close(): Promise<void> }
declare function createMcpManager(options: { servers: McpServerConfig[]; registry: ToolRegistry; directWaitMs?: number }): McpManager; // 10,000 ms
```

**Revision (2026-11-19): a tool that calls a remote agent defaults to untrusted output.** The A2A research (U19) found that a remote agent's card and replies are untrusted input: in 2026's measurements, LLM judges caught manipulated Agent Cards with recall as low as 25.8% ([A2A report][u19-sec]). The owner approved its change 4 on 2026-11-19 (owner decision 2026-11-19), so any registered tool that calls a remote agent takes `outputTrust: "untrusted"` by default, as an `mcp:*` tool does, whether it speaks A2A or another agent protocol. Its results then carry the taint that HD16, once decided, attaches to MCP output. The registry cannot tell from `ToolSource` alone that a tool calls a remote agent. In our reading, N11 needs either a source such as `` `agent:${string}` `` or a flag the registering code sets, and N11 chooses between them.

### 3.4 Permission, approval and sandbox APIs

```ts
// @buildanagent/harness/permissions (guide §5; HD5, HD12)
type PermissionMode = "default" | "accept_edits" | "read_only" | "bypass" | "shadow";
interface Rule { tool: string | RegExp; paths?: string[]; commandPrefix?: string[]; reason?: string }
interface ToolCall { callId: string; tool: string; input: unknown; initiator: "model" | "code" }   // Revision (agent AH5)
interface PolicyContext {                   // Revision (agent AH5)
  session: Session; hostContext: unknown; entries: readonly SessionEntry[]; mode: PermissionMode; policyVersion: string;
}
type PermissionHook = (call: ToolCall, ctx: PolicyContext) =>
  Promise<{ decision: "deny" | "ask"; reason: string; rule?: string } | undefined>;  // cannot allow, by type
interface PermissionConfig {
  mode: PermissionMode;
  hooks?: PermissionHook[];                 // may deny or ask, never allow; R4's cross-run limits live in a hook (§3.7)
  deny?: Rule[]; ask?: Rule[]; allow?: Rule[];
  hostCallback?: (call: ToolCall, ctx: PolicyContext) => Promise<Decision>;
  interactive: boolean;                     // no match: ask when true, deny when false
  policyVersion: string;                    // signed into every ask (SDK D5 payload)
}
type Decision = { decision: "allow" | "deny" | "ask"; reason: string; rule?: string; by?: string };
interface PermissionPipeline {
  decide(call: ToolCall, ctx: PolicyContext): Promise<Decision>;   // writes one permission_decision entry per call
  gate(): Pick<Interceptors, "beforeToolCall">;   // maps Decision to GateDecision; "ask" carries policyVersion
}
declare function createPermissionPipeline(config: PermissionConfig, registry: ToolRegistry): PermissionPipeline;
// throws PermissionConfigError only when an allow rule makes hostCallback unreachable for a registered tool;
// deny rules, hooks and a host callback with no allow rules start cleanly
declare const defaultAskRules: Rule[];      // test deletions and skips, hooks, CI config, rules files (HD12)

interface KeyStore { load(): Promise<{ keys: Record<string, Uint8Array>; current: string }>; rotate?(): Promise<string>; prune?(inUse: Set<string>): Promise<string[]> }
// Revision (plan review 2): rotate and prune are optional, so a read-only secret can back the ring (ADR 0035; N42)
declare function fileKeyStore(path?: string): KeyStore;   // default $XDG_STATE_HOME/buildanagent/keys.json, mode 0600
interface ResolveOptions<H = unknown> {   // Revision (R9): the resume path takes the same budget and signal as a turn
  sticky?: "run" | "session"; group?: boolean;   // refused for a tool whose approvalReuse forbids it (R8)
  budgetUsd?: number; signal?: AbortSignal; hostContext?: H;
}
interface Approvals {
  pending(session: Session): Promise<PendingApproval[]>;                       // unresolved approval_requested entries, built in N13 as { request, input }
  resolve(session: Session, resolutions: Resolution[], options?: ResolveOptions): Promise<TurnResult | CodeCallResult>;
  // appends approval_resolved, re-runs the pipeline on each allow (deny wins), then continueRun(context, { resolutions,
  // signer, budgetUsd, signal }); a request that answers a code_call entry runs the tool itself, with no model step (N40)
  // The host fills Resolution.by only after it has authenticated the approver.
  quorum?: QuorumPolicy;                   // R1 hook (§3.7); default: one resolution decides
}
interface QuorumPolicy {                   // Revision (R10)
  evaluate(request: SignedPendingRequest, resolutions: Resolution[]): Promise<"met" | "pending" | "rejected" | "expired">;
}

// Code-initiated calls (agent AH4; N40): a side effect that code chooses, through the same pipeline
type CodeCallResult =
  | { status: "done"; callId: string; result: ToolResult<unknown>; entryId: string }
  | { status: "denied"; callId: string; reason: string; entryId: string }
  | { status: "awaiting_approval"; callId: string; pending: SignedPendingRequest };
// Harness.invokeTool(session, { tool, input, hostContext }) writes code_call, runs decide() with initiator "code",
// then a tool_result on allow or deny, or an approval_requested entry signed with createPendingRequest() on ask.

// @buildanagent/harness/sandbox (guide §6; HD4)
interface SandboxPolicy { readRoots: string[]; writeRoots: string[]; network: { allow: string[]; deny: string[] } }
type ApprovalPolicy = "on-request" | "granular" | "never";
interface SandboxClient {
  readonly tier: "none" | "os" | "container" | "gvisor" | "microvm";
  readonly stops: ReadonlyArray<"mistakes" | "exfiltration" | "hostile_process">;
  provision(manifest: WorkspaceManifest, policy: SandboxPolicy): Promise<Sandbox>;  // throws SandboxUnavailableError
}
interface Sandbox {
  exec(command: string[], options: { cwd?: string; env: Record<string, string>; signal: AbortSignal; timeoutMs?: number }): Promise<ExecResult>;
  readFile(path: string): Promise<Uint8Array>; writeFile(path: string, data: Uint8Array): Promise<void>;
  dispose(): Promise<void>;
}
type ExecResult = { exitCode: number; stdout: string; stderr: string } | { denied: SandboxDenial };
declare function noneSandbox(options: { unsafe: true }): SandboxClient;
declare function srtSandbox(options?: { binary?: string }): SandboxClient;        // ./sandbox/srt
declare function dockerSandbox(options: { image: string; cpus?: number; memoryMb?: number }): SandboxClient; // ./sandbox/docker
declare function spawnEnv(allow: string[], extra?: Record<string, string>): Record<string, string>; // PATH, temp HOME, TMPDIR, LANG
declare function escalation(options: { approvalPolicy: ApprovalPolicy; approvals: Approvals }): EscalationMachine;
// states: sandboxed → denied → (never: return denial to the model) | (on-request: approval_requested → approved → rerun once with widened policy)

// @buildanagent/harness/credentials (guide §6; HD15)
interface CredentialRoute { route: string; host: string; methods: string[]; header: string; secret: () => Promise<string> }
interface EgressProxy {
  readonly url: string;                                  // given to the sandbox as HTTP(S)_PROXY
  readonly sentinels: Record<string, string>;            // route → placeholder token the sandbox sees
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;   // in-process tools use this, same allowlist
  close(): Promise<void>;
}
declare function startEgressProxy(options: { allow: string[]; routes?: CredentialRoute[]; log: (r: EgressRecord) => void }): Promise<EgressProxy>;
declare function scrubSecrets(entry: SessionEntry, secrets: readonly string[]): SessionEntry; // applied before every append
```

**Revision (2026-11-18): remote backends.** Todo N43 extends `SandboxClient` with `resume(id)`, `snapshot` and `pause` capability flags, `stops` computed from the applied policy and a post-provision policy read-back, and replaces the proxy URL with an `EgressPolicy { allow, routes }` that each backend compiles: the HD15 proxy locally, `outboundByHost` on Cloudflare, egress Secrets on E2B and the firewall `transform` on Vercel, where `subnets.allow` is banned ([portable agents report](../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first)). N42 makes `KeyStore.rotate()` and `prune()` optional, as ADR 0035 decides. *(Revision, plan review 2, 2026-11-19: `@cloudflare/sandbox` 1.0 removed `outboundByHost` and `allowedHosts`, so N46b targets the Durable Object Container API's `interceptOutboundHttp()` and `interceptOutboundHttps()`. Its HTTPS design waits for N50 and the owner's decision on ADR 0020's "no TLS interception".)*

### 3.5 Extension, protocol, telemetry, eval and ablation APIs

```ts
// @buildanagent/harness/extensions (guide §7)
type Composition = "notify" | "chain" | "gate" | "last_override";
interface Extension {
  name: string; version: string;
  interceptors?: Partial<Interceptors>;   // composed: transformContext/afterToolCall chain, beforeToolCall gate
                                          // (first deny wins, any ask asks), afterModelCall last_override,
                                          // beforeModelCall chain, shouldStop: any stop wins
  observers?: Observer[];                 // notify
  tools?: Array<Omit<RegisteredTool, "canonicalName" | "source"> & { name: string; override?: boolean }>;
}
declare function composeExtensions(extensions: Extension[]): { interceptors: Interceptors; observers: Observer[] };
interface TrustStore { isTrusted(projectRoot: string): Promise<boolean>; trust(projectRoot: string): Promise<void> }
declare function loadProjectExtensions(root: string, options: { trust: TrustStore; headless: boolean; lockFile?: string }): Promise<Extension[]>;
// headless and untrusted: skip; a content hash that differs from extensions.lock.json refuses the load
declare function discoverSkills(cwd: string): Promise<Array<{ name: string; description: string; path: string }>>; // .agents/skills up to the repo root
declare function contextFiles(cwd: string): Promise<Array<{ path: string; text: string }>>;  // AGENTS.md, CLAUDE.md; outside the trust gate, labelled untrusted

// @buildanagent/harness/memory (HD17; N52)
interface MemoryRecord {
  subject: string; fact: string; source: string; type: "project" | "task" | "preference";
  created: string; validated: string; expires: string | null; trust: "trusted" | "low";  // ISO dates; null: until changed
}
declare function memoryExtension(options: { root: string; clock?: () => Date }): Extension;  // .agents/memory/ under root; the memory tool and the session-start index

// @buildanagent/protocol (guide §8; HD6)
type Id = number | string;
type ClientCommand =
  | { jsonrpc: "2.0"; id: Id; method: "initialize"; params: { clientInfo: { name: string; version: string }; capabilities: string[] } }
  | { jsonrpc: "2.0"; id: Id; method: "session/create" | "session/open"; params: { session?: string; cwd: string } }
  | { jsonrpc: "2.0"; id: Id; method: "session/list"; params: { cursor?: string } }
  | { jsonrpc: "2.0"; id: Id; method: "turn/start"; params: { session: string; input: ContentBlock[] }; trace?: string }
  | { jsonrpc: "2.0"; id: Id; method: "turn/steer" | "turn/followUp"; params: { session: string; input: ContentBlock[] } }
  | { jsonrpc: "2.0"; id: Id; method: "turn/interrupt"; params: { session: string; reason?: string } }
  | { jsonrpc: "2.0"; id: Id; method: "approval/list"; params: { session: string } }
  | { jsonrpc: "2.0"; id: Id; method: "session/checkout" | "session/fork"; params: { session: string; entryId: string } } // experimental
  | { jsonrpc: "2.0"; method: "$/cancelRequest"; params: { id: Id } };
interface InitializeResult {
  serverInfo: { name: string; version: string; sdkVersion: string; specVersion: "v1" };
  capabilities: string[];                         // from run_start.capabilities plus harness capabilities
  experimental: string[];                         // methods the client must opt into
  pending: Array<{ session: string; request: SignedPendingRequest }>;  // re-armed by a joining client
}
type Disposition = { accepted: true; turn: string } | { accepted: false; reason: "busy" | "locked" | "invalid" };
type ServerRequest =
  | { jsonrpc: "2.0"; id: string; method: "approval/request"; params: { session: string; request: SignedPendingRequest; group?: string[] } }
  | { jsonrpc: "2.0"; id: string; method: "clarification/request"; params: { session: string; request: SignedPendingRequest } }
  | { jsonrpc: "2.0"; id: string; method: "tool/call"; params: { session: string; callId: string; tool: string; input: unknown } };
type ServerNotification =
  | { jsonrpc: "2.0"; method: "event"; params: { session: string; seq: number; event: AgentEvent | HarnessEvent } }
  | { jsonrpc: "2.0"; method: "turn/settled"; params: { session: string; turn: string; result: TurnResultSummary } };
type HarnessEvent =
  | { type: "entry_appended"; entry: SessionEntry }
  | { type: "budget_warning"; spentUsd: number; capUsd: number }
  | { type: "context_fill"; tokens: number; budget: number }
  | { type: "completion_check"; entry: SessionEntry };
declare const ErrorCodes: { readonly QueueFull: -32001; readonly SessionLocked: -32002; readonly NotOptedIn: -32003 };
declare class JsonlFramer { push(chunk: Uint8Array): unknown[]; }   // \n only; never Node readline (U+2028)

// @buildanagent/harness/server
interface Harness<H = unknown> {
  registry: ToolRegistry; pipeline: PermissionPipeline; context: ContextPolicy; sandbox: SandboxClient; model: Model;
  approvals: Approvals;
  invokeTool(session: Session, call: { tool: string; input: unknown; hostContext?: H }): Promise<CodeCallResult>; // N40
  /* … */
}
declare function createHarness<H = unknown>(options: HarnessOptions): Promise<Harness<H>>;
declare function createDispatcher(harness: Harness, options?: { queueSize?: number }): Dispatcher;   // 128
declare function inProcessTransport(dispatcher: Dispatcher): ClientConnection;
declare function stdioTransport(dispatcher: Dispatcher, io: { stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream }): Promise<void>;
// Revision (plan review 2): N44 retypes io over Web ReadableStream and WritableStream, with a Node adapter, so the transport runs off Node

// @buildanagent/harness/telemetry (guide §9; HD7). SEMCONV_GENAI_COMMIT and GEN_AI_ATTRIBUTES come from @buildanagent/sdk/otel.
declare function projectSpans(entries: AsyncIterable<SessionEntry>, options: {
  tracer: TracerLike; content?: "none" | "attributes" | "refs";      // "none" by default
  toolArguments?: boolean;                                          // gated apart from prompts; false by default
  hashAttributes?: { key: Uint8Array; names: string[] };            // Revision (agent AH12): HMAC-SHA-256 per named attribute
}): Promise<void>;    // invoke_agent → turn → model call → execute_tool (+ approval_wait child)

// @buildanagent/evals (guide §10; HD8)
interface EvalRow {                                    // guide sketch; Revision: costUsd may be null
  task: string; trial: number; costUsd: number | null; tokens: Usage;
  passed: boolean | null; unscored?: "judge_unknown" | "infra_error";   // Revision (R11): null when unscored
  steps: number; preambleTokens: number; wallMs: number; prompts: number;
  exit: "submitted" | "limit" | "infra_error";
  harness: string;                                     // Revision (agent AH13): "ours", "mini-swe-agent", "single-call"
  tags?: string[];                                     // Revision (agent AH13): the task's slice and "safety"
  ablation: string;
}
declare function report(rows: EvalRow[], options: { k: number }): EvalReport; // pass@1, pass^k, Wilson CI, cost/tokens/steps per task
declare function toMiniSweTrajectory(entries: SessionEntry[]): MiniSweTrajectoryV1_1; // format "mini-swe-agent-1.1"
declare function discordance(a: EvalRow[], b: EvalRow[]): { flipped: number; total: number };

// @buildanagent/harness/ablation (guide §11)
interface AblationConfig {
  context: Record<LayerName, boolean>;
  mcp: boolean; extensions: { inProcess: boolean; mcp: boolean; skills: boolean };
  toolSearch: boolean; credentialProxy: boolean; telemetry: boolean; completionCheck: boolean;
  sandbox: SandboxClient["tier"];                      // "none" still needs unsafe: true
}
declare function ablationHash(config: AblationConfig): string;   // stamped into session_header
```

### 3.6 Needs from the SDK plan

The harness uses the eleven seams of [SDK plan §3.4][sdk34] under their names. The table shows where each lands:

| SDK seam | Harness module | Use |
| --- | --- | --- |
| Context transform | `context` | layers 2–4 in `transformContext`; `context_transformed` drives the CLI's context-fill display only |
| Tool gate | `permissions` | `PermissionPipeline.gate()` fills `beforeToolCall` |
| Authoritative end events | `session` runner | `model_call_end` and `tool_call_end` become block, usage and result entries |
| Resume primitive | `session`, `permissions` | `Session.toContext()` then `continueRun(context, { resolutions })` |
| Tool exposure | `tools`, `mcp` | `RegisteredTool.exposure`, `ToolRegistry.activeTools()` |
| Base URL and transport | `evals`, tests | the Inspect bridge's local proxy; mock transports offline |
| Pause records | `session`, `permissions` | `approval_requested` stores the `SignedPendingRequest`; `canonicalInputHash` keys sticky allowances |
| Header stamp | `session`, `server` | `session_header` and `InitializeResult.capabilities` |
| Usage and cost | `session`, `telemetry` | `usage` entries; the projection's token and cost attributes |
| Gateway without the loop | `context` | the summary call through `Model.complete()` |
| Determinism | tests | `clock`, `idGenerator` and `random` give byte-identical logs |

P1 left two questions for P2 ([implementation plans §6](implementation-plans.md#6-open-questions)). First, the harness accepts `Cost.total: number | null`: `usage` entries store `Cost` unchanged, session spend becomes unknown when any entry's total is `null`, and a budgeted turn then refuses, as SDK D4 does for a run. Second, `context_transformed` carries enough, because the harness writes the `compaction` entry from inside its own `transformContext` and needs the event only for display.

The harness needed thirteen things the SDK plan did not state. P4 moved twelve into the SDK plan and dropped one, so no harness todo carries a workaround ([plan review §4][p4-4]). The twelve fall into three groups, each tested in the SDK todo named:
- **Hooks and events (B13), four needs.** `transformContext` returns a per-call view, and the loop keeps the full history (1). `ContextEvent` carries `system`, `messages`, `model` and `lastUsage` (2). `tool_call_end.result` is the result after `afterToolCall`, so the log stores what the model saw (5). `activeTools` may name deferred tools, and tools go out in definition order (8).
- **Resume (B6, B11, B15b), three needs.** `RunError.kind` marks `"overflow"`, and `continueRun` drops a trailing errored assistant message and re-issues the call, which layer 5 needs (4). `Context` is plain JSON that a caller may build from its store (6). A verified `allow` runs without `beforeToolCall`, and the harness re-checks policy before it resolves (7, HD5).
- **Gateway, budget, steering, telemetry and versioning, five needs.** `Model.caps` carries `contextWindow` and `maxOutputTokens` (3; B4, B5). `projectCallCost()` is exported for the summary call (9; defined in the gateway by B5 under ADR 0043, and re-exported by the SDK). `@buildanagent/sdk/otel` exports `GEN_AI_ATTRIBUTES` and `SEMCONV_GENAI_COMMIT` (10; B17). `CAPABILITIES` lists the strings `run_start.capabilities` carries (11; B20). `DeliveryReceipt` carries `kind`, `message` and `stepIndex`, and `steer_applied` fires for both kinds (12; B16).

The thirteenth, a client-tool pause kind for the third host-tool pattern, was dropped for Rounds B and N because §1 defers that pattern; the SDK plan records it as a later item.

### 3.7 What the agent plan gets from the harness

The agent guide places five requirements on the lower layers ([agent guide §1][ag1]). The harness provides a hook for each and leaves the policy to P3:
- **R1, N-of-M approvals:** `Approvals.quorum` collects `approval_resolved` entries until its `QuorumPolicy.evaluate()` returns `met`, and rejects an approver equal to the requester; the default quorum is one (N14). The host fills `Resolution.by` only after it authenticates the approver.
- **R2, a trusted run context:** `TurnOptions.hostContext`, typed by `createHarness<H>()`, reaches tool `execute` through the registry's `ToolWrapper` for that turn and never enters a model-facing schema or the log (N6, N11).
- **R3, provenance labels:** `EntryBase.origin` labels every entry, and with HD1 that means every block; `TurnOptions.inputOrigin` labels a turn's input, and `tool_result.trust` records a tool's declared output trust (N2, N6, N11).
- **R4, cross-run limits:** a `PermissionHook` reads the product's own store on every `decide()`; the harness defines no store type (N12).
- **R5, shadow mode:** the `shadow` permission mode makes the registry's wrapper write a `shadow_call` entry and return a fixed result instead of executing (N12). The agent shadows at its helpdesk boundary instead (`shadowHelpdesk`, agent AD14), which keeps its reads live.

The agent plan also needs two mechanisms beyond the five hooks. `Harness.invokeTool()` runs a side effect that code chose through the same pipeline and pause path (N40). And `product_record` entries with `session_header.product` keep the agent's own records in the log (N2).

## 4. Rounds and todos

Round N runs in eight stages. Every todo has a file in [`docs/todos/ready/`](../todos/ready/), written from [the template](../todos/TEMPLATE.md), and every todo's acceptance criteria include the repo-wide gate: `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline.

### 4.1 Stage 1 builds the session log, from its entry union to rebuild and replay

The guide says to start with the log, because context layers, pauses, replay, the resume cursor and telemetry are all projections of it ([harness guide §13][hg13]).

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [N1](../todos/done/N1-harness-workspace-scaffold.md) | Scaffold `protocol`, `harness`, `cli` and `evals` packages | B1 | S |
| [N2](../todos/done/N2-session-entries-schema.md) | Session entry union in `@buildanagent/protocol`, its JSON Schema and the stable fields | N1, B2 | M |
| [N3](../todos/done/N3-session-store.md) | `SessionStore`: memory and JSONL backends, the conformance suite and the write-time bound | N2 | M |
| [N4](../todos/done/N4-writer-lock.md) | Writer lock with a lease, and the crash test (HD2) | N3 | M |
| [N5](../todos/done/N5-head-fork-revert.md) | HEAD, checkout, fork, revert and migration by pointer | N4 | M |
| [N6](../todos/done/N6-session-runner.md) | Session runner: SDK events to entries, user entry first | N5, B13 | M |
| [N7](../todos/done/N7-rebuild-resume-replay.md) | Context rebuild, resume, playback and re-run from an entry | N6, B15b, E2 | M |

### 4.2 Stage 2 adds the five context layers, cheapest first

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [N8](../todos/done/N8-write-cap-masking.md) | Layers 1 and 2: write cap with spill, and stepped masking | N6 | M |
| [N9](../todos/done/N9-summary-layer.md) | Layer 3: recall-first summary between turns, with hooks and a focus hint | N8, B5, B14 | M |
| [N10](../todos/done/N10-mid-turn-overflow.md) | Layers 4 and 5: mid-turn compaction and the overflow retry | N9, N7 | M |

### 4.3 Stage 3 adds the registry, the permission pipeline, signed approvals and code-initiated calls

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [N11](../todos/done/N11-tool-registry.md) | Tool registry: canonical names, exposure, tool search and host tools | N1, B12 | M |
| [N12](../todos/done/N12-permission-pipeline.md) | Permission pipeline: order, rules, modes and the no-match default | N11, B13 | M |
| [N13](../todos/done/N13-signed-approvals.md) | Signed approvals in the log: key ring, pause, resume with re-evaluation | N12, N7 | M |
| [N14](../todos/done/N14-sticky-grouped-quorum.md) | Sticky allowances, grouped approvals and the quorum hook | N13 | M |
| [N40](../todos/ready/N40-code-initiated-calls.md) | Code-initiated tool calls: `Harness.invokeTool()` and the `code_call` entry | N13, N14, B15, E2 | M |

### 4.4 Stage 4 adds the sandbox backends and the credential proxy

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [N15](../todos/done/N15-sandbox-interface.md) | Sandbox interface, the `none` backend, `spawnEnv` and the conformance suite | N1 | M |
| [N16](../todos/done/N16-srt-backend.md) | `srt` OS backend | N15 | M |
| [N17](../todos/done/N17-docker-backend.md) | Docker backend | N15 | M |
| [N18](../todos/ready/N18-sandbox-escalation.md) | Sandbox escalation state machine | N15, N13 | M |
| [N19](../todos/ready/N19-sandbox-measurement.md) | Measure `srt` and Docker cold start and per-call overhead (HD4) | N16, N17 | S |
| [N20](../todos/done/N20-credential-proxy.md) | Credential proxy: default-deny egress, sentinel routes, gated fetch, secret scrub | N15 | M |
| [N21](../todos/ready/N21-builtin-tools.md) | Built-in tools: `read`, `write`, `edit`, `bash`, `fetch` and the read-only `grep` and `glob` through the sandbox | N11, N15, N20, N8 | M |

### 4.5 Stage 5 adds extensions, skills and the MCP client

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [N22](../todos/ongoing/N22-in-process-extensions.md) | In-process extensions: composition, project trust and content-hash pins | N11, N12 | M |
| [N23](../todos/ready/N23-skills-context-files.md) | Skills, context files and the plan-file convention | N22, N9 | S |
| [N24](../todos/ready/N24-mcp-stdio.md) | MCP client over stdio: per-server negotiation, canonical names, deferred exposure | N11, N12 | M |
| [N25](../todos/ready/N25-mcp-http-background.md) | MCP streamable HTTP, legacy SSE and background connect | N24 | M |
| [N52](../todos/ready/N52-memory-extension.md) | File-based memory extension: the `memory` tool, sourced records, the capped index, expiry and purge marks (HD17; added 2026-11-19) | N21, N23, N33 | M |

### 4.6 Stage 6 puts the protocol, its transports and the CLI over the harness

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [N26](../todos/done/N26-protocol-package.md) | Protocol package: the typed union, framing and the generated JSON Schema | N2, B11, B15 | M |
| [N27](../todos/done/N27-dispatcher-core.md) | Dispatcher and in-process transport: `initialize`, turns, events, `turn/settled` | N26, N7, B16 | M |
| [N28](../todos/ready/N28-server-requests-backpressure.md) | Server requests, cancellation, bounded queues and reconnect | N27, N13 | M |
| [N29](../todos/ready/N29-stdio-transport.md) | stdio transport and the framing check (HD6) | N28 | S |
| [N30](../todos/ready/N30-cli.md) | CLI: one-shot JSON mode, line-mode chat, and `sessions` list, show, search and replay | N28 | M |

### 4.7 Stage 7 adds telemetry, completion checks, evals and ablation

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [N31](../todos/ready/N31-telemetry-projection.md) | Telemetry projection from the log, with the budget meter | N7, N13, B17 | M |
| [N32](../todos/ready/N32-completion-check.md) | Completion check and diff flags (HD10) | N15, N6 | M |
| [N33](../todos/ready/N33-retention-schema-docs.md) | Retention settings and the transcript schema page (HD11) | N5, N2 | S |
| [N34](../todos/ready/N34-ablation-switches.md) | Ablation switches and the ablation hash | N10, N14, N20, N21, N23, N25, N31, N32 | M |
| [N35](../todos/ready/N35-harness-capstone.md) | Harness triage capstone, second-process resume and the granularity test (HD1) | N29, N30, N34, B19, B20 | M |
| [N36](../todos/ready/N36-eval-reports-replay.md) | Eval package: reports, mini-swe-agent trajectories and the offline replay suite | N35 | M |
| [N37](../todos/ready/N37-inspect-bridge.md) | Inspect bridge and the baseline runner (opt-in) | N36, N17 | M |
| [N38](../todos/ready/N38-seed-suite-baseline.md) | Seed suite of 20 repository tasks and the first baseline run (HD8) | N37 | M |
| [N38b](../todos/ready/N38b-shared-triage-tasks.md) | Add the 10 shared triage tasks to the seed suite (HD8); deferred with the triage round ([ADR 0032](../decisions/0032-personal-coding-agent-first.md)) | N38, W12, A17, A19 | M |
| [N39](../todos/ready/N39-ablation-runs.md) | Ablation and tuning runs: HD3, HD9, HD12 and SDK D11 | N38 | M |

No todo is size L. The longest dependency chain runs N1 → N2 → N3 → N4 → N5 → N6 → N7 → N13 → N28 → N29 → N35 → N36 → N37 → N38 → N39, fifteen todos. Two branches tie it: N7 → N27 → N28, and the branch that ends in N38b, which also waits for A17 and A19 from Round A. Stages 4 and 5, N26 and N40 run beside it.

### 4.8 Stage 8 makes the harness portable to Cloudflare, AWS and Vercel (added 2026-11-18)

[ADR 0033](../decisions/0033-three-deployment-targets.md) requires the harness to run on local Node, Cloudflare, AWS and Vercel, proved by one conformance suite. The [coding agent plan §4](build-coding-agent.md#4-changes-to-the-sdk-and-harness-plans) maps each of U11's adopted changes to a todo.

| Todo | Delivers | Depends on | Size |
| --- | --- | --- | --- |
| [N41](../todos/ready/N41-scheduler-wake.md) | `Scheduler.wake` seam and its in-process implementation | N4 | S |
| [N42](../todos/ready/N42-read-only-key-store.md) | Optional `rotate()` and `prune()`, and a secret-backed `KeyStore` | N13 | S |
| [N43](../todos/ready/N43-remote-sandbox-egress-policy.md) | Remote `SandboxClient` extensions and `EgressPolicy` compiled per backend | N15, N20 | M |
| [N44](../todos/ready/N44-web-stream-websocket-transport.md) | stdio over Web streams and a WebSocket transport | N29 | M |
| [N45](../todos/ready/N45-portability-conformance-suite.md) | One conformance suite over the eight portable seams (`EffectStore` is the eighth, ADR 0043) | N41, N42, N43, N44, E7 | M |
| [N46a](../todos/ready/N46a-cloudflare-state-adapters.md) | Cloudflare store, lock, scheduler, key store and workerd smoke test | N45 | M |
| [N46b](../todos/ready/N46b-cloudflare-sandbox-backend.md) | Cloudflare Sandbox backend and per-host outbound interception egress, blocked on the owner's decision after N50 | N45, N50 | M |
| [N47a](../todos/ready/N47a-aws-state-adapters.md) | DynamoDB store and lock, EventBridge Scheduler wake, Secrets Manager key store | N45 | M |
| [N47b](../todos/ready/N47b-e2b-sandbox-backend.md) | E2B backend and egress Secrets | N45 | M |
| [N48a](../todos/ready/N48a-vercel-state-adapters.md) | Postgres store and lock, Workflow wake, environment key store | N45 | M |
| [N48b](../todos/ready/N48b-vercel-sandbox-backend.md) | Vercel Sandbox backend and firewall `transform` | N45 | M |
| [N49](../todos/ready/N49-hosted-sandbox-measurement.md) | Cold start, snapshot and per-call overhead on the hosted backends | N46b, N47b, N48b, N19 | S |
| [N50](../todos/ready/N50-cloudflare-sandbox-egress.md) | Verify Cloudflare Sandbox 1.0 egress on a real sandbox, and draft an ADR for the owner (added in plan review 2, 2026-11-19) | None | M |

## 5. Test strategy

### 5.1 Every test runs offline on the SDK's scripted model, and no test touches the host

Every harness test that runs a turn drives `ScriptedModel` through `createModel`, with `fixedClock`, `sequentialIds` and `testSigner`, so runs are deterministic and the SDK's teardown checks apply ([SDK plan §5.1][sdk51]). The harness reuses the SDK's shared setup: `allowModelRequests(false)`, a `fetch` guard that allows only loopback, and a failure when a provider key variable is set ([SDK plan §5.4][sdk54]). Any spawned process gets `spawnEnv()`, never `...process.env` ([AGENTS.md](../../AGENTS.md#coding-standards)).

The built-in `bash`, `write` and `edit` tools touch a host only through a `Sandbox`. In `pnpm test` they run against `fakeSandbox()` from `@buildanagent/harness/testing`, an in-memory file system with a recorded `exec`, so a scripted model never runs a command on the host. `read` may read a temp directory, which [AGENTS.md](../../AGENTS.md#process-for-documenting-an-sdk) allows. The real `srt` and Docker backends run commands only inside their sandbox, in the opt-in `test:sandbox` job.

### 5.2 Conformance suites pin each interface that has more than one implementation

Five suites run in `pnpm test`; each takes a factory, so a new implementation passes the same tests:
- **`SessionStore`:** idempotent append by id, the expected-last-id compare-and-swap, ordered `load` from a sequence, a torn last line skipped, the 64 KiB bound as a typed error, `list` and `delete`. Memory and JSONL run it in N3.
- **`SessionLock`:** a second acquire returns `"would_block"`, release frees it, a lapsed lease with a dead pid is reclaimed, and a live one is not. N4 adds the crash test, which spawns a child writer, kills it with `SIGKILL` mid-append and checks recovery.
- **`SandboxClient`:** writes outside `writeRoots` are denied, network is denied unless allowlisted, the environment holds only `spawnEnv` names, and an unavailable backend throws `SandboxUnavailableError` rather than running unsandboxed. The fake runs it always; `srt` and Docker run it in `test:sandbox`.
- **Protocol:** every fixture message validates against the generated schema and type-checks with `satisfies`, in both directions, and the framer round-trips U+2028 and U+2029 inside strings.
- **MCP:** the client lists and calls tools on an in-process `@modelcontextprotocol/server` 2.4.0, on both protocol eras.

### 5.3 Playback and resume tests prove the log is the only source of truth

The determinism test runs a scripted session, plays it back with no model and no tool calls, and requires byte-identical entries and an identical rebuilt `Context`. The resume test serialises nothing but the JSONL file, starts a second process through `buildanagent rpc`, and resolves a pending approval there. The crash test kills a turn between the user entry and the first model call and checks that the user entry survives, which is LangGraph's "never accepted" versus "lost" case ([harness guide §2][hg2]).

### 5.4 The harness triage capstone checks the whole stack against the SDK's capstone

N35 runs the SDK's triage capstone ([SDK plan §5.3][sdk53]) inside the harness and adds the harness rows:

| Capstone row | What the harness capstone must show | Part verified | Reference failure it guards against |
| --- | --- | --- | --- |
| Risky tool | the pipeline asks; an `approval_requested` entry is written before any client sees it; a second process resolves it; a deny written after a policy change wins over an earlier allow | log, pipeline, key ring | approvals that die with their process; LangChain's skipped rejection ([harness guide §5][hg5]) |
| Tool surface | only the capstone's tools and no built-ins reach the model; the preamble size is printed | registry, exposure | Copilot's 19 default built-ins ([SDK plan §5.3][sdk53]) |
| State | playback is byte-identical; HEAD survives a reload after a checkout | log, HEAD | Pi's lost `/tree` jump ([harness guide §2][hg2]) |
| Context | a long scripted session triggers masking and one summary, and the summary is a visible entry | context layers | compaction users cannot see ([harness guide §3][hg3]) |
| Secrets | no provider key or injected credential appears in any entry or span | credential boundary, scrubber | inherited environments ([harness guide §6][hg6]) |

### 5.5 The eval harness compares cost and pass^k against mini-swe-agent, in three suites

The eval machinery has three suites ([harness guide §10][hg10]):
- **Offline replay, on every commit:** N36 replays recorded sessions through `replayPairs()` and checks entries and `EvalRow` fields; it needs no model and runs in `pnpm test`.
- **Live regression, opt-in:** the tasks that pass near 100%, run before releases, through Inspect's `sandbox_agent_bridge()` with `forward_generation_config=True`, so our generation settings hold ([harness guide §10][hg10]).
- **Capability, opt-in:** the HD8 seed suite at k = 5, beside mini-swe-agent 2.4.6 with the same model, tasks, prices and resource limits.

Every report pairs pass@1 and pass^k, with Wilson intervals, with cost, tokens, steps, preamble size and prompts per task. A harness gain under about 10 points counts only with paired statistics or a few hundred tasks ([harness guide §10][hg10]). Graders and their tests run outside the agent's writable sandbox, and each trial starts from a clean workspace without the git history of earlier trials ([harness guide §10][hg10]).

### 5.6 Ablation runs switch one component off at a time and report in the eval format

N34 makes every removable component a flag in `AblationConfig` and runs the capstone with each flag off, so each no-op path is tested offline. N39 runs the seed suite with each context layer, tool search, MCP and the completion check switched off in turn, and reports each in the §5.5 format. A component that costs tokens without moving pass^k becomes a removal candidate on the next model ([harness guide §11][hg11]). Switching off a safety component fails safe: with the credential proxy off, tools get no credentials, and the sandbox drops to `none` only with `unsafe: true`.

## 6. Risks, open questions and sequence

### 6.1 Six risks remain, and each has a mitigation in a named todo or job

- **An SDK seam may still fall short.** P4 moved twelve of the thirteen needs into the SDK plan, each with a test in its SDK todo (§3.6). Mitigation: if one fails in practice, the harness has three fallbacks. It can rebuild its own request view, end an overflowed turn and start a new one from a rebuilt `Context`, or store its own copy of the context.
- **Sandbox backends are unavailable in CI.** `srt` and Docker may be missing on the CI runner. Mitigation: the conformance suite runs on the fake in `pnpm test`, and the real backends run in an opt-in `test:sandbox` job that the X-round CI can add.
- **The MCP specification moves under the client.** The 2026-07-28 revision and the legacy era coexist. Mitigation: `McpConnection` hides the base (HD14), and per-server negotiation means a slow server never drops the fleet.
- **Evals need Python and money.** Inspect is a Python tool, and the seed suite costs real tokens. Mitigation: the Python part has its own exact-pinned `requirements.txt`, live suites are opt-in, and each live run needs the owner's budget flag (HD8).
- **Scope creep from the agent side.** Quorum rules, tiers and provenance policy are tempting to build in. Mitigation: §3.7 gives each requirement a hook and no policy.
- **Secrets in the log.** A tool result can echo a secret the host knows. Mitigation: `scrubSecrets` runs before every append (N20), and the capstone asserts no credential reaches an entry or a span.

### 6.2 No question is open, and N19's measurement is the only pending input

The owner answered HD4, HD5, HD8 and HD11 on 2026-11-18. N19's measurement is the only input still to come, and a change after it is a superseding ADR (HD4). The agent plan answered P2's questions for P3. AD2, AD3, AD4 and AD10 set the policies behind the R1, R4 and R5 hooks, per-block `origin` is fine enough for AD5, and the 10 triage tasks are AD6's classification slice (N38b). P4 settled the thirteen needs (§3.6) and gave [ADR 0009](../decisions/0009-pre-emptive-budget.md) HD9's session cap. The live-run budgets HD8 needs arrive with N38 and N38b.

### 6.3 Where Round N slots into the roadmap

Round N interleaves with Round B in the build phase, starting from B1 and B2, and a new milestone, "M6 Our agent harness", covers N1 to N49 (with N46a/b, N47a/b and N48a/b), N50 and N52; N38b is deferred with the triage agent under M7b. *(Revised in plan review 2, 2026-11-19: the milestone first covered N1 to N40 with N38b.)* Most of Round N waits for the SDK's loop, but the log and the sandbox do not:
- **After B1 and B2:** the scaffold, entries, store, lock and HEAD (N1 to N5), the sandbox interface and backends (N15 to N17, N19) and the credential proxy (N20), which need only the workspace and the gateway's types.
- **After B11 and B15:** the protocol package (N26), whose union names `AgentEvent` and `SignedPendingRequest`.
- **After B12 and B13:** the runner (N6), context layers 1 and 2 (N8), the registry (N11), the pipeline (N12), the built-in tools (N21), extensions (N22) and the MCP client (N24, N25).
- **After B15b and B16:** rebuild and resume (N7), signed approvals (N13, N14), code-initiated calls (N40), escalation (N18) and the dispatcher (N27 to N30).
- **After B14 and B17:** the summary layer (N9 and N10) and the telemetry projection (N31).
- **After N21, N23 and N33:** the memory extension (N52), added on 2026-11-19 from U18.
- **After B19 and B20:** the harness capstone (N35), whose `initialize` capabilities need B20's list, and the eval stage.
- **After A17 and A19:** the 10 shared triage tasks (N38b), the one harness todo that waits for Round A.
- **After Round E (M5e):** E2 gates rebuild and resume (N7) and code-initiated calls (N40), and E7 gates the portability suite (N45). The owner lifted Round E's hold on 2026-11-19, so these gates wait only on E's own order ([close-sdk-gaps plan §4](close-sdk-gaps.md#4-round-e-and-its-todos)).
- **Stage 8, after N4, N13, N15, N20 and N29:** the scheduler (N41), the read-only key store (N42), the remote sandbox extensions (N43) and the Web-stream transport (N44), then N45 and the per-target adapters (N46a to N48b) and N49's measurement. N46b also waits for N50 and the owner's decision on Cloudflare egress.

The roadmap graph gains one line, `B1 ─► N1 … N40 ─► N41–N49 ─► M6`. N50 depends on nothing, so it starts at once and feeds N46b. Branches run from B2 to N2, from B13 to N6, from B15b and E2 to N7, from E7 to N45 and from W12 and A19 to N38b. The deferred triage round (M7b) would start after N1 and need N35 for its capstone.

Round N closes when the triage capstone pauses, resumes in a second process and replays byte for byte from its log, and when the first eval report sets our harness beside mini-swe-agent on cost and pass^k. As of 2026-11-19, B1 and B2 are done, so N1 has every dependency done.

[hg]: ../guides/agent-harness.md
[u18]: ../research/memory/retrieval-and-memory.md
[u19-when]: ../research/a2a/agent-to-agent-protocols.md#call-another-agent-over-a2a-only-when-someone-else-owns-it-and-expose-one-only-when-an-outside-caller-needs-it
[u19-sec]: ../research/a2a/agent-to-agent-protocols.md#a-remote-agents-card-and-reply-are-untrusted-input-and-2026s-measurements-show-where-that-bites
[u20-changes]: ../research/voice/voice-and-realtime.md#eight-proposed-changes-await-the-owners-decision
[u18-changes]: ../research/memory/retrieval-and-memory.md#twelve-proposed-changes-await-the-owners-decision
[u18-file]: ../research/memory/retrieval-and-memory.md#a-file-is-enough-for-one-agent-and-one-user-and-a-service-earns-its-price-at-many-users-or-temporal-questions
[u18-recall]: ../research/memory/retrieval-and-memory.md#recall-a-short-index-every-session-search-for-the-rest-and-check-each-record-before-acting-on-it
[u18-forget]: ../research/memory/retrieval-and-memory.md#forget-by-an-expiry-that-only-a-successful-check-renews-and-delete-from-every-copy
[u18-sdks]: ../research/memory/retrieval-and-memory.md#all-eight-sdks-retrieve-through-tools-six-ship-long-term-memory-and-none-expires-it-in-the-process
[p4-4]: reviews/plan-review.md#4-needs-reconciliation-24-change-upstream-3-drop-1-is-already-covered
[hg2]: ../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries
[hg3]: ../guides/agent-harness.md#3-context-policy-should-run-five-removable-layers-cheapest-first-and-keep-every-compaction-visible-and-reversible
[hg4]: ../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension
[hg5]: ../guides/agent-harness.md#5-the-permission-pipeline-should-be-ordered-deny-first-and-fail-closed-and-its-approvals-should-be-signed-entries
[hg6]: ../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both
[hg7]: ../guides/agent-harness.md#7-extensions-come-in-three-trust-tiers-and-project-trust-gates-loading-not-execution
[hg8]: ../guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport
[hg9]: ../guides/agent-harness.md#9-telemetry-should-be-a-projection-of-the-log-with-content-off-by-default-and-cost-recorded-on-every-entry
[hg10]: ../guides/agent-harness.md#10-evals-should-run-on-inspect-against-mini-swe-agent-and-report-cost-per-task-beside-pass-rate
[hg11]: ../guides/agent-harness.md#11-every-component-should-be-removable-because-the-value-of-harness-scaffolding-decays-as-models-improve
[hg12]: ../guides/agent-harness.md#12-reference-architecture
[hg13]: ../guides/agent-harness.md#13-open-decisions-for-round-p
[ag1]: ../guides/agent.md#1-the-agent-owns-the-product-decisions-and-the-sdk-and-harness-own-the-machinery-beneath-them
[ag10]: ../guides/agent.md#10-open-decisions-for-round-p
[sdk]: build-sdk.md
[sdk1]: build-sdk.md#1-goal-and-non-goals
[sdk2]: build-sdk.md#2-decisions
[sdk-d1]: build-sdk.md#d1-two-packages-because-the-gateway-has-consumers-that-never-run-the-loop
[sdk-d3]: build-sdk.md#d3-usage-stores-four-token-classes-and-the-uncached-field-says-so-in-its-name
[sdk-d5]: build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5
[sdk-d9]: build-sdk.md#d9-the-usd-cap-is-checked-before-each-model-call-against-a-projected-cost
[sdk31]: build-sdk.md#31-two-packages-under-a-new-top-level-packages-directory
[sdk34]: build-sdk.md#34-the-seams-p2-consumes
[sdk51]: build-sdk.md#51-the-scripted-test-model-is-the-default-seam-and-mock-transports-test-the-wire
[sdk53]: build-sdk.md#53-the-triage-capstone-checks-the-whole-sdk-against-the-reference-capstones
[sdk54]: build-sdk.md#54-tests-run-offline-with-the-repos-safety-rules-built-in
[n-sess-1]: ../research/agent-harness/notes/sessions-and-storage.md#1-pi-one-jsonl-file-per-session-entries-form-a-tree-the-last-line-is-head
[n-sess-5]: ../research/agent-harness/notes/sessions-and-storage.md#5-codex-jsonl-rollouts-as-truth-a-sqlite-projection-for-paging-a-cross-process-writer-lock
[n-sess-6]: ../research/agent-harness/notes/sessions-and-storage.md#6-openhands-sdk-one-json-file-per-event-a-parent-id-tree-a-mutable-base_statejson
[n-sess-add]: ../research/agent-harness/notes/sessions-and-storage.md#addendum-a-real-claude-code-transcript-confirms-a-tree-log-with-an-explicit-leaf-and-kept-history-observed-2026-11-18
[n-perm-gaps]: ../research/agent-harness/notes/permissions-and-sandboxing.md#unresolved-gaps
[n-if-9]: ../research/agent-harness/notes/interfaces-and-extensions.md#9-host-provided-tools-follow-three-patterns
[n-obs-2]: ../research/agent-harness/notes/observability-and-evals.md#2-the-otel-genai-conventions-are-development-only-and-moving-so-pin-them-by-commit
[n-obs-6]: ../research/agent-harness/notes/observability-and-evals.md#6-cost-accounting-needs-four-token-classes-a-fixed-input-convention-and-a-cost-provenance-flag
