# Plan review 2: the SDK and harness plans can be built once Round E is unheld, the Anthropic adapter keeps thinking blocks valid and the Cloudflare sandbox's egress is re-verified

- **Status:** Findings recorded and fixes applied (2026-11-19). The owner answered four questions in this review; §6 lists the decisions still open.
- **Date:** 2026-11-19
- **Scope:** the SDK plan ([build-sdk.md][sdk], Round B), the harness plan ([build-harness.md][har], Round N), the plan that closes the SDK gaps ([close-sdk-gaps.md][gaps], Round E), and the parts of the coding agent plan ([build-coding-agent.md][ca], Round W) and the platform plan ([build-agent-platform.md][pf], Round F) that amend them. It also covers the [roadmap][road], the todo board and ADRs 0001–0044, and adds ADR 0045.
- **Base:** `main` at `4feea36` (B1–B3 merged), plus the rename to `@buildanagent/*` in pull request #27.
- **Fact-check:** [fact-check-plan-review-2.md](fact-check-plan-review-2.md)

The first plan review ([P4](plan-review.md)) fixed 39 findings across Rounds A, B and N. Since P4, three plans have amended those rounds: the coding agent plan (ADRs 0032–0036), the platform plan (ADRs 0037–0042) and Round E (ADR 0043). Research reports U11–U15 have also landed. This review asked three questions. Do the amended plans still agree with each other? Do their pins and third-party APIs still hold today? Have the research recommendations reached a plan or a todo? The todo graph is sound: all 195 todos at the review's base resolve their dependencies, nothing cycles, and the three merged build todos (B1–B3) sit in `done/`. Three findings would stop a builder, though. The Round E hold blocked 13 of the 19 ready SDK todos and 40 of the 53 ready harness todos (G1). Anthropic's newest models reject thinking blocks after the harness masks or summarizes earlier messages (V1). The Cloudflare sandbox backend relies on an egress API that Sandbox SDK 1.0 removed, and its HTTPS design fails as written (V5, R43). **Verdict: the owner's four answers and this review's edits clear G1 and V1, and N50 now carries V5; once N50 reports and the owner rules on its result, the SDK, harness and Round E can be built in the order in §5.**

## 1. Three reviews found 3 blockers, 11 majors and 15 minors, and 27 research recommendations that no plan carries

Three reviewers worked independently, each on one question, and every finding below was checked against the line it cites. R43 is the research side of V5, a major: the HTTPS design fails, and the API it uses is gone.

| Review | Blocker | Major | Minor | Total |
| --- | --- | --- | --- | --- |
| Graph, amendments and build order (G1–G15) | 1 | 7 | 7 | 15 |
| Pins, APIs and advisories (V1–V13) | 1 | 4 | 8 | 13 |
| Research adoption (R1–R53, 54 rows) | 1 (R43) | — | — | 1 |
| **All** | **3** | **11** | **15** | **29** |

The research review classified each recommendation rather than grading it. Of the 54 recommendations that touch the SDK or harness, 17 are adopted, 8 partly and 27 not at all. The owner declined one, and one conflicts with the plans by the owner's choice. U11 and U12 are almost fully adopted, and Round E closed U13's gaps. U14 (connectors) and U15 (browser use) landed after Round E, and at the review's base no build plan, todo or ADR cited either one; only the research plan that commissioned them, [build-guides.md](../build-guides.md), did. Three of the unadopted recommendations contradict a current todo: R43 (the sandbox's HTTPS), R32 (N25 re-registers MCP tools silently) and R30 (N11 reuses approvals by default for every tool).

`pnpm audit` reports no vulnerable dependency. It cannot see pnpm itself, though, and pnpm 10.28.0 is affected by 23 advisories (V6).

## 2. The owner settled four questions on 2026-11-19

| ID | Question | Owner's answer | What changed |
| --- | --- | --- | --- |
| D1 | Round E is on hold, yet B10, B15, N7, N40 and N45 depend on it (G1) | "Lift hold on all of E" | [SG2][gaps], the [roadmap][road] and every E todo now say Round E is being built with the SDK and harness. Rounds W, F and A keep their hold, which their todos now carry as a banner (G2). |
| D2 | N46b's HTTPS needs TLS interception, which ADR 0020 and HD15 rule out (R43) | "Research it first" | A new verification todo, N50, tests Sandbox SDK 1.0's egress on a real sandbox. N46b depends on N50 and waits for the owner's ruling on its result. ADR 0020 and HD15 are unchanged. |
| D3 | W6 plans its own idempotency keys beside E2 (G12, O1) | "E2 owns it; W6 uses it" | W6 depends on E2 and runs its pushes and pull requests through `guardedWrite()`. U14's change 7 is closed because Round E covers it. |
| D4 | HD8's 30-task suite lost its 10 triage tasks when triage was deferred | "20 now, plus coding tasks" | HD8 carries a dated amendment, recorded in [ADR 0045](../../decisions/0045-hd8-coding-agent-eval-tasks.md). N38 ships 20 tasks, and a new todo, W12, adds 10 coding-agent tasks before W8 publishes its baseline. N38b adds the triage tasks when Round A resumes. |

## 3. The blockers: a hold that stopped the build, a check that breaks the context layers and an egress API that no longer exists

**G1: the Round E hold stopped most of Rounds B and N.** On 2026-11-19 the owner lifted the build hold "for the SDK and harness only", and the [roadmap][road] recorded that. SG2 still said "no todo in this plan or its amendments starts until the owner says go". Its amendments include B4 and B5, the next two SDK todos. Five SDK and harness todos also depend directly on held E todos: B10 on E1, B15 on E3, N7 and N40 on E2, and N45 on E7. Under the board's rule, a builder could take B4–B9 and 13 harness todos, then had to stop. E1 also sat on the weighted critical path of every milestone. D1 removes the hold, so Round E now runs in waves 1–5, beside B4–B9.

**V1: Anthropic's prefix check rejects thinking blocks once the harness edits an earlier message.** Claude Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable and Mythos 5.1–5.2 check each returned thinking block against everything before it. A prefix check fails "if `system`, `tools`, or an earlier message changed after Claude produced a block". On Fable 5.2 and Mythos 5.x a failed check is a 400 error; on the others it is a possible 400 ([Anthropic, prefix checks][prefix]). HD3's layer 2 masks older tool results, layer 3 summarizes and layer 4 compacts, and each layer edits an earlier message. N25 also adds tools mid-session. HD3 is provisional, so this review amended it in place. The request view keeps signed thinking blocks append-only. After an edit, the view drops every thinking block that follows the edit point. The harness builds `system` and `tools` once per session, and it announces a tool change in a `role: "system"` message. On a "bound to a different conversation" error, the adapter retries with `prefix_mismatch_behavior: "drop_block"` and keeps sending it for the rest of that conversation, because the setting acts only on the request that carries it. N8, N9, N10, N25, B6 and B8 carry the matching tasks and tests.

**V5 and R43: the Cloudflare sandbox backend cannot be built as written.** N46b compiles the `EgressPolicy` to `enableInternet = false`, `allowedHosts` and an `outboundByHost` handler. On 22 October 2026, `@cloudflare/sandbox` 1.0.3 became npm's `latest`, and the 1.0 line drops those options for `ctx.container.interceptOutboundHttp()` and `interceptOutboundHttps()` on the Durable Object Container API ([Cloudflare, migrate outbound rules from Sandbox SDK 0.x][cf-migrate]). U15's fact-check also found that HTTPS under `enableInternet = false` needs interception on both API versions. Without it, every HTTPS request fails, including package installs, git and credential injection ([U15 fact-check, rows 112, 114, 117][u15fc]). ADR 0020 and HD15 rule out TLS interception, so the owner chose to verify first (D2). N50 runs that test, and N46b and W4 wait for it.

## 4. The majors and minors: fixed in place, except four that need the owner

### 4.1 Graph and amendments (G2–G15)

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| G2 | major | W and F todos carried no hold banner, and the platform plan said "F1 and F3 are the first todos to open" | Banner on every W and F todo; the platform plan and the roadmap say "once the owner says go"; the board README says a banner overrides **Depends on** |
| G3 | major | The SDK plan never mentioned ADR 0043: D5, D9, §3.1 and §3.3 still put the signers and `projectCallCost()` in the SDK, and §3.3 lacked `effect` and `outcome` | Dated revisions under D5 and D9; §3.1 adds `@buildanagent/agent-safety`; §3.3 adds both fields and marks the re-exports; the §4.3 table adds E1 and E3 |
| G4 | major | The harness plan said "41 todos" and "seven stages"; its `KeyStore` required `rotate()` and `prune()`, against ADR 0035; it said "seven portable seams" | Counts corrected; `rotate?()` and `prune?()` made optional; eight seams; §6.3 covers stage 8 and the E2 and E7 gates |
| G5 | major | E3's `SignedPendingRequest` dropped `question?` and `reason?`; E3 and B15 both defined the type; E3 lacked `ephemeralSigner()`, which B15 imports | E3 copies §3.3 exactly and builds `ephemeralSigner()`; the safety package owns the pending record and the SDK re-exports it (owner to confirm, §6) |
| G6 | major | E2 and B14 use `canonicalInputHash()` before E3 builds it | The hash moves into E1; B14 depends on E1 |
| G7 | major | ADR 0043 says the safety package "depends only on the gateway", yet E1 puts `ai` adapters in its only entry point | E1's root export is the core; `./ai` and `./agents` subpaths hold the adapters as optional peers; a boundary test enforces the split (owner to confirm, §6) |
| G8 | major | The coding agent plan listed seven seams with no `EffectStore` | CA3 adds an `EffectStore` row; N45's row adds E7 |
| G9 | minor | B5, B14, B15 and F5 contradicted their own appended revisions | Each revision is folded into Scope, Tasks and Acceptance, with a one-line history note |
| G10 | minor | E3 and PF5 still called ADR 0043 "proposed"; PF5 listed four outcomes | "Accepted"; five outcomes; E3 is the signer's source |
| G11 | minor | ADRs 0001, 0005, 0009 and 0033 carry no pointer to ADR 0043 | Not applied: it edits accepted ADRs' status lines, so it waits for the owner (§6) |
| G12 | minor | W6 planned its own idempotency keys | Settled by D3 |
| G13 | minor | E2's effect scope requires a `tenant` that the harness never sets | The harness config supplies it, with a default of `"local"` for single-user hosts |
| G14 | minor | E4b relied on E7 for a wake and plan-state storage that E7 does not build | E4b puts waits longer than one process out of scope until a host provides a wake (N41) |
| G15 | minor | The roadmap drew Rounds B and N in sequence; the plan index listed B1–B20 and N1–N39; A todos said M7 | The roadmap shows N branching from B1 and B2; the index lists every plan and range; A todos say M7b |

The plans' todo tables also lacked six dependency links that the Round E amendments had added to the todo files: B10 (E1), B15 (E3), N7 (E2), N40 (E2) and N45 (E7), the last one in two plans. All six now match.

### 4.2 Pins and third-party APIs (V2–V13)

| ID | Severity | What changed upstream | Fix |
| --- | --- | --- | --- |
| V2 | major | On API version `2026-10-21`, Anthropic returns 400 for any `temperature`, `top_p` or `top_k`, "even at the parameter's default value" ([migration guide][mig]) | B8 pins `anthropic-version: 2026-10-21` and drops the sampling options with a warning; the SDK plan marks `temperature` provider-optional |
| V6 | major | pnpm 10.28.0 is affected by 23 GitHub advisories, all fixed in 10.34.5 (as of November 2026) | Not a plan edit: a separate pull request bumps `packageManager` to the newest 10.x |
| V7 | major | npm marks `@opentelemetry/sdk-trace-base` deprecated, and the planned exporter already depends on `@opentelemetry/sdk-trace` 2.12.1 | B17, N31 and both plans pin `@opentelemetry/sdk-trace` 2.12.1 |
| V3 | minor | Anthropic counts thinking inside `output_tokens` | D3's open question is closed; B8 adds a fixture for the final `message_delta` |
| V4 | minor | Anthropic advises against stripping thinking blocks on a model switch | B6 keeps same-provider thinking blocks and drops only leading or trailing runs |
| V8 | minor | The OTLP exporter 0.223.2 turns one week old on 2026-11-19 | None needed |
| V9 | minor | `srt` moved to `anthropics/sandbox-runtime` and is still a "Beta Research Preview" (as of November 2026) | N16 links the new repository and pins 0.0.82 |
| V10 | minor | MCP 2026-07-28 sends list changes on `subscriptions/listen` and formally classes HTTP+SSE, deprecated since 2025-03-26, as Deprecated | N25 notes both |
| V11 | minor | Node 22 reaches end of life on 2027-04-30 | The SDK plan's risks name the date and a move to Node 24 or 26 |
| V12 | minor | `ai` moved by patch releases to 7.0.177 (as of 2026-11-18) | None needed: E1 re-pins first |
| V13 | minor | A `pnpm-workspace.yaml` comment names just-bash 3.6.1, while the lockfile has 3.6.0 | Fixed with V6 |

`@modelcontextprotocol/client` 2.4.0, TypeScript 7.0.2, zod 4.6.7 and `@cfworker/json-schema` 4.1.6 are the latest releases and match the lockfile (as of 2026-11-19). `e2b` and `@vercel/sandbox` are not in the lockfile yet; N47b's and N48b's pins, 2.63.0 and 3.9.1, still hold under the one-week rule.

### 4.3 Research recommendations: one owner per concept, with the connector and browser work scheduled for later

The research review found the same concept planned in several places, and this review gave each one a single owner.

| Concept | Before | Owner now |
| --- | --- | --- |
| Idempotency keys and write outcomes | E1 and E2, B10, N7, N45, W6 and U14's change 7 | E2 owns the key and the crash rule, and E1 the outcomes (D3) |
| Pinning MCP tool definitions | Nobody; N25 re-registered changed tools silently | N25 diffs each tool list against a pin in N22's lock file format, and starts a changed tool disabled |
| SSRF and metadata addresses | Local proxy only (N20) | N45 runs the cases on every backend |
| Secret scrubbing | N20 | N20, extended to hosted-browser and connector tokens when they exist |

The remaining U14 and U15 changes wait for the rounds that need them. No W todo uses an MCP connector, so U14 matters first for the platform (M8) and for our own SDK serving connectors (M9). The in-sandbox browser is optional for coding agent v1. Five items need an ADR or a harness decision, so §6 lists them for the owner.

## 5. The build order: SDK, harness and Round E in parallel waves, with W and F held

With D1 applied, these waves are the schedule for the work the owner has released. Each wave holds the todos whose dependencies have all finished. The list leaves out the held rounds (W, F, A) and N38b.

| Wave | SDK (B) | Harness (N) and verification (S) | Safety core (E) |
| --- | --- | --- | --- |
| 1 | B4, B6, B7 | N1, N50 | E1 |
| 2 | B5, B10 | N2, N15 | E2, E3, E6 |
| 3 | B8, B9, B11 | N3, N16, N17, N20 | E4a, E5 |
| 4 | B12, B13, B16 | N4, N19, N43 | E4b |
| 5 | B14, B15, B17 | N5, N11, N41 | E7 |
| 6 | B15b | N6, N12, N26, N33 | — |
| 7 | B18 | N7, N8, N22, N24, N32 | — |
| 8 | B19 | N9, N13, N21, N25, N27 | — |
| 9 | B19b, B20 | N10, N14, N18, N23, N28, N31, N42 | — |
| 10–15 | — | N29, N30, N34, N40; then N35 and N44; N36 and N45; N37 with the backend adapters N46a–N48b; N38 and N49; N39 | — |

The longest chain to a usable SDK (B19) runs E1 → B10 → B11 → B13 → B15 → B15b → B18 → B19. The harness capstone, N35, follows that chain through N7, N27, N28 and N30. N46b cannot start until N50 reports and the owner rules on TLS interception. The other backend adapters (N46a, N47a and b, N48a and b) do not wait for it.

## 6. Eleven owner actions are still open, and only one, a test project for N50, touches waves 1–5

| # | Decision | Source | Blocks |
| --- | --- | --- | --- |
| 1 | Accept or reject N50's proposed ADR on TLS interception for the Cloudflare backend | D2, R43 | N46b, then W4 |
| 2 | Confirm that the safety package owns `SignedPendingRequest` and `Resolution`, with the SDK re-exporting them | G5 | E3 and B15 (both can proceed on this reading) |
| 3 | Confirm that ADR 0043's "depends only on the gateway" means the package's root export | G7 | E1 (can proceed on this reading) |
| 4 | Add status pointers to ADR 0043 on ADRs 0001, 0005, 0009 and 0033 | G11 | Nothing |
| 5 | A harness decision, HD16, on defaults for untrusted-source tools: tiers, `approvalReuse`, taint and URL checks. N11 still reuses approvals by default for every tool | R30, R45, R50 | N11's defaults for MCP and browser tools |
| 6 | An ADR (0045 or later) on who holds runtime connector tokens, and a vault decision beside HD15 | R31, R35 | The proposed F19 (U14's change 9) and the platform's connectors (M8) |
| 7 | An amendment to ADR 0005 for an approval deadline and default action | R17 | Platform v1 |
| 8 | An ADR for a logged-out browser inside the coding agent's sandbox | R42 | U15's browser verification todo |
| 9 | Whether "export as an MCP server" becomes a platform package | R18, R40 | Nothing yet |
| 10 | Bump pnpm in its own pull request | V6 | Nothing; security hygiene |
| 11 | Provide a disposable Cloudflare project for N50's live run | D2 | N50 (wave 1) |

With waves 1–5 released and every finding resolved or owned, the next step is to build B4, B6, B7, N1 and E1 in parallel, with N50 as soon as the owner provides its test project, then follow the waves in §5.

[sdk]: ../build-sdk.md
[har]: ../build-harness.md
[gaps]: ../close-sdk-gaps.md
[ca]: ../build-coding-agent.md
[pf]: ../build-agent-platform.md
[road]: ../roadmap.md
[u15fc]: ../../research/browser-use/fact-check-browser-use.md
[prefix]: https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks
[mig]: https://platform.claude.com/docs/en/api/migration-2026-10-21
[cf-migrate]: https://developers.cloudflare.com/sandbox/sdk/migrate/outbound-traffic/
