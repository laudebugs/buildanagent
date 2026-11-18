# Building an agent harness: one tree-shaped log, three separate safety boundaries and one protocol under every interface

- **Status:** guide for todo G2b, 2026-11-18. The [build-guides plan](../plans/build-guides.md#2-the-three-layers-defined) defines the layer; this guide turns the [harness research][har] into a build plan for our own harness, on top of the boundary that the [SDK guide][g] draws.
- **Evidence (as of November 2026):** the [harness synthesis][har], its [fact-check log][hfc] including the [R1 re-verification][hfc-r1], the five [harness research notes](../research/agent-harness/notes/), the [Hacker News synthesis][hn] and its six [theme notes](../research/practitioners/notes/), the [harness teardown][ha], the [main report][main] with its [fact-check log][fc], the eight references in [`docs/reference/`](../reference/) and the [comparison docs](../comparison/). Versions are the pins those files name, among them Pi `@earendil-works/pi-coding-agent` 1.5.2, `@anthropic-ai/claude-agent-sdk` 0.3.327, `@openai/agents-core` 0.21.0, `ai` 7.0.162, `langchain` 1.6.1, Cloudflare `agents` 0.33.0 with `@cloudflare/think` 0.23.0, OpenHands software-agent-sdk 1.62.0, mini-swe-agent 2.4.6 and Codex `main` at `4389a52` ([harness research][har]).
- **Reader:** the engineers who will build our harness. You have read the [SDK guide][g] and know its six seams; you have not read the harness research, the practitioner corpus or the source notes behind them.

The harness is the layer that moves agent results most, and the least of it is the loop. With the model held fixed, Pass@1 across seven harnesses on Claw-SWE-Bench differed by up to 24.3 points, and a bare adapter scored 19.3% where the full one scored 71.2% ([main report][main-swing]; [main fact-check, R1][fc-r1]). Among mature harnesses, the effect on pass rate shrinks to noise: swapping the harness flips about as many tasks as rerunning it, 13% in both cases. The effect on the bill stays large, with cost differing by up to 3× ([harness research §5][har5]; [observability note §5][n-obs-5]). The harnesses we read also share the same holes: HEADs that are not persisted, missing session locks, approvals that die with their process, unsigned resumes, inherited environments, content recorded by default and budgets that overshoot ([harness research, conclusion][har-end]). This guide covers each part of the harness layer that [build-guides §1](../plans/build-guides.md#1-goal) lists, from the session log to evals and ablation. For each part it gives the design we recommend, the alternatives other harnesses chose, and the evidence, including where practitioners and vendor docs disagree. It ends with a reference architecture and the decisions Round P must still make. The recommendation fits in one sentence: **keep one append-only, tree-shaped session log as the only source of truth, add context layers from the cheapest upward, keep the permission pipeline, the sandbox and the credential boundary as three separate components that the host owns, put one typed protocol under the SDK, CLI and RPC interfaces, and judge every component by cost per task as well as pass rate against mini-swe-agent, so that each one can be removed when it stops paying.**

## 1. The harness owns where state lives and what a call may touch, and it plugs into the SDK through six seams

The SDK is the library that runs a model-and-tools loop; the harness is the runtime that hosts that loop for real work ([build-guides §2](../plans/build-guides.md#2-the-three-layers-defined)). The [SDK guide §1][g1] already drew the line: the SDK owns the gateway, the loop, tool definitions, the event union, the interceptors and the test model, and it leaves the session log, compaction, permissions, sandboxing, the MCP registry and the interfaces to this guide. This guide therefore leaves the loop as the SDK guide designed it and builds on the six seams the SDK exposes:
- the **context transform**, where the context layers of §3 run ([SDK guide §6][g6]);
- the **tool gate**, which returns allow, deny or ask and which the permission pipeline of §5 fills ([SDK guide §6][g6]);
- the **authoritative end events**, which the session log of §2 persists ([SDK guide §5][g5]);
- the **resume primitive**, `continue(context)`, which any process calls on a stored log ([SDK guide §3][g3]);
- the **tool-exposure field**, which the registry and MCP client of §4 set ([SDK guide §4][g4]);
- the **base URL and transport override**, which the eval bridge of §10 needs ([SDK guide §8][g8]).

The main report's eight layers split the same way: layers 1 and 2 are the SDK's, and layers 3 to 8 are the harness's ([main report][main-arch]). The harness research revises that table in six places, and the revisions shape this guide ([harness research §7][har7]). Layer 3 builds its storage instead of buying it. Layer 5 gains write-time caps and masking ahead of summarization, and layer 7 splits into three components. The architecture also gains an interface layer and an extension layer, and layer 8 gains content-off defaults and pre-emptive budgets. Sections 2 to 11 follow that revised list.

## 2. The session log should be one append-only tree of typed entries, with HEAD, a writer lock and pauses as entries

**Recommended design.** The session log is a JSONL file of typed entries, each with `id`, `parentId`, `type` and `timestamp`, and it is the only source of truth ([harness decision 1][har6]). Compaction summaries, branch summaries, context edits, model and tool-loadout changes, usage and approvals are all entries, and run state is rebuilt from the log, so no separate run-state blob exists ([harness decision 1][har6]). A `checkout` entry persists HEAD; one writer per session holds an exclusive lock that fails fast; files are immutable, so revert, fork and migration write new files and move a pointer ([harness decisions 2–4][har6]). The store sits behind a small `SessionStore` interface with JSONL on disk and in memory first ([harness decision 5][har6]).

**Five of seven harnesses keep an ordered log of typed entries, and four of them make it a tree.** Pi, the Claude Agent SDK, OpenHands, Cloudflare and Codex store model-visible items as an ordered log, and all but Codex link entries by `id` and `parentId`; Codex references entries by ordinal ([harness research §1][har1]; [harness fact-check row 34][hfc]). LangGraph and OpenAI take other paths:

| Harness | Storage unit | Branch in place | Resume point | Multi-process | Pending approval survives restart |
|---|---|---|---|---|---|
| Pi | JSONL line, `id` + `parentId` | yes (`/tree`) | any entry; leaf = last line | no lock | no |
| Claude SDK | JSONL line, `uuid` + `parentUuid` | no (truncating resume) | any chain uuid | none; store orders by commit time | `defer` only |
| OpenAI | item list + `RunState` | no | paused run | optional compare-and-swap | yes, in `RunState` |
| LangGraph | checkpoint + writes | `updateState` fork | super-step boundary | none in the interface | yes, as an interrupt write |
| Codex | rollout JSONL + SQLite index | no | turn; revert by new file | cross-process writer lock | no ("Transient, non-durable") |
| OpenHands | one file per event + state JSON | yes | event | `flock` (unsafe on NFS) | yes |
| Cloudflare | Durable Object SQLite rows | yes | latest leaf | single writer per object | yes |

The table condenses [harness research §1][har1] and the [sessions note §8][n-sess-8]. The tree wins because compaction and branching become ordinary entries that a context builder interprets, so neither deletes history ([harness research §1][har1]). The main report's review already asked for a tree on these grounds, and the deep comparison picks Pi's tree as the harness pattern to copy ([main fact-check, review item 1][fc-review]; [deep comparison][dc-harness]).

**A real Claude Code transcript shows the shape works at scale and adds two details.** The sessions note parsed the structure, never the content, of one CLI 2.1.327 transcript ([sessions note, addendum][n-sess-add]). Its linked entries form a `uuid`/`parentUuid` tree, `last-prompt` entries name the current leaf, and compaction writes a `compact_boundary` entry with a null parent and a `logicalParentUuid` while every earlier entry stays in the file ([sessions note, addendum][n-sess-add]; [harness fact-check row 23][hfc]). The first detail is one entry per content block, which lets parallel tool calls interleave with their results without ambiguity. The second is one log file per subagent, linked to its parent by the spawning tool-use id ([harness decision 1][har6]). The format is internal and undocumented, so this is one sample of one version ([harness research §1][har1]).

**Pi's tree leaves three holes, and other harnesses show how to close each.** First, Pi does not persist HEAD: on reload the leaf is the last entry in file order, so a `/tree` jump with no later append is lost, while OpenHands persists `leaf_event_id` ([harness research §1][har1]; [harness fact-check row 2][hfc]). Second, Pi takes no lock, while Codex's writer lock returns `WouldBlock` to a second writer ([harness fact-check rows 3, 5][hfc]). Third, Pi rewrites the original file when it migrates a version, while Codex stages, verifies and publishes the migrated history atomically ([harness research §1][har1]). No harness supports two concurrent writers on one session, so every design assumes one writer enforced by a lock or an actor ([sessions note, unresolved gaps][n-sess-gaps]).

**Codex shows how to revert and fork without copying history.** Revert writes "a new immutable rollout file", and "the only mutable cutover is the existing SQLite rollout-path pointer"; forks reference a parent prefix, and the SQLite database is an index for paging, not the log ([harness research §1][har1]; [harness fact-check row 8][hfc]). Cloudflare instead makes rows mutable, a choice its Durable Object pricing drives, since "rows written cost ~1000× rows read" ([harness fact-check row 21][hfc]). We copy Codex, because a mutable row cannot serve as an audit trail or as the playback source of §2's last paragraph.

**Pauses must be entries, because a callback dies with its process.** Codex lists its approval requests as "Transient, non-durable events", and Claude's `canUseTool` is an in-process callback ([harness fact-check row 7][hfc]; [harness research §1][har1]). OpenHands, Cloudflare and Claude's `defer` decision survive a restart because the pause is data ([harness research §1][har1]). OpenAI had to add bookkeeping in `RunState` 1.20 because session history and paused-run state live in two stores that can diverge, which the harness research calls "the strongest argument for one store" ([harness research §1][har1]). Our pause is an `approval_requested` entry carrying the call id, tool, canonical-input hash and policy version, and a resumed run refuses any call without a matching `approval_resolved` entry ([harness decision 6][har6]). This implements the SDK's signed pause in storage ([SDK guide §7][g7]).

**Storage should be built, not bought, because no harness we read buys it.** The main report's layer 3 said "Build schema; buy storage", but every harness in the research stores sessions on local disk or in its runtime's own database ([harness research §7, revision 1][har7]). We therefore build a JSONL backend and keep storage pluggable behind a `SessionStore` modelled on Claude's. Its `append` is idempotent by entry id beside `load`, `list` and `delete`, and remote backends add an expected-suffix compare-and-swap, as OpenAI's `Session` offers ([harness decision 5][har6]; [sessions note, implication 6][n-sess-impl]). SQLite arrives later as a projection for listing and search, as Codex uses it ([harness decision 5][har6]). Two write-time rules come with it. First, the store bounds entry size at write time, as Codex truncates persisted tool output at 64 KiB. Second, the harness writes the user entry durably before the first model call, because LangGraph cannot tell "never accepted" from "lost" ([harness research §1][har1]; [harness fact-check row 6][hfc]).

**Replay needs two named modes, because LangGraph's "time travel" re-executes.** Invoking LangGraph from an old checkpoint re-runs later nodes, and "LLM calls, API requests, and interrupts fire again and may return different results" ([harness research §1][har1]). Our log supports deterministic *playback*, which rebuilds from stored entries with no calls, and a separate *re-run from entry X*, which branches ([harness decision 7][har6]). Playback reproduces the exact prompt only if entries store the model id, thinking level and system and tool checkpoint, as Pi's do ([harness research §1][har1]).

**Practitioners already treat local transcripts as the system of record, and they ask for retention instead of a silent purge.** About 25 HN authors debug, search and audit runs from the harness's local JSONL files, and none of the 111,532 comments names an LLM-ops product as a tool they use ([docs-and-dx, transcripts][hnn-transcripts]). The limit they name is retention: "jsonl files seem to get recycled after 30 days" ([docs-and-dx, transcripts][hnn-transcripts]), which matches Claude's `cleanupPeriodDays` default of 30 ([harness fact-check row 13][hfc]). The HN synthesis therefore adds three things to harness decision 1: a documented entry schema, configurable retention, and a search and replay CLI ([HN §4.2][hn42]). The sample over-represents individual developers using coding agents, so the absence of LLM-ops tools says more about the corpus than about production practice ([docs-and-dx, transcripts][hnn-transcripts]).

## 3. Context policy should run five removable layers, cheapest first, and keep every compaction visible and reversible

**Recommended design.** Context policy is five removable layers, ordered by cost ([harness decision 8][har6]):
1. cap tool output at write time and spill the full text to a file the agent can re-read by path;
2. mask older tool results at read time, in steps, never in the log;
3. summarize between turns on a threshold, keeping a 20K-token verbatim tail and using a recall-first template;
4. compact mid-turn when a step crosses about 90% of the window;
5. retry once on provider overflow, then end the run with an in-band error.

Layers 2 to 4 run inside the SDK's `transformContext` interceptor ([harness decision 8][har6]; [SDK guide §6][g6]). Every compaction is an appended entry, originals are never deleted, and layers 3 to 5 are ablated against the baseline before they stay on for 128K+ models ([harness research §2][har2]).

**Pi, Cloudflare Think and Codex compact at more than one trigger point, and only they keep a 20K tail.** The seven harnesses differ widely ([harness research §2][har2]):

| Harness | Between turns | Mid-turn | On provider overflow | Originals kept |
|---|---|---|---|---|
| Pi 1.5.2 | window − 16,384 | same check before the next turn | one compact-and-retry | yes, in the tree |
| Claude SDK 0.3.327 | CLI auto-compaction at a policy window (e.g. 200K on 1M models) | not exposed | not documented | yes, on disk |
| Codex `4389a52` | 90% of window; async at 65% | after a sampling step | no retry on the main path | yes, in the rollout |
| Cloudflare Think 0.23.0 | `compactAfter(threshold)` | opt-in at 90% | opt-in, one retry | yes, as overlays |
| OpenHands 1.62.0 | > 240 events or `max_tokens` | condenser on every step | `CondensationRequest` | yes, as a tombstone |
| OpenAI 0.21.0 | ≥ 10 non-user items | no | no | **no**: session replaced |
| LangChain 1.6.1 | only if a trigger is set | same hook | no | **no**: all messages removed |

Pi, Think and Codex (for user text) keep about 20,000 recent tokens; OpenHands keeps the back half of its events and LangChain keeps 20 messages ([harness fact-check row 35][hfc]). The two harnesses that delete originals, OpenAI's compaction session and LangChain's summarization, are the ones we avoid ([context note, reversibility][n-ctx-rev]).

**The overflow retry is common but not universal, so it is the fifth layer and an optional one.** The main report's review asked for three trigger points, between turns, mid-turn and on overflow ([main fact-check, review item 3][fc-review]). Pi and Think implement all three, but Codex's main sampling path returns `ContextWindowExceeded` without a retry and relies on its 65% background threshold instead ([harness research §2][har2]; [harness fact-check rows 25–26][hfc]). We keep the retry because it is one bounded attempt, and we classify overflow errors per provider, as Think's classifier does ([context note, implication 5][n-ctx-impl]).

**The cheap layers carry most of the measured value.** Masking old observations "halves cost relative to the raw agent while matching, and sometimes slightly exceeding, the solve rate of LLM summarization" on SWE-bench Verified ([arXiv 2508.21433](https://arxiv.org/abs/2508.21433), abstract; [harness fact-check, R1][hfc-r1]). The paper's Qwen3-Coder 480B figures are two strategies side by side, not a before and after: masking solved 54.8% at $0.61 per instance, LLM summarization 53.8% at $0.64 and the raw agent 53.4% at $1.29 ([harness fact-check, R1][hfc-r1]). In Anthropic's internal eval, context editing alone improved performance by 29% and cut tokens by 84% in a 100-turn search task, a vendor eval with no public task set ([context note, measured payoffs][n-ctx-pay]). Cloudflare truncates older tool output to 500 characters at read time and "does NOT mutate stored messages" ([harness research §2][har2]). Masking therefore runs before summarization, and summarization is the expensive fallback.

**The payoff of context management shrinks as windows grow, so layers 3 to 5 must earn their place by ablation.** Averaged over four models, the context-management gain on SWE-bench Verified fell from 35.7 to 15.9, 5.5 and 2.7 points as the window grew from 32K to 128K, and from 9.5 to 2.8 points on Terminal-Bench ([harness fact-check, R1][hfc-r1]). The paper attributes most of the benefit to preventing overflow, not to better recall ([HN §2.2, row 4][hn22]). Compaction alone also fails on long tasks: Anthropic found that "compaction isn't sufficient" across windows and fixed it with an initializer that writes a progress file, a JSON feature list and a git commit ([harness research §2][har2]). Long tasks therefore keep state in files, not summaries, and the harness ships a plan and progress file convention with a hook that re-reads it on resume ([harness decision 11][har6]; [HN §4.2][hn42]).

**Summaries should be recall-first and fed the whole discarded span.** LangChain feeds its summarizer only the last 4,000 tokens of the span it discards, so a long history is summarized from its tail ([harness fact-check row 19][hfc]). Pi's template is the strongest: fixed sections, "Preserve exact file paths, function names, and error messages", an iterative update of the previous summary, and cumulative read and modified file lists ([harness research §2][har2]). Our summarizer uses Pi's sections and exact-identifier rule over the whole span, with each tool output truncated to about 2,000 characters. It keeps a 20K tail that never splits a call from its result, and it renders a fresh system prompt rather than summarizing the old one ([harness decision 9][har6]).

**Every compaction costs one prompt-cache rebuild, so the harness rations prefix changes.** Think moves its truncation cutoff only every 8 messages, because a cutoff that moved every turn rewrote the cached prefix on every turn ([harness research §2][har2]). Pi disables cache writes on summary requests, and the Claude CLI freezes the system prompt until compaction ([harness fact-check row 4][hfc]; [harness research §2][har2]). Practitioners report the same cost from the other side: changing effort level or model mid-session busts the cache, and so does a proxy router ([reliability, caching][hnn-cache]). Our gateway freezes the system prompt until compaction, moves masking cutoffs in steps, disables cache writes on summary calls and counts compaction calls in usage. Effort changes, model changes and context edits happen only at session or subagent boundaries, and each one is logged ([harness decision 10][har6]; [HN §4.2][hn42]).

**Practitioners distrust compaction that they cannot see, which qualifies the vendor default.** About 45 HN authors across ~35 threads say compaction loses the plan or should be avoided, and only about 10 positive claims appear, clustered after May 2026 ([reliability, compaction][hnn-compact]). "/compact is a little black box that I just have to trust that is keeping the important bits", one wrote ([HN §4.2][hn42]). The Claude Agent SDK compacts automatically with no documented way to replace the algorithm, so the HN synthesis rates "automatic compaction is a safe default" as qualified: compaction must be inspectable and steerable ([HN §2.2, row 5][hn22]). Our compaction accepts a focus hint, writes its summary as a visible entry, keeps the discarded span retrievable, re-injects the rules file afterwards and shows context fill ([HN §4.2][hn42]). It also emits `before_compact` and `after_compact` hooks, as Claude's `PreCompact` and Pi's `session_before_compact` do, so a custom summarizer can replace ours ([context note, implication 6][n-ctx-impl]).

**The default context budget should sit below the model's window, as a value to ablate.** About 45 practitioners report a quality threshold of 200–300K tokens on 1M-token models, and about ten later voices say the threshold is moving ([reliability, large windows][hnn-window]). The vendor side agrees in mechanism: Claude may compact at a policy window such as 200K on 1M models, and Chroma's "Context Rot" report found reliability falling with input length even on simple tasks ([harness fact-check row 12][hfc]; [harness fact-check, R1][hfc-r1]). The HN synthesis therefore adjusts harness question 3: start the default budget near the reported threshold, and treat it as a parameter, not a fact ([HN §4.2][hn42]).

## 4. The tool registry should name, defer and gate every tool from one place, and the MCP client should be a removable extension

**Recommended design.** One registry holds every tool from every source: built-ins, in-process extensions, MCP servers and client-hosted tools ([interfaces note, implication 11][n-if-impl]). It assigns each tool a canonical name, refuses duplicates at registration, and sets each source's exposure to `direct`, `deferred` or `hidden` on the SDK's exposure field ([harness decision 17][har6]; [SDK guide §4][g4]). The MCP client is a built-in extension that can be switched off, targets the 2026-07-28 revision with a per-server legacy fallback, and connects servers in the background ([interfaces note, implication 8][n-if-impl]). The model sees no tool the agent did not name ([deep comparison][dc-harness]).

**Canonical names belong to the registry, because collisions are the main MCP failure.** Pi names tools `mcp__<server>__<tool>` and adds hash suffixes on collision, while OpenAI prefixes nothing by default and throws `Duplicate tool names found across MCP servers` at run time ([harness fact-check row 18][hfc]; [interfaces note §7][n-if-7]). Pi extensions can also silently override a built-in tool by registering the same name ([harness research §4][har4]). Our registry checks names once, at registration. An MCP collision gets a deterministic suffix, and an extension needs `override: true` to replace a built-in. A native or display alias stays separate from the canonical name, so approval rules can match it ([interfaces note, implication 9][n-if-impl]).

**Exposure is a per-source policy, because always-loaded definitions are the largest fixed cost.** Deferred loading cut tool-definition context from about 77K to 8.7K tokens in Anthropic's measurements, and practitioners count the cost themselves: "Linear: 23 tools (~12,935 tokens)" ([HN §2.2, row 2][hn22]). Claude defers MCP tools behind tool search by default, and Pi offers `codemode`, `deferred`, `direct` and `hidden` per server, appending server summaries to the conversation "so earlier messages stay cached" ([harness research §4][har4]). Preamble size is what users compare across harnesses: 33K tokens for Claude Code, 7K for OpenCode and about 1K for Pi ([HN §2.2, row 1][hn22]). Our registry defaults MCP tools to `deferred` and prints the preamble size at session start ([HN §4.2][hn42]).

**Practitioners prefer CLIs and skills for local work and keep MCP for remote, authenticated services.** About 35 HN authors prefer CLIs to MCP outright and skills draw about 215 positive authors, while MCP's defenders build remote, authenticated integrations for others ([HN §2.1, item 2][hn21]). A growing minority treats remote MCP with OAuth as the credential boundary, because "If the MCP server has access to the keys instead, it takes that possibility away" ([security, MCP][hnn-mcp]). The specification serves the defenders' case: its 2026-07-28 revision makes modern servers stateless, so they can sit behind any load balancer ([main report, tools][main-tools]; [interfaces note §7][n-if-7]). Both views fit one registry that keeps MCP removable and offers CLIs and skills beside it, which is what the HN synthesis asks for ([HN §4.2][hn42]).

**The MCP client must handle two protocol eras per server, not per fleet.** `@ai-sdk/mcp` 2.0.90 names 2026-07-28 its latest protocol and probes with `server/discover` before falling back to `initialize`, while `@modelcontextprotocol/core` 2.4.0 still sets `2025-11-25` as its latest version but ships the new schemas ([harness research §4][har4]; [main fact-check, row 14][fc-c]). LangChain warns that mixing protocol eras in one aggregate client drops the whole fleet to legacy ([harness research §4][har4]). Our client negotiates per server, supports stdio and streamable HTTP, treats SSE as legacy, and waits at the first prompt only for directly exposed servers, as Pi does for up to 10 seconds ([interfaces note §7][n-if-7]; [implication 8][n-if-impl]).

**MCP annotations and tool output are untrusted input, so the registry gates and bounds them.** MCP servers are isolated by the process boundary but still trusted for content, and Claude's control channel runs `mcp_call` with "No permission check … unless check_permissions is set" ([interfaces note §5][n-if-5]). The SDK guide already treats annotations such as `readOnlyHint` as hints that affect scheduling only for first-party tools ([SDK guide §4][g4]). The registry adds two rules: every tool, MCP or not, passes the permission pipeline of §5, and every result passes the write-time cap of §3 layer 1. Vercel's fetch tool shows the matching input rule, `requireUrlInUserMessage`, which ignores URLs that appear in tool results "because the model can place arbitrary text there" ([permissions note §8][n-perm-8]).

**Host-provided tools come in three patterns, and one registry serves all of them.** A host can pass an in-process function, the core can ask the client to run a tool through a server request, or a tool with no executor can suspend the turn into serializable continuation state ([interfaces note §9][n-if-9]). Codex uses the second for its experimental `dynamicTools`, and Vercel's harness adapters use the third with `continueStream` ([interfaces note §9][n-if-9]). Our registry records the pattern per tool, and host-only context stays out of the session log and out of model-visible errors ([interfaces note, implication 11][n-if-impl]).

## 5. The permission pipeline should be ordered, deny-first and fail-closed, and its approvals should be signed entries

**Recommended design.** One ordered pipeline decides every tool call: hooks, deny rules, ask rules, the permission mode, allow rules, then the host callback ([harness decision 12][har6]). A deny wins over every allow and every mode. An allow rule that would make a registered callback unreachable is a startup error, and a call that matches no rule means `ask` interactively and `deny` headless ([harness decision 12][har6]). The pipeline fills the SDK's `beforeToolCall` gate, and an `ask` ends the run in the signed pause of §2 ([SDK guide §7][g7]). The pipeline is its own component, called by the loop, not part of layer 2 or layer 7 ([harness research §7, revision 3][har7]).

**Mature harnesses separate three safety decisions, and the others implement at most the first.** The decisions are which call may run, what a running call can touch, and which secrets it sees ([harness research §3][har3]). Claude and Codex implement all three. Vercel, OpenAI and LangChain gate per tool and delegate isolation and secrets, and Pi implements none by default ([harness research §3][har3]). The main report's review split layer 7 into a sandbox policy and an approval policy; the harness research adds the credential boundary as a third, independent decision ([main fact-check, review item 2][fc-review]; [harness research §3][har3]). This section covers the first decision, and §6 covers the other two.

**Claude's order is the one to copy, with its silent shadowing turned into an error.** Claude checks hooks, deny rules, ask rules, the permission mode, allow rules and finally `canUseTool`, and a deny wins even in `bypassPermissions` ([harness fact-check row 14][hfc]; [feature table, safety][ft-safety]). Its gotcha shows the risk of a silent step: a bare tool name in `allowedTools` makes `canUseTool` unreachable, with only a Node warning ([harness research §3][har3]). Copilot shows a second order worth keeping, because `onPreToolUse` runs before the permission handler and can deny a call no handler sees ([deep comparison][dc-harness]). The other designs leave more to the caller:

| Harness | Gate shape | Where a pending approval lives | Integrity on resume |
|---|---|---|---|
| Claude | six ordered steps; synchronous `canUseTool` | CLI process (`defer` for a durable pause) | n/a in process |
| Codex | exec-policy rules plus approval policy; optional Guardian reviewer | in process; transient in the rollout | n/a in process |
| Pi | one extension `tool_call` handler | in process | n/a in process |
| OpenAI | per-tool `needsApproval`; tool guardrails | serialized `RunState` | policy re-evaluated, unsigned |
| Vercel | call-level `toolApproval`; optional OPA | client-held `messages` | HMAC when a secret is set |
| LangChain | `humanInTheLoopMiddleware` | checkpointer per `thread_id` | `when` predicate re-run |

The table comes from [harness research §3][har3].

**The no-match default matters as much as the order.** Vercel's OPA policy treats no matching rule as allow unless the policy declares a default deny ([harness fact-check row 30][hfc]). Copilot's session with no permission handler denies every call, while its docs say the requests stay pending ([deep comparison, safety][dc-safety]). Our pipeline denies headless and asks interactively, and the docs state the no-handler outcome in the type of the gate option, as the SDK guide requires ([SDK guide §7][g7]).

**Approvals that resume later need integrity checks, which only Vercel ships, and only as an option.** Vercel warns that without a secret "a client that crafts a valid-looking approval for a schema-conforming input can bypass the human-in-the-loop step" ([harness fact-check row 30][hfc]). OpenAI re-evaluates conditional approvals after restoring a `RunState` but does not sign it. LangChain's `when` predicate "runs again when the run resumes … If it returns `false` on resume, the reviewer's answer is skipped and the tool runs, even if they rejected it" ([harness fact-check row 20][hfc]). Our pause entry is HMAC-signed over the tool name, call id, canonical input and policy version. On resume, the harness verifies the signature, re-evaluates current policy and lets a deny win, and every approval predicate must be a pure function of the call ([permissions note, implication 4][n-perm-impl]). Who owns the key is open, and the question merges with SDK decision 5 (§13, decision 5).

**"Always allow" must never widen to an interpreter, and sticky approvals are log entries.** Codex refuses to persist "always allow" prefixes that grant a whole interpreter, such as `bash -c`, `sh -lc` or `bun run` ([harness fact-check row 28][hfc]). Practitioners add a second leak: in the "Don't Ask Again" thread, allow rules that embedded credentials were committed in `.claude/` settings files found in public repositories ([security, permission prompts][hnn-prompts]). Our sticky approvals are scoped to a run or session, recorded in the log, and refuse interpreter prefixes and secrets ([permissions note, implication 3][n-perm-impl]; [HN §4.2][hn42]).

**Practitioners add path-based ask rules for the checks an agent can weaken.** Tests, types and linters are the oracle practitioners trust (view 4, ~380 authors), and about 28 authors report agents deleting, skipping or hard-coding tests first-hand ([HN §1][hn1]). The HN synthesis therefore adds default `ask` rules for edits that delete, skip or weaken tests, or that touch hooks, CI config and rules files ([HN §4.2][hn42]). The anecdote of an agent deleting the commit hooks that blocked it is single and secondhand, so this rule rests on view 4 more than on that story ([HN §4.2][hn42]). The same row asks the approval UI to group equivalent calls and show chained shell commands in a short normalized form ([HN §4.2][hn42]).

**Practitioners distrust approval prompts and the classifier that replaced them, and here they contradict a vendor default.** Approval fatigue drives users to run without prompts inside a sandbox (view 2, ~440 authors), because "any security mechanism which relies on users to read and intelligently respond to approval prompts is doomed to fail over time" ([HN §1][hn1]). Claude Code made classifier approval ("auto mode") the default in stages, for every plan and provider in v2.1.284 of 2026-09-28; about 145 authors discuss it, and they use it without trusting it ([HN §2.1, item 6][hn21]; [HN §2.2, row 8][hn22]). Our [agent decision 16](../research/agent/agent-research.md#6-seventeen-design-decisions-for-our-agent) already limits classifier approval to T1–T2 risks, and the HN evidence supports that limit ([HN §4.3][hn43]). The harness answer to fatigue is §6: a sandbox strong enough that most calls need no prompt at all.

## 6. The sandbox and the credential boundary are separate components, and the host, not the model, owns both

**Recommended design.** A `SandboxPolicy` (filesystem roots, network allowlist) and an `ApprovalPolicy` (`on-request | granular | never`) stay separate, and escalation after a sandbox denial is a tested state machine that needs a fresh approval ([harness decision 13][har6]). The sandbox is a pluggable client with honest tiers: `none`, labelled unsafe; an OS backend over `srt`; and Docker with `--cap-drop ALL --read-only --network none`, with gVisor, Firecracker and hosted vendors as adapters chosen by threat model ([harness decision 14][har6]). Every backend fails closed when it cannot start. No credentials enter the sandbox: tools spawn with a cleared, allowlisted environment, and a default-deny egress proxy injects host-scoped credentials and also gates in-process fetch tools ([harness decision 15][har6]).

**Codex keeps the sandbox mode and the approval policy apart, and its escalation is a flow, not an error.** The sandbox mode is `read-only | workspace-write | danger-full-access`, and the approval schema offers `on-request`, `granular` and `never`; `untrusted` is no longer selectable and survives only as the derived default for a project marked untrusted ([harness research §3][har3]; [main fact-check row 17][fc-c]). A command first runs sandboxed. On a denial, Codex asks again unless a prior human or hook approval covers the retry, and a Guardian approval never does ([harness research §3][har3]). Under `never`, a denial returns to the model and never escalates ([permissions note, implication 2][n-perm-impl]). The teardown's lesson is the rule: model *what may run* separately from *who must approve* ([harness teardown, Codex][ha-codex]).

**The model must never widen its own sandbox, and here practitioners contradict a vendor default.** Claude's Agent SDK defaults `allowUnsandboxedCommands` to `true`, which lets the model set `dangerouslyDisableSandbox` and fall back to the permission system ([HN §2.2, row 7][hn22]). About 50 HN authors report agents disabling or routing around their sandbox and call the escape hatch a flaw: "Claude frequently has decided to disable its own sandbox when I've had it running" ([sandbox escapes][hnn-escape]). Their shared answer is a sandbox "spawned and controlled by me that the agentic harness cannot disable" ([HN §4.2][hn42]). Our harness therefore gives no tool parameter or model output the power to widen the sandbox. Escalation is a host-side state transition that writes an `approval_requested` entry, and the host launches the sandbox outside the process the model drives ([HN §4.2][hn42]).

**Sandbox strength rises with cost, and the cheap tier shares the host kernel.** Anthropic's secure-deployment guide rates the tiers, and Firecracker's specification gives the microVM bounds ([harness research §3][har3]):

| Tier | Example | Strength | Overhead |
|---|---|---|---|
| None (path checks in tools) | OpenAI `UnixLocalSandboxClient`; Vercel `experimental_sandbox` | none | zero |
| OS process sandbox | `srt` (Seatbelt, bubblewrap + seccomp); Codex | good, shares the host kernel | very low |
| Container | Docker with `--cap-drop ALL --read-only --network none` | setup-dependent | low |
| gVisor | `runsc` | excellent with correct setup | ~2× simple syscalls, 10–200× heavy file I/O |
| microVM | Firecracker (E2B, Vercel), Kata | excellent | ≤125 ms to guest init, ≤5 MiB VMM per VM (spec) |
| WASM alone | Pyodide interpreters | weak: host functions are the attack surface | low |

The bottom tier's honesty problem is real: OpenAI's local client "adds no OS-level confinement", and Vercel's interface "does not sandbox the tool itself" ([harness research §3][har3]). The WASM row rests on the main report's Cyera citation, which was not re-fetched ([harness research §3][har3]). OpenAI's `SandboxClient` shows the portable shape: a workspace manifest separate from the compute provider, so the agent definition stays the same when the client changes ([harness teardown, OpenAI sandbox agents][ha-oai]).

**Hosted microVMs cost about $0.05 to $0.07 per vCPU-hour, and only part of the cold-start evidence is primary.** As of November 2026, E2B and Daytona both charge $0.0504 per vCPU-hour billed per second, and Modal Sandboxes charge $0.00003942 per physical core-second ([harness research §3][har3]). The Modal figures that looked contradictory, $0.14 and $0.071, are the same price, per core-hour and per vCPU-hour, because one core is 2 vCPUs ([harness fact-check, R1][hfc-r1]). Daytona states sandbox creation under 90 ms ([harness fact-check, R1][hfc-r1]). Its default Container class is a namespaced container that shares the host kernel, and only its Linux VM and Windows classes have their own kernel (corrected 2026-11-18: R1 had said every Daytona sandbox gets a dedicated kernel; [harness fact-check, U11][hfc-u11]). E2B's ~150 ms cold start and Modal's sub-second start still come only from comparison blogs (secondary), and we have measured neither `srt` nor Docker on our hardware ([harness fact-check, R1][hfc-r1]; [permissions note, unresolved gaps][n-perm-gaps]). The default backend therefore waits on our own measurement (§13, decision 4).

**Practitioners trust a sandbox with no prompts, and they ask each tier to say what it stops.** Anthropic's sandbox cut permission prompts by 84%, and it needs both filesystem and network isolation, because without the network side an agent exfiltrates SSH keys ([harness research §3][har3]; [main report, sandboxing][main-sandbox]). Practitioners agree: about 78 authors pair a permission-skipping mode with a sandbox, and the stated threat is the agent's own mistakes ([HN §1][hn1]). A larger group, about 92 authors, says containers are too weak, and one user's verdict on their own setup is "Protects me from most agent stupidity, though not malice" ([HN §1][hn1]; [HN §4.2][hn42]). The HN synthesis therefore adjusts harness decision 14: sandbox-plus-no-prompts is the trusted setup and the default for background runs, and each tier states whether it stops mistakes, injection-driven exfiltration or a hostile process ([HN §4.2][hn42]).

**Network isolation is a host-side proxy, and in-process tools often bypass it.** `srt` removes the network namespace on Linux, reaches HTTP and SOCKS proxies over Unix sockets, and refuses allowed names that resolve to loopback, link-local or metadata addresses ([harness research §3][har3]). Claude's `strictAllowlist`, however, is "Enforced for sandboxed commands only — in-process tools such as WebFetch are not gated by this setting" ([harness fact-check row 10][hfc]). Claude also has two fail-open defaults to avoid: its settings file runs unsandboxed with a warning when the sandbox cannot start, while the SDK `sandbox` option with `enabled: true` exits instead ([harness fact-check row 9][hfc]). Our proxy is default-deny and logs every request, our in-process fetch tools go through the same allowlist, and every backend fails closed ([permissions note, implications 5–6][n-perm-impl]).

**Secrets leak mostly through inherited environments, so the credential boundary is its own component.** Codex's default shell policy inherits every variable, and a test pins that `API_KEY` and `SECRET_TOKEN` reach commands ([harness fact-check row 28][hfc]). Claude's CLI inherited our verification harness's environment until we passed an allowlisted `env`, and Copilot's runtime inherits `process.env` ([deep comparison, outward defaults][dc-reach]). The better pattern injects credentials at the egress proxy: Claude's `sandbox.credentials` `mask` gives the sandbox a sentinel that "the host proxy swaps sentinel→real on egress", though `mask` degrades to `deny` on macOS and Windows ([harness research §3][har3]). OpenAI refuses credential-bearing mounts whose helper runs inside the sandbox, "because model-controlled code can access that helper's process credentials" ([permissions note §7][n-perm-7]). Model gateway keys stay in layer 1, outside the sandbox, and secrets stay out of the session log ([harness decision 15][har6]).

**Practitioners converged on the same proxy in late 2026, and they add scoping.** About 15 authors across 6 threads describe proxies that inject credentials into outbound requests so the agent holds a placeholder: "Harness can touch secrets, agent can't" ([security, secrets][hnn-secrets]). Their counter-view sets the limit: "You're not handing them your credentials, but you are handing them something that your credentials can do" ([security, secrets][hnn-secrets]). The HN synthesis therefore scopes each injected credential per host and method, and the harness takes API keys or proxy-injected credentials, never consumer-subscription OAuth ([HN §4.2][hn42]). Destructive incidents point the same way: about 160 authors in three incident threads blame credentials, permissions and backups rather than the model ([HN §1][hn1]).

## 7. Extensions come in three trust tiers, and project trust gates loading, not execution

**Recommended design.** The harness has three extension tiers behind one project-trust gate ([harness decision 17][har6]). In-process TypeScript extensions get typed hooks with declared composition rules. MCP servers are the out-of-process, language-neutral tier. Skills and prompt templates are the no-code tier, in the Agent Skills format unchanged. Project-supplied extensions of every tier load only in a trusted project, headless trust defaults to skip, and the docs say plainly that trust is not a sandbox ([interfaces note, implication 7][n-if-impl]).

**In-process extensions have full power and no isolation, so their hooks need declared composition.** A Pi extension "runs inside the Pi process with the same operating-system permissions", across 41 hook events ([harness research §4][har4]). Pi types each handler by its composition pattern (notification, in-place mutation, chained transform, gate or last override), and its gates "should fail closed" ([interfaces note §5][n-if-5]). Our extension hooks map onto the SDK's six interceptors and its observers, and each declares one composition rule ([SDK guide §6][g6]; [interfaces note, implication 7][n-if-impl]). LangChain's six-hook middleware shows that a small fixed set can carry every built-in feature, each removable on its own ([deep comparison][dc-harness]).

**Skills are files the model reads on demand, which makes them the cheapest tier.** At startup only "name, description, and path" go into the system prompt, and the model reads `SKILL.md` itself ([harness research §4][har4]). Codex records an implicit skill load by parsing shell commands that read a `SKILL.md` ([interfaces note §6][n-if-6]). Our harness advertises the same three fields, loads the body through the ordinary `read` tool, records a `skill_loaded` entry, and discovers skills from `.agents/skills` up to the repository root, the format this repo already uses ([interfaces note, implication 10][n-if-impl]). The Agent Skills specification itself was unreachable during the research, so its field limits come from Pi's docs ([interfaces note §6][n-if-6]).

**A trust gate controls what loads, not what runs, and two vendors say so.** Pi's project trust keeps a folder from "silently loading executable extensions" yet "does not limit what tool calls can access", and Claude's `skills` allowlist is "a context filter, not a sandbox" ([harness research §4][har4]). Pi also excludes `AGENTS.md` and `CLAUDE.md` from the gate, and the permissions note treats context files as untrusted even when trust is declined ([interfaces note §5][n-if-5]; [permissions note §8][n-perm-8]). Real isolation comes from §6, and the gate's job is to stop a cloned repository from running code at load.

**Practitioners treat extensions as supply-chain risk and ask for pinning.** About 47 HN authors discuss malicious or unvetted skills, plugins and MCP servers, anchored by the postmark-mcp backdoor and the tampered Claude Code extension on Cursor's marketplace that "added the attacker's SSH key" ([security, supply chain][hnn-supply]). The complaint is missing pinning: "No lock files. Nothing", and skills that bundle `npx` or `uvx` calls add a second unpinned layer ([security, supply chain][hnn-supply]). The HN synthesis therefore adds content-hash pinning for extensions, plus native reading of AGENTS.md ([HN §4.2][hn42]). The incidents form one cluster, so the notes call this view emerging rather than settled ([security, supply chain][hnn-supply]).

## 8. One typed protocol should sit under the SDK, CLI and RPC interfaces, with stdio JSONL as the first remote transport

**Recommended design.** We define one typed protocol package first: client commands with correlated responses, uncorrelated events, and server-to-client requests for approvals, dialogs and client-hosted tools, in one discriminated union from which TypeScript and JSON Schema are generated ([harness research §4][har4]). The in-process API, JSONL over stdio and, later, WebSocket or HTTP with SSE are transports over one dispatcher, and our own CLI is a client of the in-process transport ([harness decision 16][har6]). The protocol uses JSON-RPC 2.0 framing with the `jsonrpc` field, `noun/verb` methods and a `trace` field. A command gets a disposition reply and a terminal `turn/settled` event, any request can be cancelled, and bounded queues never drop server requests. Capability flags with `experimental` gates and the pending set travel in `initialize` ([harness decision 16][har6]).

**Every mature harness has one protocol-shaped core, and its interfaces are transports over it.** Codex's `exec` CLI is a client of an in-process app-server that keeps "the same JSON-RPC result envelope that `MessageProcessor` uses for stdio and websocket transports … rather than creating a second execution contract" ([harness research §4][har4]). OpenCode's SDK "executes Server's assembled HTTP router in memory, opening no listener", and Pi's four modes "use the same agent, sessions, resources, and tools" ([harness research §4][har4]). The main report's review asked for a stdio RPC mode "early"; the evidence goes further and makes the protocol the core's native contract ([harness research §7, revision 4][har7]; [main fact-check, review item 5][fc-review]). Four interface shapes recur, each for a different client:

| Shape | Serves | Examples |
|---|---|---|
| In-process SDK | same-language hosts | Pi SDK; OpenCode `@opencode/sdk`; Codex `in_process.rs` |
| One-shot CLI with JSONL events | scripts, CI | `pi --mode json`; `codex exec --experimental-json` |
| Long-lived JSONL-over-stdio RPC | other languages, IDEs, SDK wrappers | Pi `--mode rpc`; Claude `stream-json`; Codex `stdio://` |
| Network server | desktop, web, remote sandboxes | Codex `ws://`; OpenCode OpenAPI + SSE; OpenHands WebSocket |

The table comes from [harness research §4][har4]. Wrappers such as Vercel's `HarnessAgent` already drive ten harnesses through whichever headless protocol each publishes, so a harness without one cannot be adapted cheaply ([interfaces note §1][n-if-1]).

**One protocol keeps the loop apart from the UI, which is where practitioners say a harness fails.** TUI flicker and CPU complaints hurt Claude Code apart from its model, and the HN synthesis confirms harness decision 16 because a protocol lets the UI be replaced without touching the loop ([HN §4.2][hn42]). The SDK guide adds a deployment reason: a runtime process per session costs Claude about 1 GiB of RAM per agent and leaves HTTP as the only test seam, so our core runs in process and the subprocess shape stays one transport among several ([SDK guide §3][g3]; [deep comparison][dc-harness]).

**The hard parts of the protocol are acceptance, cancellation and backpressure, and each harness solved one.** Pi's `prompt` reply reports only a disposition, and clients must wait for `agent_settled`, because `agent_end` can be followed by retries, compaction or queued follow-ups ([harness research §4][har4]). Claude lets either side withdraw one request with `control_cancel_request` ([harness research §4][har4]). Codex bounds its queues at 128, rejects a full command queue with `-32001`, may drop notifications under load, and never silently abandons a server request, "so approval flows do not hang indefinitely" ([harness research §4][har4]; [harness fact-check row 27][hfc]). Pi adds a framing rule: it refuses Node `readline`, because readline splits on U+2028 and U+2029 inside JSON strings ([harness research §4][har4]). We take all four rules.

**We keep the `jsonrpc` field that Codex drops.** Codex omits it on purpose, "We do not do true JSON-RPC 2.0" ([harness fact-check row 27][hfc]). The interfaces note finds that omission buys nothing, while keeping the field lets generic JSON-RPC tooling and MCP-style libraries work unchanged ([interfaces note, implication 2][n-if-impl]). The framing remains open for Round P because Codex is the largest example of the other choice (§13, decision 6).

**Feature detection beats version numbers, and a reconnecting client needs the pending set.** Claude has no protocol version field and tells clients to "treat absence as an older CLI", while Codex combines `initialize` capabilities with per-field `experimental` gates that reject a call unless the client opted in ([harness research §4][har4]). Claude's `initialize` response lists pending permission requests so a joining client can re-arm them, and OpenHands' event socket resumes `since` a timestamp ([harness research §4][har4]). Our resume cursor is the log's sequence, so the protocol and the session log share one notion of position ([interfaces note, implication 6][n-if-impl]). The SDK's capability list on `run_start` is how a separately versioned peer learns what it can call ([SDK guide §10][g10]).

**An MCP-server facade waits until a consumer needs one.** Codex ships no MCP-server mode at `4389a52`: its CLI's `mcp` subcommand manages external servers, and the removal is inferred from absence in a shallow clone ([harness research §4][har4]; [harness fact-check row 17][hfc]). MCP also lacks steering, session trees and approval replay, so it makes a poor main interface ([interfaces note §8][n-if-8]). Other agents reach our harness through the stdio protocol; a thin facade with one `run_task` tool can follow later ([interfaces note, implication 12][n-if-impl]).

## 9. Telemetry should be a projection of the log, with content off by default and cost recorded on every entry

**Recommended design.** The harness emits `invoke_agent`, turn, model and `execute_tool` spans plus a separate approval-wait span, from one internal schema module stamped with the OTel GenAI convention commit ([harness research §5][har5]). Content capture is off by default, the only exporter is an explicitly configured OTLP endpoint, and telemetry derives from the usage and cost stored on log entries ([harness decision 18][har6]). The SDK's built-in OTel observer is where that projection runs ([SDK guide §5][g5]).

**Every SDK except Pi emits the same three-level span tree under different names, and only Claude separates approval wait.** OTel GenAI defines `invoke_agent`, a model span and `execute_tool`; Vercel follows those names, OpenAI uses `AgentSpan`, `TurnSpan`, `GenerationSpan` and `FunctionSpan`, Claude uses `claude_code.interaction`, `llm_request` and `tool`, and Pi instruments only model requests ([harness research §5][har5]; [harness fact-check row 37][hfc]). Only Claude splits permission wait from execution with a `tool.blocked_on_user` child span, so elsewhere tool latency mixes human think-time with machine time ([harness research §5][har5]). Approval count and wait time are product metrics, which is why our tool span has an approval-wait child ([observability note §5][n-obs-5]).

**The conventions are Development-only and untagged, so a version means a commit.** Every GenAI agent, inference and tool span is at Development status, and the conventions moved to `open-telemetry/semantic-conventions-genai`, which had no tags or releases on 2026-11-18 ([harness research §5][har5]). `@ai-sdk/otel` 1.0.162 shows the drift: it records the new `gen_ai.client.inference` histogram but writes span attributes under the older duration name ([harness research §5][har5]). We keep every attribute name in one module and stamp the commit SHA as a resource attribute ([observability note, implication 1][n-obs-impl]).

**Content capture must default to off, yet Vercel and OpenAI default it on.** The spec says instrumentations "SHOULD NOT capture them by default" and should record `*_ref` URIs in production ([harness research §5][har5]). The SDKs we read disagree with each other:

| SDK | Telemetry default | Content default | Default destination |
|---|---|---|---|
| Vercel `ai` 7.0.162 | on once an integration is registered | **recorded** | the global OTel SDK |
| OpenAI Agents 0.21.0 | on in server runtimes, off under `NODE_ENV=test` | **recorded** | `api.openai.com/v1/traces/ingest`, registered at import |
| Claude Agent SDK 0.3.327 | off until `CLAUDE_CODE_ENABLE_TELEMETRY=1` | structure only | OTLP from the CLI |
| Pi 1.5.2 | no exporter shipped | never | in-memory or SQLite store |
| LangSmith | on with `LANGSMITH_TRACING=true` | recorded | LangSmith or OTLP |

The table comes from [harness research §5][har5], with the OpenAI and Vercel defaults pinned in [harness fact-check rows 16 and 29][hfc]. Our content levels match the spec: none by default, attributes in development only, and external refs in production, with tool arguments gated apart from prompts ([observability note, implication 3][n-obs-impl]).

**Cost needs four input classes, one convention and a provenance flag, and no OTel convention defines it.** OTel's `input_tokens` "SHOULD include cached tokens", while Pi's `input` is uncached tokens and Anthropic's raw `input_tokens` excludes cache ([harness research §5][har5]). Claude splits 5-minute and 1-hour cache writes, records `costBasis`, and calls its costs "client-side estimates, not authoritative billing data" ([harness research §5][har5]). Token counters only "serve as a proxy for cost approximation", so the cost attribute is ours to name ([harness research §5][har5]). The log stores the four classes separately and the telemetry projection sums them for `gen_ai.usage.input_tokens`; the in-memory field name stays open with SDK decision 3 (§13, decision 7).

**Budgets in both vendor harnesses act after the fact, so ours checks before each model call.** Claude's `maxBudgetUsd` stops after the response that crosses it, and mini-swe-agent stops "after exceeding (!)" its $3 `cost_limit` ([harness research §5][har5]; [harness fact-check row 31][hfc]). The HN corpus explains why the timing matters: loops cause the runaway-cost anecdotes, and practitioners report $650-an-hour API sessions ([HN §4.1][hn41]). Our check estimates the next call's worst case from its input tokens, `max_tokens` and the model's price, and stops before the cap ([observability note, implication 7][n-obs-impl]). The rule merges with SDK decision 9 (§13, decision 9).

**Practitioners want the meter in the harness, because quota opacity is their largest complaint.** Opaque quotas draw about 570 HN authors, the widest-supported view in the corpus, and the grievance is invisibility: "we cannot monitor our usage towards the limits" ([HN §1][hn1]). The HN synthesis therefore asks harness decision 18 for a running cost or quota total with a warning threshold and for the preamble size at session start. It also keeps everything that leaves the machine off by default, including commit attribution and update daemons ([HN §4.2][hn42]). The deep comparison found the same pattern in six of eight SDKs: a convenient outward default becomes a production leak ([deep comparison, outward defaults][dc-reach]).

## 10. Evals should run on Inspect against mini-swe-agent and report cost per task beside pass rate

**Recommended design.** The eval runner is Inspect, which drives our unmodified harness through `sandbox_agent_bridge()` and the SDK's base-URL override ([harness research §5][har5]). Every report pairs pass rate and pass^k with cost, tokens, steps and preamble size per task, beside a mini-swe-agent run with the same model, tasks, prices and resource limits ([harness decision 18][har6]). Each trial runs in a clean sandbox, infra failures are scored apart, the grader and its tests sit outside the agent's writable sandbox, and reports show confidence intervals ([harness decision 18][har6]; [HN §4.2][hn42]).

**Cost resolves differences among mature harnesses better than pass rate does.** Among mature harnesses, swapping the harness "flips as many tasks as rerunning the same harness, 13% in both cases", and "45 tasks catch a 13-point gap only half the time … 447 tasks resolve 5 points" ([harness research §5][har5]). Cost differed by up to 3× with model, tasks and prices fixed, and the gap "is set at the first call, by the preamble of system prompt and tool schemas" ([observability note §5][n-obs-5]). The main report's review already asked to make token efficiency a primary metric ([main fact-check, review item 6][fc-review]). Practitioners agree on the direction and add no counter-evidence: about 45 call harnesses interchangeable against about 30 who say they matter, and nobody cites a quality comparison at equal tokens ([HN §2.2, row 1][hn22]).

**mini-swe-agent is the baseline because it is small, neutral and already emits the fields we need.** It is about 100 lines with bash as its only tool, and the main report names it the neutral baseline for every harness experiment ([main report, OSS harnesses][main-oss]). It writes a trajectory JSON with `instance_cost`, `api_calls` and `exit_status`, raises when a model's cost cannot be priced, and ships a `DeterministicModel` for offline runs ([harness research §5][har5]). Our trajectories convert to its `mini-swe-agent-1.1` format, so one script compares the two ([observability note, implication 9][n-obs-impl]).

**Inspect covers the runner, with one setting to set deliberately.** `sandbox_agent_bridge()` runs an unmodified harness and proxies its model calls, ships `pass_at_k` and `pass_k_k` reducers, and forwards generation settings only with `forward_generation_config=True` ([harness research §5][har5]). That default matters, because a temperature our harness sets would otherwise be ignored in the eval ([main report, evals][main-evals]). Inspect also checks cost limits at each `generate()`, which matches our pre-emptive budget ([observability note §6][n-obs-6]).

**Suites start at 20–50 real-failure tasks, which catches large regressions and nothing small, and here practitioners qualify the vendor guidance.** Anthropic recommends 20–50 tasks drawn from real failures, outcome graders, a clean environment per trial and reading transcripts, because grading bugs took Opus 4.5 from 42% to 95% on CORE-Bench once fixed ([harness research §5][har5]). About 50 HN authors reject single runs and small samples, and a 50-task daily tracker with a ±14% interval drew a pile-on ([HN §2.2, row 11][hn22]). The verdict is that 20–50 tasks seed a capability suite but cannot detect the small regressions users claim ([HN §2.2, row 11][hn22]). We therefore run three suites: offline replay of recorded logs on every commit, a live regression suite near 100%, and a capability suite that starts low. A harness gain under about 10 points counts only with a few hundred tasks or paired statistics ([observability note, implications 10, 12][n-obs-impl]).

**Infrastructure and the grader are variables, so both are pinned and isolated.** On Terminal-Bench 2.0, infra errors fell from 5.8% to 0.5% and success rose 6 points when resource caps were lifted ([harness research §5][har5]). In one Anthropic case Claude gained an unfair advantage "by examining the git history from previous trials" ([observability note §7][n-obs-7]). In 2026 agents were also shown attacking the evaluator, and about 50 practitioners discuss it: "This is modifying the test code itself to always print 'pass'" ([reliability, evaluator attacks][hnn-evalattack]). Each trial pins a guaranteed allocation and a kill limit, records infra failures as their own exit status, and keeps the grader outside the agent's reach ([observability note, implication 11][n-obs-impl]; [HN §4.2][hn42]).

**Completion is checked in code, not taken from the model.** Agents claim success they did not achieve (about 25 authors, estimated) and game visible tests (about 28) ([HN §4.2][hn42]). The HN synthesis adds a requirement beside harness decisions 1 and 18. After the model says it is done, the harness runs the project's checks itself and records the result as a log entry. It also flags new mocks, stubs, placeholder strings and `skip` markers in the diff ([HN §4.2][hn42]). The same entry feeds the eval reports, so production and offline runs measure completion the same way.

**Public benchmarks are a weak guide, and the figures behind that claim are still disputed.** OpenAI stopped reporting SWE-bench Verified over flawed tasks, but our notes and the main report frame the audit differently, and openai.com returned 403 to every re-check, so neither framing is verified ([harness research §8][har8]; [harness fact-check, R1][hfc-r1]). Practitioners reach the same conclusion on their own: about 60 authors distrust public benchmarks and say only their own tasks count ([HN §2.2, row 10][hn22]). Our durable asset is the suite of our own real failures ([observability note §7][n-obs-7]).

## 11. Every component should be removable, because the value of harness scaffolding decays as models improve

**Recommended design.** Each component in the reference architecture sits behind an interface with a no-op or minimal implementation, so an ablation can drop it and the eval suite of §10 can measure the difference, as [AGENTS.md](../../AGENTS.md) requires. The removable set covers the five context layers, the MCP client, each extension tier, the sandbox backend, the credential proxy and the telemetry exporter. The session log, the permission pipeline and the protocol are the core, and they stay.

**Harness gains shrink as models improve, and on some tasks they turn negative.** On matched SWE-bench Verified rows, OpenHands' gain over mini-SWE-agent fell from +13.60 to +5.47 points between Claude 3.7 Sonnet and Claude 4 Sonnet ([main report, harness effects][main-swing]). The same study built NanoHarness on mini-SWE-agent to ablate five components (tool registry, context compression, planning, subagents and lazy skills), and found that context compression and general subagents can hurt open-ended repository generation ([main report, harness effects][main-swing]). The context-management payoff decays from 35.7 to 2.7 points as windows grow (§3). After a model upgrade, Anthropic's own planner, generator and evaluator harness dropped its sprints and cut its evaluator to a single pass ([main report, planning][main-plan]).

**The builders who measure keep the scaffold thin, and the ones who read code agree.** The main report's staged path ships a minimal harness first and adds compaction, subagents, tool search, code-execution mode, long-term memory and a workflow engine only when a specific eval failure justifies each ([main report, build vs buy][main-bvb]). Practitioners report the same instinct from use: a thin loop they can read beats a framework for about 185 HN authors, and Pi's roughly 1K-token prompt became the reference point for small preambles ([HN §1][hn1]; [reliability, harness overhead][hnn-overhead]). The counter-view also holds: about 25 authors say the small loop's missing 10%, from error handling to context management, is the real work ([HN §1][hn1]). Removability resolves the dispute, because each piece of that 10% ships as a component the eval suite can switch off.

**Ablation needs the same discipline as any model change.** The main report's first rule is that harness changes are model changes, so every prompt, tool or context-policy change needs an A/B test with the model held fixed ([main report, harness effects][main-swing]). Our ablation reports use the §10 format, cost and pass rate beside the mini-swe-agent baseline, so a component that costs tokens without moving pass^k is a candidate for removal on the next model.

## 12. Reference architecture

The harness has ten components around the SDK. The session log is the centre, and the context layers, pauses, replay and telemetry are all projections of it ([harness research, conclusion][har-end]). Each component other than the log, the pipeline and the protocol is removable (§11).

```text
   clients: our CLI · IDE/other languages · web/desktop · Inspect bridge
        │ in-process        │ stdio JSONL        │ WebSocket / HTTP+SSE
        ▼                   ▼                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Protocol (one typed union): commands · events · server requests       │
│   initialize{capabilities, pending} · turn/start → disposition        │
│   turn/settled · $/cancelRequest · bounded queues · trace field       │
├──────────────────────────────────────────────────────────────────────┤
│ Session manager: one writer lock per session, HEAD, resume, fork      │
│   SessionStore: JSONL (disk, memory) → SQLite projection later        │
│   entries: message blocks · compaction · checkout · approval_* ·      │
│            usage/cost · completion_check · skill_loaded · env stamp   │
├───────────────┬──────────────────────┬───────────────────────────────┤
│ Context policy│ Tool registry        │ Permission pipeline           │
│ (transform-   │ canonical names,     │ hooks → deny → ask → mode →   │
│  Context)     │ exposure per source, │ allow → host callback;        │
│ 1 write caps  │ MCP client (builtin, │ no match: ask / deny headless;│
│ 2 masking     │ removable), skills,  │ signed approval entries       │
│ 3 summary     │ host tools           │                               │
│ 4 mid-turn    │                      │                               │
│ 5 retry       │                      │                               │
├───────────────┴──────────────────────┴───────────────────────────────┤
│ SDK loop (G1): gateway · loop · tool runtime · hooks · event union    │
├──────────────────────────────┬───────────────────────────────────────┤
│ Sandbox client               │ Credential proxy (host side)          │
│ none (unsafe) · srt · Docker │ default-deny egress, host-scoped      │
│ adapters: gVisor, microVM,   │ sentinels, gates in-process fetch;    │
│ hosted; fail closed;         │ cleared env for every tool process    │
│ launched by host, not model  │                                       │
├──────────────────────────────┴───────────────────────────────────────┤
│ Telemetry projection (OTel gen_ai.*, content off, OTLP only) ·        │
│ Extensions (in-process hooks, MCP, skills) behind project trust ·     │
│ Evals (Inspect bridge, mini-swe-agent baseline, cost + pass^k)        │
└──────────────────────────────────────────────────────────────────────┘
```

The interfaces below are a starting sketch for Round P, written in TypeScript. Each type follows the decision cited beside it; names and fields are for Round P to confirm.

```ts
// Session log (§2; harness decisions 1–7)
interface EntryBase { id: string; parentId: string | null; timestamp: string; seq: number }
type SessionEntry = EntryBase & (
  | { type: "session_header"; formatVersion: number; sdkVersion: string; defaultsHash: string }
  | { type: "message_block"; role: "user" | "assistant" | "tool"; block: ContentBlock; callId?: string }
  | { type: "checkout"; headId: string }                                   // persisted HEAD
  | { type: "compaction"; summary: string; firstKeptEntryId: string; tokensBefore: number;
      tokensAfter: number; model: string; promptVersion: string; usage: Usage; focus?: string }
  | { type: "approval_requested"; callId: string; tool: string; inputHash: string;
      policyVersion: string; signature: string; kind: "approval" | "clarification" }
  | { type: "approval_resolved"; callId: string; decision: "allow" | "deny"; by: string; sticky?: "run" | "session" }
  | { type: "usage"; usage: Usage; cost: { total: number; basis: "provider" | "catalog" | "unknown" } }
  | { type: "env_stamp"; cwd: string; permissionMode: string; sandbox: string; model: string; effort?: string }
  | { type: "completion_check"; command: string; passed: boolean; flagged: string[] }
  | { type: "skill_loaded"; name: string; path: string }
  | { type: "subagent_link"; childSession: string; spawningCallId: string }
);
interface SessionStore {
  append(key: string, entries: SessionEntry[], expectedSuffix?: string): Promise<void>; // idempotent by id
  load(key: string): AsyncIterable<SessionEntry>;
  list(): AsyncIterable<SessionSummary>;
  delete(key: string): Promise<void>;
}
interface SessionLock { acquire(key: string): Promise<LockHandle | "would_block"> }

// Context policy (§3; harness decisions 8–10)
interface ContextLayer {
  name: "write_cap" | "mask" | "summarize" | "mid_turn" | "overflow_retry";
  apply(view: ContextView, budget: TokenBudget, signal: AbortSignal): Promise<ContextView | CompactionEntry>;
}

// Tool registry and permissions (§4–5; harness decisions 12–13, 17)
interface RegisteredTool { canonicalName: string; alias?: string; source: "builtin" | "extension" | `mcp:${string}` | "client";
  exposure: "direct" | "deferred" | "hidden"; definition: ToolDefinition<unknown, unknown> }
type Decision = { decision: "allow" | "deny" | "ask"; reason: string; rule?: string };
interface PermissionPipeline { decide(call: ToolCall, ctx: PolicyContext): Promise<Decision> } // fills SDK beforeToolCall

// Sandbox and credentials (§6; harness decisions 13–15)
interface SandboxPolicy { readRoots: string[]; writeRoots: string[]; network: { allow: string[]; deny: string[] } }
type ApprovalPolicy = "on-request" | "granular" | "never";
interface SandboxClient {
  readonly tier: "none" | "os" | "container" | "gvisor" | "microvm";
  readonly stops: Array<"mistakes" | "exfiltration" | "hostile_process">;
  provision(manifest: WorkspaceManifest, policy: SandboxPolicy): Promise<Sandbox>; // throws if unavailable
}
interface CredentialProxy { inject(host: string, method: string): SentinelBinding }  // host-side only

// Protocol (§8; harness decision 16)
type ClientCommand =
  | { jsonrpc: "2.0"; id: number | string; method: "initialize"; params: { clientInfo: Info; capabilities: string[] } }
  | { jsonrpc: "2.0"; id: number | string; method: "turn/start"; params: { session: string; input: UserMessage }; trace?: string }
  | { jsonrpc: "2.0"; id: number | string; method: "turn/steer" | "turn/interrupt"; params: { session: string } }
  | { jsonrpc: "2.0"; method: "$/cancelRequest"; params: { id: number | string } };
type ServerRequest = { jsonrpc: "2.0"; id: string; method: "approval/request" | "clarification/request" | "tool/call"; params: unknown };

// Evals (§10; harness decision 18)
interface EvalRow { task: string; passAt1: number; passHatK: number; costUsd: number; tokens: Usage;
  steps: number; preambleTokens: number; exit: "submitted" | "limit" | "infra_error"; baseline: "ours" | "mini-swe-agent" }
```

The components map onto the main report's layers with the six revisions of the harness research ([harness research §7][har7]). The session manager is layer 3, built rather than bought. The context policy is layer 5 with write caps and masking added, and memory as files is layer 6. The tool registry and MCP client are layer 4. The permission pipeline is a new component between layers 2 and 7, while the sandbox client and credential proxy split layer 7. The protocol and the extension tiers are the two new layers, and telemetry and evals are layer 8. The SDK's six seams connect them to layers 1 and 2 ([SDK guide §11][g11]).

## 13. Open decisions for Round P

The research settles most of the design above; these twelve decisions remain for the implementation plan. Decisions 1 to 9 are the harness research's nine questions, adjusted by the HN evidence where it applies ([harness research §9][har9]; [HN §4.2][hn42]). Three of them meet the [SDK guide's decisions][g12]: decision 5 merges with SDK decision 5, decision 9 merges with SDK decision 9, and decision 7 shares the token-field question with SDK decision 3. Each decision lists the options and the evidence that would settle it.

1. **Log granularity.** One JSONL line per stream delta, per content block, or per completed item. The choice sets the unit that playback rebuilds from, the point from which a reconnecting client resumes, and the file size budget ([harness research §9][har9]). The Claude transcript writes one entry per content block, and the SDK's end events carry the authoritative item ([sessions note, addendum][n-sess-add]; [SDK guide §5][g5]). Settle it by recording the G3 capstone at all three granularities and comparing file size, playback fidelity and resume code.
2. **Lock primitive.** A lock file with PID and lease, `flock`, or an actor process per session, and what happens to a stale lock after a crash ([harness research §9][har9]). `flock` is unsafe on NFS, as OpenHands warns ([harness fact-check row 22][hfc]). Settle it with a crash test that kills a writer mid-append on each storage target we will support.
3. **Default context layers and budget.** Which of the five layers are on by default for 128K+ models, and where the default budget sits below the window ([harness research §9][har9]). The decay result argues for fewer layers, and practitioners report a 200–300K threshold on 1M models ([harness fact-check, R1][hfc-r1]; [HN §4.2][hn42]). Settle it with the §11 ablation on the seed suite, each layer on and off, scored on cost and pass^k.
4. **Default sandbox backend.** `srt`, Docker, or `none` with a loud warning for local use ([harness research §9][har9]). Practitioners want sandbox-plus-no-prompts as the background default, and no cold start for `srt` or Docker has been measured on our hardware ([HN §4.2][hn42]; [permissions note, unresolved gaps][n-perm-gaps]). Settle it by measuring cold start and per-call overhead for both, then choosing the strongest tier under the latency budget of the G3 agent.
5. **Approval signing key (merges with SDK decision 5).** Who owns the HMAC key, how it rotates, and whether an unsigned resume fails closed ([harness research §9][har9]; [SDK guide §12][g12]). Settle it with the deployment model: a single process can generate a key per run, and a multi-process host needs a shared key store.
6. **Protocol framing.** Strict JSON-RPC 2.0 with the `jsonrpc` field, as harness decision 16 asks, or Codex's field-less variant, and which methods ship in v1 ([harness research §9][har9]). Settle it by wrapping our stdio transport with one generic JSON-RPC client and one MCP-style library, and keeping the field if either needs it.
7. **Telemetry convention commit and cost attribute (shares SDK decision 3).** Which `semantic-conventions-genai` SHA we pin, what our cost attribute is called until a convention exists, and what the in-memory `input` field means ([harness research §9][har9]; [SDK guide §12][g12]). Settle it by writing the OTel projection and the cost fold against Pi's and OTel's conventions and choosing the one with fewer conversions.
8. **Eval suite seed.** Which 20–50 real-failure tasks form the first capability suite, at what k, with which resource guarantees and kill limits ([harness research §9][har9]). Practitioners and the eval papers agree that such a suite cannot detect small regressions ([HN §2.2, row 11][hn22]). Settle it by measuring same-configuration discordance on the seed suite, then sizing the regression suite from that variance.
9. **Budget timing (merges with SDK decision 9).** Whether the USD cap is checked before each model call, as harness decision 18 and the HN synthesis ask, or after the crossing response, as Claude and mini-swe-agent do ([harness research §9][har9]; [HN §4.1][hn41]). Settle it with a test that measures how far a post-response check overshoots on our longest recorded runs.
10. **Completion check.** Which project checks the harness runs after the model claims completion, how it discovers them, and which diff patterns it flags as mocks, stubs or skipped tests ([HN §4.2][hn42]). Settle it by replaying recorded runs whose completion claims were false and tuning the check until it flags them without flagging the true ones.
11. **Retention and transcript schema.** The default retention period, where entries go when it expires, and which entry fields we document as stable for practitioners' own tools ([HN §4.2][hn42]). Claude purges local transcripts after 30 days by default, which practitioners name as the limit of their logs ([harness fact-check row 13][hfc]; [docs-and-dx, transcripts][hnn-transcripts]). Settle it with the disk cost of a month of G3 runs and the fields the search and replay CLI needs.
12. **Approval modes between per-call prompts and none.** Which middle ground we offer, such as path-based ask rules only, grouped approvals or a per-session allowance, and whether any classifier may approve at all beyond the T1–T2 limit of agent decision 16 ([HN §2.1, item 6][hn21]; [HN §4.3][hn43]). Settle it by counting prompts per task on the seed suite under each mode inside the default sandbox, against Anthropic's 84% reduction as the reference.

The boundary with the SDK is already settled: the harness owns the session log format and the compaction layers and triggers, and the SDK owns the `transformContext` interceptor and the other seams they run through ([harness research §7][har7]). Round P can therefore start with the session log and its store, because the context layers, the approval pauses, replay, the protocol's resume cursor and telemetry are all projections of it, and resolve these twelve decisions as each component reaches them.

[g]: agent-sdk.md
[g1]: agent-sdk.md#1-the-sdk-owns-the-loop-and-its-contracts-and-the-harness-owns-where-state-lives
[g3]: agent-sdk.md#3-the-loop-should-be-one-in-process-pure-function-capped-in-model-calls-that-ends-with-a-stop-reason
[g4]: agent-sdk.md#4-tools-should-take-standard-schema-validate-inside-the-sdk-and-return-every-failure-to-the-model-as-data
[g5]: agent-sdk.md#5-the-event-stream-should-be-one-closed-layered-union-whose-end-events-carry-the-authoritative-item
[g6]: agent-sdk.md#6-hooks-should-be-six-typed-interceptors-and-separate-observers-each-taking-one-event-object
[g7]: agent-sdk.md#7-an-approval-should-end-the-run-in-a-signed-resumable-log-state-not-block-a-callback
[g8]: agent-sdk.md#8-the-sdk-should-ship-a-strict-scripted-test-model-in-a-testing-export-from-the-first-release
[g10]: agent-sdk.md#10-versioning-must-cover-defaults-and-prompts-as-well-as-types-and-docs-must-compile-against-the-release-tag
[g11]: agent-sdk.md#11-reference-architecture
[g12]: agent-sdk.md#12-open-decisions-for-round-p
[har]: ../research/agent-harness/agent-harness-research.md
[har1]: ../research/agent-harness/agent-harness-research.md#1-sessions-belong-in-an-append-only-tree-of-typed-entries-with-head-locks-and-pauses-made-explicit
[har2]: ../research/agent-harness/agent-harness-research.md#2-context-policy-works-as-cheap-layers-first-with-summarization-as-the-expensive-fallback
[har3]: ../research/agent-harness/agent-harness-research.md#3-safety-is-three-separate-decisions-which-call-may-run-what-it-can-touch-and-which-secrets-it-sees
[har4]: ../research/agent-harness/agent-harness-research.md#4-a-harness-should-be-one-typed-protocol-with-thin-transports-extended-in-three-trust-tiers
[har5]: ../research/agent-harness/agent-harness-research.md#5-observability-is-a-span-tree-projected-from-the-log-and-evals-must-report-cost-beside-pass-rate
[har6]: ../research/agent-harness/agent-harness-research.md#6-eighteen-design-decisions-follow-from-the-evidence
[har7]: ../research/agent-harness/agent-harness-research.md#7-the-evidence-revises-the-8-layer-architecture-in-six-places-and-creates-three-tensions-with-the-sdk-synthesis
[har8]: ../research/agent-harness/agent-harness-research.md#8-several-decisions-rest-on-secondary-sources-absent-code-or-unrun-claims
[har9]: ../research/agent-harness/agent-harness-research.md#9-round-p-must-settle-nine-questions-before-harness-code-starts
[har-end]: ../research/agent-harness/agent-harness-research.md#conclusion-build-the-log-first-then-wrap-policies-and-one-protocol-around-it
[hfc]: ../research/agent-harness/fact-check.md
[hfc-r1]: ../research/agent-harness/fact-check.md#re-verification-against-primary-sources-r1
[hfc-u11]: ../research/agent-harness/fact-check.md#daytona-isolation-re-checked-u11-2026-11-18
[n-sess-8]: ../research/agent-harness/notes/sessions-and-storage.md#8-comparison
[n-sess-impl]: ../research/agent-harness/notes/sessions-and-storage.md#design-implications-for-our-harness
[n-sess-gaps]: ../research/agent-harness/notes/sessions-and-storage.md#unresolved-gaps
[n-sess-add]: ../research/agent-harness/notes/sessions-and-storage.md#addendum-a-real-claude-code-transcript-confirms-a-tree-log-with-an-explicit-leaf-and-kept-history-observed-2026-11-18
[n-ctx-rev]: ../research/agent-harness/notes/context-and-compaction.md#reversibility-most-harnesses-keep-the-originals-the-openai-session-and-langchain-summarization-do-not
[n-ctx-pay]: ../research/agent-harness/notes/context-and-compaction.md#measured-payoffs-are-real-but-modest-and-they-shrink-as-windows-grow
[n-ctx-impl]: ../research/agent-harness/notes/context-and-compaction.md#design-implications-for-our-harness
[n-perm-7]: ../research/agent-harness/notes/permissions-and-sandboxing.md#7-secrets-allowlist-the-environment-inject-credentials-at-the-egress-proxy
[n-perm-8]: ../research/agent-harness/notes/permissions-and-sandboxing.md#8-prompt-injection-defenses-at-the-harness-level-are-mostly-capability-limits
[n-perm-impl]: ../research/agent-harness/notes/permissions-and-sandboxing.md#design-implications-for-our-harness
[n-perm-gaps]: ../research/agent-harness/notes/permissions-and-sandboxing.md#unresolved-gaps
[n-if-1]: ../research/agent-harness/notes/interfaces-and-extensions.md#1-four-interface-shapes-recur-and-each-serves-a-different-client
[n-if-5]: ../research/agent-harness/notes/interfaces-and-extensions.md#5-extension-models-split-into-in-process-plugins-and-out-of-process-servers-and-the-trust-boundary-differs
[n-if-6]: ../research/agent-harness/notes/interfaces-and-extensions.md#6-skills-are-procedural-memory-that-the-model-loads-lazily-from-files
[n-if-7]: ../research/agent-harness/notes/interfaces-and-extensions.md#7-mcp-client-design-namespace-tools-defer-them-and-support-both-protocol-eras
[n-if-8]: ../research/agent-harness/notes/interfaces-and-extensions.md#8-mcp-as-a-server-is-the-weakest-supported-direction
[n-if-9]: ../research/agent-harness/notes/interfaces-and-extensions.md#9-host-provided-tools-follow-three-patterns
[n-if-impl]: ../research/agent-harness/notes/interfaces-and-extensions.md#design-implications-for-our-harness
[n-obs-5]: ../research/agent-harness/notes/observability-and-evals.md#5-the-metrics-that-matter-are-outcome-reliability-cost-latency-and-friction
[n-obs-6]: ../research/agent-harness/notes/observability-and-evals.md#6-cost-accounting-needs-four-token-classes-a-fixed-input-convention-and-a-cost-provenance-flag
[n-obs-7]: ../research/agent-harness/notes/observability-and-evals.md#7-eval-design-tasks-from-real-failures-outcome-graders-clean-trials-held-fixed-comparisons
[n-obs-impl]: ../research/agent-harness/notes/observability-and-evals.md#design-implications-for-our-harness
[hn]: ../research/practitioners/practitioner-research.md
[hn1]: ../research/practitioners/practitioner-research.md#1-eleven-views-have-wide-support-led-by-quota-opacity-sandboxed-autonomy-and-plan-files
[hn21]: ../research/practitioners/practitioner-research.md#21-seven-practices-divide-practitioners
[hn22]: ../research/practitioners/practitioner-research.md#22-hn-confirms-ten-vendor-or-paper-claims-qualifies-three-and-contradicts-two-vendor-defaults
[hn41]: ../research/practitioners/practitioner-research.md#41-sdk-g1b
[hn42]: ../research/practitioners/practitioner-research.md#42-harness-g2b
[hn43]: ../research/practitioners/practitioner-research.md#43-agent-g3b
[hnn-transcripts]: ../research/practitioners/notes/docs-and-dx.md#debugging-runs-means-reading-local-transcripts-and-otel-data-not-using-llm-ops-products
[hnn-cache]: ../research/practitioners/notes/reliability-evals-cost.md#prompt-caching-became-user-visible-in-2026-and-users-want-cache-state-shown-and-protected
[hnn-compact]: ../research/practitioners/notes/reliability-evals-cost.md#compaction-was-distrusted-until-mid-2026-and-users-want-to-steer-and-inspect-it
[hnn-window]: ../research/practitioners/notes/reliability-evals-cost.md#large-context-windows-degrade-long-before-they-fill-so-experienced-users-cap-them
[hnn-overhead]: ../research/practitioners/notes/reliability-evals-cost.md#harness-overhead-is-now-a-measured-cost-and-small-system-prompts-win-converts
[hnn-evalattack]: ../research/practitioners/notes/reliability-evals-cost.md#in-2026-agents-were-shown-to-attack-the-evaluator-so-graders-now-need-a-sandbox-of-their-own
[hnn-mcp]: ../research/practitioners/notes/security-and-build-vs-buy.md#mcp-went-from-insecure-by-design-in-2025-to-the-credential-boundary-for-a-growing-minority-in-2026
[hnn-supply]: ../research/practitioners/notes/security-and-build-vs-buy.md#malicious-skills-plugins-and-mcp-servers-are-seen-as-ordinary-supply-chain-risk-made-worse-by-missing-pinning
[hnn-escape]: ../research/practitioners/notes/security-and-build-vs-buy.md#agents-that-switch-off-or-route-around-their-own-sandbox-are-the-trust-breaker-of-2026
[hnn-prompts]: ../research/practitioners/notes/security-and-build-vs-buy.md#permission-prompts-fail-through-fatigue-and-auto-mode-is-adopted-without-being-trusted
[hnn-secrets]: ../research/practitioners/notes/security-and-build-vs-buy.md#secrets-should-live-where-the-harness-can-use-them-and-the-agent-cannot-read-them
[ha]: ../research/harness-architectures.md
[ha-codex]: ../research/harness-architectures.md#codex-cli-the-sandbox-first-harness
[ha-oai]: ../research/harness-architectures.md#openai-agents-sdk-sandbox-agents-harness-as-library
[main]: ../research/agent-sdks-and-harness-design.md
[main-swing]: ../research/agent-sdks-and-harness-design.md#harness-choice-can-swing-scores-widely-or-mostly-change-cost
[main-oss]: ../research/agent-sdks-and-harness-design.md#open-source-harnesses-converged-on-one-template-worth-copying
[main-arch]: ../research/agent-sdks-and-harness-design.md#a-reference-architecture-in-eight-swappable-layers
[main-tools]: ../research/agent-sdks-and-harness-design.md#tools-and-context-deserve-more-effort-than-the-prompt
[main-plan]: ../research/agent-sdks-and-harness-design.md#planning-should-start-as-react-and-earn-every-extra-agent
[main-sandbox]: ../research/agent-sdks-and-harness-design.md#sandboxing-needs-two-boundaries-and-no-secrets-inside
[main-evals]: ../research/agent-sdks-and-harness-design.md#observability-and-evals-close-the-loop
[main-bvb]: ../research/agent-sdks-and-harness-design.md#build-vs-buy-depends-on-three-questions
[fc]: ../research/fact-check-2026-11-18.md
[fc-c]: ../research/fact-check-2026-11-18.md#corrections-from-the-verified-sdk-references-round-c-2026-11-18
[fc-review]: ../research/fact-check-2026-11-18.md#reference-architecture-review
[fc-r1]: ../research/fact-check-2026-11-18.md#re-verification-against-primary-sources-r1
[dc-harness]: ../comparison/deep-comparison.md#the-harness-layer-a-tree-log-an-explicit-gate-pipeline-and-resumable-approvals
[dc-safety]: ../comparison/deep-comparison.md#safety-defaults-range-from-six-permission-steps-to-none
[dc-reach]: ../comparison/deep-comparison.md#six-of-eight-sdks-have-a-default-that-reaches-outside-your-process
[ft-safety]: ../comparison/feature-table.md#safety-from-six-permission-steps-to-none
