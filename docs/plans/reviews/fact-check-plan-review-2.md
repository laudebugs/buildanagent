# Fact-check: plan review 2 and the edits it applied

This log checks every factual claim in [plan-review-2.md](plan-review-2.md), the new external claims that commit `3ad33f6` adds to the plans and todos, and the review's build order against the todo files, on 2026-11-19. Repo claims were read on branch `docs/plan-review-2` at `3ad33f6`, and pre-review claims at `9c374f7` (the review's base, `4feea36`, holds the same 195 todos). External claims were checked on 2026-11-19 against the primary source: platform.claude.com docs, developers.cloudflare.com, modelcontextprotocol.io, the npm registry (`npm view`), GitHub's advisory database (`gh api /advisories`), the sandbox-runtime repository and the nodejs/Release `schedule.json`. Each correction was made in place and has its own ✏️ row. The owner's answers were given in this session's question dialog and are confirmed from it (row 15). The research reviewer's working table is not in the repo, so the claims that rest on its classifications are ⚠️ (rows 7 and 32).

## Counts and the todo graph

| # | Claim | Where | Verdict | Source and reason |
|---|---|---|---|---|
| 1 | 195 todos at the review's base, every dependency resolves, nothing cycles | Intro | ✅ | A script over every `Depends on` field at `4feea36` and `9c374f7`: 195 todos, no missing ID, no cycle. At `3ad33f6`: 197 (S10, renamed N50 in the first code-review round, and W12 added), still none missing and no cycle |
| 2 | "the `done/` folder matches the three merged todos" | Intro | ✏️ | `done/` holds 58 todos, most from earlier phases; the three merged build todos are B1–B3. **Now:** "the three merged build todos (B1–B3) sit in `done/`" |
| 3 | The Round E hold blocked 13 of 19 ready SDK todos and 40 of 53 ready harness todos | Intro; §3 G1 | ✅ | Transitive closure over `Depends on` at `9c374f7`: 19 ready B todos, 13 reach an E todo, the free six are B4–B9; 53 ready N todos, 40 reach an E todo, 13 free (N1–N5, N15–N17, N19, N20, N33, N41, N43) |
| 4 | Five SDK and harness todos depend directly on E todos: B10 on E1, B15 on E3, N7 and N40 on E2, N45 on E7 | §3 G1 | ✅ | Same script at `9c374f7` (F5 on E7 is the sixth, outside B and N). At `3ad33f6`, B14 (E1) and W6 (E2) are added, as G6 and D3 say |
| 5 | Totals: 3 blockers, 11 majors, 15 minors, 29 findings; G 1/7/7, V 1/4/8, R 1 | §1 table | ✅ | Arithmetic and the severity columns of §4.1 and §4.2: G2–G8 major, G9–G15 minor; V2, V5, V6, V7 major; V3, V4, V8–V13 minor |
| 6 | 54 research rows: 17 adopted, 8 partly, 27 not, 1 declined, 1 in conflict by choice | §1 | ✅ | Recounted by script from the research reviewer's table in the session's scratchpad (not committed): 16 ADOPTED plus 1 "ADOPTED since U13" = 17; 7 PARTLY plus 1 "PARTLY / CONFLICTS" = 8; 25 NOT ADOPTED plus 2 "NOT ADOPTED and CONFLICTS" = 27; 1 DECLINED; 1 CONFLICTS (owner-resolved). The table itself stays outside the repo |
| 7 | U11 and U12 are almost fully adopted; Round E closed U13's gaps | §1 | ⚠️ | Same reason as row 6 |
| 8 | Every finding was checked against the line it cites | §1 | ⚠️ | A process claim; the rows below re-check the findings that cite a file |
| 9 | "no plan, todo or ADR cites either one" (U14, U15) | §1 | ✏️ | At `9c374f7` only [build-guides.md](../build-guides.md) lines 129–160, the research plan that commissioned them, cites U14 and U15; no build plan, ready todo or ADR does. After this commit N25, N45, F6 and F15 cite them. **Now:** "at the review's base no build plan, todo or ADR cited either one; only the research plan that commissioned them, build-guides.md, did" |
| 10 | R32: N25 re-registers MCP tools silently; R30: N11 reuses approvals by default for every tool | §1 | ✅ | N25 at `9c374f7`, line 28: "`tools/list_changed` notifications re-registering tools at the next turn boundary"; N11 line 34: "`RegisteredTool.approvalReuse`, default `"both"`" |
| 11 | P4 fixed 39 findings across Rounds A, B and N | Intro | ✅ | [plan-review.md](plan-review.md), totals row: 39 |
| 12 | ADRs 0032–0036 come from the coding agent plan, 0037–0042 from the platform plan, 0043 from Round E; ADRs run to 0044 | Intro; Scope | ✅ | `docs/decisions/`: 0032 personal coding agent … 0036 loop outside sandbox; 0037 multi-user platform … 0042 generated-code isolation; 0043 standalone safety core; 0044 rename. The review reviewed ADRs 0001–0044 and itself added 0045 (the HD8 decision) in the medium code-review round, which the scope line now says |
| 13 | Base `4feea36` has B1–B3 merged; the rename came in pull request #27 | Header | ✅ | `git log`: `4feea36` is B3 (#25); `gh pr view 27`: "rename the npm scope to @buildanagent", merged |
| 14 | `pnpm audit` reports no vulnerable dependency | §1 | ✅ | `pnpm audit` on the branch, 2026-11-19: "No known vulnerabilities found" |

## Owner decisions

| # | Claim | Where | Verdict | Source and reason |
|---|---|---|---|---|
| 15 | The owner's four answers: "Lift hold on all of E", "Research it first", "E2 owns it; W6 uses it", "20 now, plus coding tasks" | §2 | ✅ | The owner chose these four options in this session's question dialog on 2026-11-19; the labels are quoted as chosen. The dialog is not in the repo, so the commit message and the dated amendments are the record |
| 16 | The roadmap said the owner lifted the hold "for the SDK and harness only" | §3 G1 | ✅ | Roadmap status at `9c374f7`: "lifted that hold for the SDK and harness only ("SDK and harness only")" |
| 17 | SG2 said "no todo in this plan or its amendments starts until the owner says go" | §3 G1 | ✅ | close-sdk-gaps.md SG2 at `9c374f7`: "No todo in this plan or its amendments starts until the owner says go." |
| 18 | SG2's amendments include B4 and B5 | §3 G1 | ✅ | B4 carries "Revision (2026-11-18, SDK gaps)" (gap 7); close-sdk-gaps.md §3 revises B5 |
| 19 | Every W and F todo now carries a hold banner; the board README says a banner overrides **Depends on** | §4.1 G2 | ✅ | 12 of 12 W and 18 of 18 F todos open with "On hold (owner, 2026-11-19)"; A todos carry "Deferred"; todos/README.md line 11 |
| 20 | The platform plan and the roadmap say "once the owner says go" | §4.1 G2 | ✅ | build-agent-platform.md line 221; roadmap.md lines 36 and 46 |
| 21 | N46b's HTTPS needs TLS interception, which ADR 0020 and HD15 rule out | §2 D2 | ✅ | ADR 0020: "with no TLS interception (HD15)"; HD15 row: "no TLS interception" |

## Findings and fixes (repo)

| # | Claim | Where | Verdict | Source and reason |
|---|---|---|---|---|
| 22 | HD3's layer 2 masks, layer 3 summarizes, layer 4 compacts; HD3 is provisional | §3 V1 | ✅ | build-harness.md HD3 "Choice" and the HD3 row ("Decided, provisional (N39)") |
| 23 | N8, N9, N10, N25, B6 and B8 carry the matching tasks and tests | §3 V1 | ✅ | Each todo has a plan-review-2 task and acceptance line for the append-only rule, the tool announcement or the 400 |
| 24 | "N39's ablation records the extra cost of the dropped blocks" | build-harness.md HD3 revision | ✏️ | N39 lists no such arm or task. **Now:** "N39's ablation is where the extra cost of the dropped blocks gets measured, though N39 does not list that arm yet" |
| 25 | G3–G8, G10, G13–G15 fixes are in the files | §4.1 | ✅ | SDK plan D5/D9 revisions, §3.1 tree and §3.3 `effect`/`outcome`; harness "53 todos", "eight stages", `rotate?()`/`prune?()`, eight seams; E3 has `question?`, `reason?`, `ephemeralSigner()`; E1 has `canonicalInputHash()`, the `./ai` and `./agents` subpaths and the boundary test; B14 depends on E1; CA3 `EffectStore` row; PF5 says "(accepted)" and lists five outcomes; harness `tenant` default `"local"`; E4b scopes out long waits until N41; roadmap shows N branching from B1 and B2; A todos say M7b |
| 26 | ADR 0043 says the safety package "depends only on the gateway" | §4.1 G7 | ✅ | ADR 0043 line 13: "It depends only on `@agent-speak/gateway`" (the accepted ADR keeps the old scope name) |
| 27 | B5, B14, B15 and F5 fold their revisions in, with a one-line history note | §4.1 G9 | ✅ | Each file has a "## History" section and no "## Revision" section |
| 28 | The plans' tables lacked six links: B10 (E1), B15 (E3), N7 (E2), N40 (E2), N45 (E7) in two plans; all six now match | §4.1 | ✅ | A script comparing every plan table row with its todo's **Depends on**: at `9c374f7` exactly these six differ (N45 in build-harness.md and build-coding-agent.md); at `3ad33f6` all 151 rows match on dependencies and size |
| 29 | §4.3 owners: N22's lock file, N45's SSRF and metadata cases on every backend, N20's scrubbing extended | §4.3 | ✅ | N22 line 34; N45 egress cases and N46b/N47b/N48b; N20 line 30 |
| 30 | The decision on connector tokens blocks "F19" | §6 item 6 | ✏️ | No F19 todo exists; F19 is a proposed new todo in U14's change table ([agent connectors report](../../research/connectors/agent-connectors.md), change 9). **Now:** "The proposed F19 (U14's change 9) and the platform's connectors (M8)" |
| 31 | The next free ADR number is 0045 | §6 item 6; N50 | ✏️ | `docs/decisions/` ended at 0044, but the medium code-review round used 0045 for the HD8 decision. **Now:** "0046 or later" in §6 item 6 and "0046" in N50 |
| 32 | R17, R18, R30, R31, R35, R40, R42, R45, R50 map to the §6 decisions | §6 | ⚠️ | Research reviewer's table not in the repo (row 6) |
| 33 | U14 plan-change items 4, 7, 9, 10 and 11 and U15 item 3 say what N25, D3, §6, F6, F15 and N45 attribute to them | §2 D3; N25; F6; F15; N45 | ✅ | agent-connectors.md change table rows 4, 7, 9, 10, 11; browser-use.md row 3 |

## External claims in the review

| # | Claim | Where | Verdict | Source and reason |
|---|---|---|---|---|
| 34 | Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable and Mythos 5.1–5.2 run the prefix check | §3 V1; HD3 | ✅ | [Prefix checks](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks), `supportedModels` and the outcomes table |
| 35 | Quote: a prefix check fails "if `system`, `tools`, or an earlier message changed after Claude produced a block" | §3 V1 | ✅ | Same page, first paragraph, verbatim |
| 36 | On Fable 5.2 and Mythos 5.x a failed check is a 400; on the others a possible 400 | §3 V1 | ✅ | Outcomes table: Fable 5.2, Mythos 5.2 and Mythos 5.1 "400 error"; Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 "Possible 400 error" |
| 37 | Fixes: keep thinking append-only, drop only a leading or trailing run, build `system` and `tools` once, announce tool changes in a `role: "system"` message, retry with `prefix_mismatch_behavior: "drop_block"` | §3 V1; HD3 | ✅ | Same page: "the three habits"; "leave out the oldest, the newest, or all of them … but not one in between"; tool changes "in a system message"; the error text "is bound to a different conversation"; beta header `thinking-binding-controls-2026-08-01` adds `thinking.block_binding.prefix_mismatch_behavior`. Note: the page says to send `"drop_block"` "on that conversation's later requests", because it acts only on the request that carries it; the one-retry design should keep that in mind |
| 38 | On `2026-10-21`, `temperature`, `top_p` or `top_k` returns 400 "even at the parameter's default value" | §4.2 V2; B8 | ✅ | [Migration to 2026-10-21](https://platform.claude.com/docs/en/api/migration-2026-10-21), "Sampling parameters": verbatim |
| 39 | Thinking counts inside `output_tokens`; `output_tokens_details.thinking_tokens` arrives only on the final `message_delta` | §4.2 V3; D3; B8 | ✅ | [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking): the field "reports how many of the billed output tokens were internal reasoning. When streaming, this breakdown appears only on the final `message_delta` event" |
| 40 | Anthropic advises against stripping thinking blocks on a model switch | §4.2 V4; B6 | ✅ | [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking): "Don't strip thinking blocks when you switch. The API drops unreadable ones without billing them" |
| 41 | `@cloudflare/sandbox` 1.0.3 became npm's `latest` on 22 October 2026 | §3 V5 | ✅ | `npm view`: `latest` 1.0.3, published 2026-10-22; 1.0.0 shipped 2026-09-30 |
| 42 | The 1.0 line drops `enableInternet`/`allowedHosts`/`outboundByHost` options for `interceptOutboundHttp()` and `interceptOutboundHttps()` on the Durable Object Container API, citing "Cloudflare, migrate to the Container API" | §3 V5 | ✏️ | The claim holds: the 1.0.3 tarball's types contain no `outboundByHost`, `allowedHosts` or `interceptHttps` (0.12.14 has them), and [Migrate from Sandbox SDK 0.x: outbound rules](https://developers.cloudflare.com/sandbox/sdk/migrate/outbound-traffic/) maps them to the intercepts. The cited page covers the deprecated `@cloudflare/containers` `Container` class, not the Sandbox SDK. **Now:** the link and label point to the Sandbox SDK's outbound migration page |
| 43 | U15's fact-check rows 112, 114, 117: HTTPS under `enableInternet = false` needs interception, so installs and git fail | §3 V5 | ✅ | [fact-check-browser-use.md](../../research/browser-use/fact-check-browser-use.md) rows 112 and 117 ("registries included"; "covers 1.0 as well"); git and credential injection follow, since both are HTTPS |
| 44 | pnpm 10.28.0 is affected by "about 25 advisories", fixed in 10.34.5 | §1; §4.2 V6 | ✏️ | `gh api '/advisories?ecosystem=npm&affects=pnpm@10.28.0'`: 23 advisories, the latest fix 10.34.5; 10.34.5 and 10.34.9 are affected by none. **Now:** "23 advisories" in §1, and "23 GitHub advisories, all fixed in 10.34.5 (as of November 2026)" in V6 |
| 45 | The newest 10.x exists to bump to | §4.2 V6 | ✅ | `npm view pnpm dist-tags`: `latest-10` 10.34.9, published 2026-10-25 |
| 46 | npm marks `@opentelemetry/sdk-trace-base` deprecated; the exporter 0.223.2 depends on `@opentelemetry/sdk-trace` 2.12.1 | §4.2 V7 | ✅ | `npm view …sdk-trace-base@latest` (2.12.0): "Use @opentelemetry/sdk-trace package"; `npm view @opentelemetry/exporter-trace-otlp-http@0.223.2 dependencies`: `sdk-trace` 2.12.1. See row 58 for the one undeprecated release |
| 47 | The OTLP exporter 0.223.2 turns one week old on 2026-11-19 | §4.2 V8 | ✅ | Published 2026-11-12T16:56Z |
| 48 | `srt` moved to `anthropics/sandbox-runtime` and is still a "Beta Research Preview" | §4.2 V9 | ✅ | `gh api repos/anthropic-experimental/sandbox-runtime` resolves to `anthropics/sandbox-runtime`; README line 7: "Beta Research Preview"; npm `repository.url` points to the new repo |
| 49 | MCP 2026-07-28 "deprecates HTTP+SSE" | §4.2 V10 | ✏️ | [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), "Deprecated" item 2: "Reclassify the HTTP+SSE transport (deprecated since protocol version `2025-03-26`) as Deprecated under the feature lifecycle policy". **Now:** "formally classes HTTP+SSE, deprecated since 2025-03-26, as Deprecated" |
| 50 | MCP 2026-07-28 sends list changes on `subscriptions/listen` | §4.2 V10; HD14; N25 | ✅ | Same changelog, item 4: `subscriptions/listen` replaces the GET endpoint, with opt-in `toolsListChanged`; item 9: a broken stream's request "MUST" be re-issued |
| 51 | Node 22 reaches end of life on 2027-04-30; Node 24 is in maintenance and Node 26 is Active LTS | §4.2 V11; SDK plan risks | ✅ | [schedule.json](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json): v22 end 2027-04-30; v24 maintenance from 2026-10-20; v26 LTS from 2026-10-28 |
| 52 | `ai` moved by patch releases to 7.0.177 | §4.2 V12 | ✅ | `npm view ai dist-tags.latest`: 7.0.177 (2026-11-18); the lockfile has 7.0.162 |
| 53 | A `pnpm-workspace.yaml` comment names just-bash 3.6.1; the lockfile has 3.6.0 | §4.2 V13 | ✅ | pnpm-workspace.yaml line 23; pnpm-lock.yaml `just-bash@3.6.0` |
| 54 | `@modelcontextprotocol/client` 2.4.0, TypeScript 7.0.2, zod, `@cfworker/json-schema`, e2b and `@vercel/sandbox` "are all current and match the lockfile" | §4.2 | ✏️ | The first four are current and locked (2.4.0, 7.0.2, 4.6.7, 4.1.6). `e2b` and `@vercel/sandbox` appear in the lockfile only as optional peers of `@openai/agents-extensions`; npm's latest are 2.64.0 (2026-11-13) and 4.0.0 (2026-11-12). **Now:** "`e2b` and `@vercel/sandbox` are not in the lockfile yet; N47b's and N48b's pins, 2.63.0 and 3.9.1, still hold under the one-week rule" |

## External claims added to other files

| # | Claim | Where | Verdict | Source and reason |
|---|---|---|---|---|
| 55 | B8 pins `anthropic-version: 2026-10-21` | B8; SDK plan | ✅ | The migration guide and the prefix-check page's examples send `anthropic-version: 2026-10-21` |
| 56 | On `2026-10-21`, a `document` block in an assistant message and `citations` on a user text block each return 400 | B8 | ✅ | Migration guide, "Document blocks in assistant messages return an error" and "Citations in user messages return an error" |
| 57 | Computer-use toolsets such as `computer_toolset_20260801` | B8 | ✅ | [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) names `computer_toolset_20260801` |
| 58 | "npm marks every `sdk-trace-base` release deprecated" | build-sdk.md Dependencies; B17 | ✏️ | The registry document marks 82 of 83 releases deprecated; 2.12.1 (tag `latest-2`, 2026-11-09) is not, and it depends on `@opentelemetry/sdk-trace` 2.12.1. The `latest` tag, 2.12.0, is deprecated. **Now:** "every … release except 2.12.1" with the wrapper note, in both files. The pin on `sdk-trace` 2.12.1 stands |
| 59 | `@opentelemetry/sdk-trace` 2.12.1 is in the lockfile and is the line the exporter pulls | build-sdk.md; build-harness.md; B17; N31 | ✅ | pnpm-lock.yaml `@opentelemetry/sdk-trace@2.12.1`; `npm view …sdk-trace dist-tags`: `latest-2` 2.12.1 (`latest` is 3.1.1) |
| 60 | `@modelcontextprotocol/server` 2.4.0, `@earendil-works/pi-schema` 1.5.2 and `@standard-schema/spec` 1.1.0 are pinned and locked | build-harness.md; build-sdk.md Dependencies | ✅ | `npm view`: server 2.4.0 is latest; all three are in pnpm-lock.yaml |
| 61 | Pin `@anthropic-ai/sandbox-runtime` 0.0.82, the newest release a week old on 2026-11-18; 0.0.83 qualifies from 2026-11-20; Apache-2.0 | N16 | ✅ | `npm view` times: 0.0.82 2026-11-10, 0.0.83 2026-11-13T02:30Z; license Apache-2.0; bin `srt` |
| 62 | The README says APIs and configuration formats "may change" | N16 | ✅ | README line 9: "APIs and configuration formats may evolve" (N16 paraphrases without quotes) |
| 63 | HTTP+SSE: "the 2026-07-28 revision deprecates HTTP+SSE" | N25 | ✏️ | As row 49. **Now:** "HTTP+SSE has been deprecated since 2025-03-26, and the 2026-07-28 revision formally classes it Deprecated" |
| 64 | HD14 revision: list changes arrive only on an opt-in `subscriptions/listen` stream, and HTTP+SSE is deprecated | build-harness.md | ✅ | As rows 49 and 50 |
| 65 | `@cloudflare/sandbox` 1.0 removed `outboundByHost` and `allowedHosts` | build-harness.md §3; build-coding-agent.md CA3; N46b; N50 | ✅ | As row 42 |
| 66 | Outbound traffic: only intercepted traffic leaves while `enableInternet` is `false`; HTTPS interception uses a CA at `/etc/cloudflare/certs/cloudflare-containers-ca.crt` | N46b; N50 | ✅ | [Handle outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/): "only traffic that an intercept handles can leave the container"; the CA path and the trust step |
| 67 | A container has a 128-intercept-entry limit; `*` can intercept HTTPS to every host | N46b; N50 case (e) | ✅ | Same page: "A container has a limit of 128 intercept entries"; `interceptOutboundHttps("*", handler)` |
| 68 | N46b cites "the Durable Object Container API migration" for the 1.0 API | N46b | ✏️ | As row 42: that page migrates the `@cloudflare/containers` class. **Now:** "[Sandbox SDK 0.x migration, outbound rules](https://developers.cloudflare.com/sandbox/sdk/migrate/outbound-traffic/)" |
| 69 | N50 cites "Migrate to the Durable Object Container API" for what replaced `outbound`, `outboundByHost`, `allowedHosts` and `interceptHttps` in 1.0 | N50 | ✏️ | As row 42; the Sandbox page lists exactly those options ("This page replaces `enableInternet`, `interceptHttps`, `allowedHosts`, … `outboundByHost`"). **Now:** "[Migrate from Sandbox SDK 0.x: outbound rules](https://developers.cloudflare.com/sandbox/sdk/migrate/outbound-traffic/)" |
| 70 | On 0.x, HTTPS fails without interception while internet is off | N50 Goal and Context | ✅ | U15 fact-check row 112, quoting the 0.x page: HTTPS requests "fail while it is `false`" |

## Internal consistency

| # | Claim | Where | Verdict | Source and reason |
|---|---|---|---|---|
| 71 | The §5 wave table, waves 1–15 | §5 | ✅ | Each todo's wave computed as 1 + the latest wave of its **Depends on** (done = 0), over B, N, N50 and E without W, F, A and N38b: every cell matches, including N46b in wave 13 after N45 and N50 |
| 72 | The longest chain to B19 runs E1 → B10 → B11 → B13 → B15 → B15b → B18 → B19 | §5 | ✅ | B10 needs E1, B11 needs B10, B13 and B15 follow, B15b, B18 needs B15b, B19 needs B18: waves 1–8 |
| 73 | N35 follows through N7, N27, N28 and N30 | §5 | ✅ | N35 ← N30 ← N28 ← N27 ← N7 ← B15b |
| 74 | N46b and W4 wait for N50; N46a, N47a/b and N48a/b do not | §3 V5; §5; §6 | ✅ | N46b depends on N45 and N50; W4 on N46a and N46b; the other adapters on N45 only |
| 75 | W6 depends on E2; W8 depends on W12; W12 depends on N38 and W2 | §2 D3, D4 | ✅ | The three todo files |
| 76 | E1 sat on the weighted critical path of every milestone | §3 G1 | ✅ | E1 (M) → B10 (M) is longer than B4 (M) into B11, which every SDK-based milestone needs |
| 77 | "Weighted by size, E1 → B10 is as long as B4" | build-sdk.md §4.3 | ✏️ | E1 and B10 are both M; B4 is one M. **Now:** "E1 → B10 (two M todos) is longer than B4 (one M todo), so E1, not B4, sits on the loop's critical path" |
| 78 | The SDK's longest chain counts eleven todos, B1 … B20 through B4 | build-sdk.md §4.3 | ✅ | By count, B1 → B2 → B3 → B4 → B11 → … → B20 is 11; the E1 route is 10 |
| 79 | B1–B3 are done, and B4, B6, B7 and E1 have every dependency done; N1 has every dependency done | build-sdk.md; build-harness.md | ✅ | Wave 1 of row 71 |
| 80 | 53 harness todos: 41 from P2 and P4 and 12 for portability; eight stages | build-harness.md | ✅ | N1–N40 with N38b is 41; N41–N49 with the three a/b splits is 12; §4.1–§4.8. N50 sits in the §4.8 table as a Round S verification todo, marked as added in plan review 2 |
| 81 | E1–E4b and E6 need only B1; E5 waits for B5 | close-sdk-gaps.md SG2 | ✅ | E1 depends on B1, and E2, E3, E4a, E4b, E6 only on E todos; E5 on E1 and B5 |
| 82 | N1 depends on B1, N2 on N1 and B2 | roadmap.md | ✅ | The two todo files |
| 83 | N38b's suite becomes 40 tasks; W8's baseline runs 30 | N38b; W8; HD8 | ✅ | N38's 20 + W12's 10 = 30; + N38b's 10 = 40 |
| 84 | After a 400, the adapter retries once with `drop_block` | §3 V1; HD3 rule 4; B8 | ✏️ | The prefix-check page: "After a 400 error, send `"drop_block"` on that conversation's later requests to recover", and the setting "acts on the one request that carries it". https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks. **Now:** the adapter retries with `drop_block` and sends it on every later request of that conversation, in plan-review-2.md §3, HD3 rule 4 and B8 (scope and acceptance) |

## Not checked

- The research reviewer's classification of each row (rows 7 and 32): its table is not in the repo.
- Whether `drop_block` behaves as documented (rows 37 and 84): no live request to the Anthropic API was made.
