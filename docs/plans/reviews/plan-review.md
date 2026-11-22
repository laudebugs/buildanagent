# Plan review (P4): the three plans fit together once three interface gaps close, and 24 of the 28 cross-plan needs belong upstream

- **Status:** Findings recorded and fixes applied (2026-11-18); §7 records the resolution of every finding. No finding needs the owner.
- **Date:** 2026-11-18
- **Todo:** [P4](../../todos/done/P4-plan-review.md), against the checklist in [implementation plans §3][ip3]
- **Plans reviewed:** [build-sdk.md][sdk] (Round B, B1–B20), [build-harness.md][har] (Round N, N1–N39) and [build-agent.md][agt] (Round A, A1–A24), with [ADRs 0001–0031](../../decisions/README.md) and the three [guides](../../guides/)
- **Scope:** §1–§6 record the findings as found. The fixes changed the three plans, their todos and the ADRs, and §7 lists them.

The three plans pass most of the P4 checklist. Their todo graph is clean: 83 todos with unique IDs, every dependency resolves, nothing cycles, and every plan table matches its todo files. Every todo also carries checkable acceptance criteria, and every new pin already sits in the lockfile. The plans also mostly use each other's names as written: `GateDecision`, `hmacSigner({ keys, current })`, `Usage`, `Cost` with a nullable total, `SignedPendingRequest` and `continueRun` all match across the three plans. Three gaps would stop a builder, though. The gateway's `Context` names a type from the SDK package that depends on it (R1). The protocol package imports types from the harness package that depends on it (R2). And no harness todo builds the code-initiated tool call that every agent side effect runs through (R3). Ten major findings sit behind those three. The SDK lacks a hook stop reason and an error kind. The session log stores no system prompt and labels no input origin. Approval reuse can bypass the agent's always-ask rule, the resume path takes no budget, and the quorum hook has no type. The harness's 10 shared triage tasks have no scheduled source. Finally, stale "owner to confirm" text surrounds decisions the owner has accepted, and the accepted data-policy wording contradicts AD8's body. **Verdict: the SDK and harness plans are ready to build once R1, R2 and their majors are fixed, and the agent plan is ready once R3 lands upstream; 24 of the 28 needs the lower plans received should be absorbed upstream, three dropped and one is already covered.**

## 1. Each plan's verdict depends on a few upstream fixes, not on redesign

| Plan | Verdict | Blockers it owns | Majors it owns | Minors it touches | Must change before its round starts |
| --- | --- | --- | --- | --- | --- |
| SDK (Round B) | Ready after fixes | R1 | R4, R5, R28 | 16 | Move `Context` out of the gateway; add a hook stop reason and `RunError`; absorb 12 of the harness's 13 needs and both of the agent's SDK needs (§4) |
| Harness (Round N) | Ready after fixes | R2, R3 | R6–R10, R22, R28 | 10 | Fix the protocol package's types; add `invokeTool` as a new todo; store the system prompt and input origin; gate approval reuse; split N38 |
| Agent (Round A) | Ready after upstream fixes | R3 (upstream) | R29, R28 | 13 | Settle the AD8 data wording; depend on the new code-call todo; rename the need labels |

The counts by check and severity are:

| Check | Blocker | Major | Minor | Total |
| --- | --- | --- | --- | --- |
| Consistency (§2.1) | 3 | 7 | 6 | 16 |
| Coverage (§2.2) | 0 | 0 | 5 | 5 |
| Buildability (§2.3) | 0 | 1 | 5 | 6 |
| Standards, ADRs and accepted decisions (§2.4) | 0 | 2 | 6 | 8 |
| Prose (§2.5) | 0 | 0 | 4 | 4 |
| **All** | **3** | **10** | **26** | **39** |

## 2. Findings

Every finding below was checked against the text it cites. The graph checks ran from a script in the session scratchpad. That script parsed all 83 todo files, compared each `Depends on` field with the plan tables, resolved every link, searched for cycles and measured each round's longest chain.

### 2.1 Consistency: most names match, but six interfaces are missing or point the wrong way

| ID | Plan(s) | Section / todo | Severity | Finding | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| R1 | SDK, harness | [SDK §3.2][sdk32], §3.1 `types.ts`; B2 | blocker | The gateway's `Context` has `pending?: SignedPendingRequest[]`, with the comment "from @agent-speak/sdk". The gateway has no runtime dependencies (§3.1), the SDK depends on the gateway (D1), and B2 builds `Context` before B15 defines `SignedPendingRequest`. B2 cannot type `Context` without a package cycle. | Move `Context` (system, messages, pending) to `@agent-speak/sdk` (`run.ts`), and keep `ModelContext` in the gateway. Update §3.1's `types.ts` line, B2's scope, B11's or B15's scope, and the harness §3.2 sentence that says `Context` comes from the gateway and the SDK. |
| R2 | Harness | [harness §3.5][har35], §3.1 and HD13; N26 | blocker | `@agent-speak/protocol` must have "no runtime dependencies", yet its union names `ContentBlock` (gateway), `AgentEvent` and `SignedPendingRequest` (SDK), and `SessionEntry` (harness). N26 brings them in as "type-only imports", but `harness` depends on `protocol`, so protocol → harness is a workspace cycle. pnpm also fails to resolve a type import from an undeclared package (AGENTS.md, "Workspace layout"). N26 depends only on N1, while those types arrive in B2, B11, B15 and N2. | Move the `SessionEntry` union (`entries.ts`) into `@agent-speak/protocol`, so the harness imports it from there. Declare the gateway and the SDK as `dependencies` of protocol, used for types only. Replace N26's acceptance criterion "no `dependencies` entry" with "the emitted JS imports nothing", and make N26 depend on N2, B11 and B15 (or have N2 write the union in protocol). |
| R3 | Harness, agent | [harness §3.4][har34]; [agent §3.7][agt37] H4; A5, A12, A13 | blocker | AD1 runs every side effect that code chooses (the triage write, replies, refunds, credits, template questions) as a code-initiated call through the pipeline. The harness has no such call, and no N todo builds one. The agent plan says the need has "none clean" workaround, yet A12 plans one ("If H4 is not yet available, implement the code-initiated call behind one function"). Round A cannot pass A12 or A13 as written. | Add a harness todo, for example N40 "Code-initiated tool calls" (size M, Depends on N13 and N14), to build `Harness.invokeTool(session, { tool, input, hostContext })`. It returns either a done result or an `awaiting_approval` result with its pending request. It writes a new `code_call` entry and a `tool_result` entry, and on `ask` an `approval_requested` entry signed through S1's `createPendingRequest`. `Approvals.resolve` then runs the call itself, with no model step. Make A12 and A13 depend on N40, and delete A12's workaround task. |
| R4 | SDK, agent | [SDK §3.3][sdk33] `shouldStop`; B13, B14; agent AD4, A7 | major | `shouldStop` returns `boolean \| { continue }`, and `RunResult` has no stop reason for a hook-requested stop. B14 still implements progress detection as "the default `shouldStop` progress policy", which must end in `no_progress`. AD4's kill switch also stops runs through `shouldStop` and needs an outcome it can tell apart from `done` (`HandoffReason: "kill_switch"`). | Let `shouldStop` return `{ stop: "no_progress" \| "hook"; reason: string }` as well, and add `"stopped"` (or reuse `"no_progress"`) to the stop-reason union, carrying `stoppedBy`. Add acceptance criteria in B13 and B14, and in A7 map the result to `kill_switch`. |
| R5 | SDK, harness, agent | [SDK §3.3][sdk33] `RunError`; B11, B14 | major | `RunError` appears in `RunResult` but is defined nowhere. The harness needs `"overflow"` from it (need 4). The agent needs `unknown_price`, because D4 ends a budgeted run with an unknown price in `stopReason: "error"`, and `HandoffReason` separates `unknown_price` from `error`. | Define `interface RunError { kind: "overflow" \| "quota" \| "retryable" \| "fatal" \| "unknown_price" \| "hook"; message: string; status?: number }` in §3.3. In B11, copy `AssistantMessage.error.kind` into it, and in B14 set `unknown_price`. |
| R6 | Harness, SDK | [harness §3.2][har32] entries; N2, N6, N7 | major | No entry type stores the system prompt, yet N7's `Session.toContext()` "rebuilds `Context` (`system`, `messages`, `pending`) from entries". A second process would rebuild the system prompt from configuration, which can drift. The SDK guide §2 also says the gateway "persists the exact frozen system prompt" to keep cache hits after a resume, and neither plan builds that. | Add `system: string` (or `systemHash` plus a `system_prompt` entry written on change) to `turn_start`. Then add a test to N7's acceptance criteria: a rebuilt `Context.system` matches byte for byte after a configuration change. Note in the SDK plan's §1 table, row §2, that the harness log persists the frozen prompt. |
| R7 | Harness, agent | [harness §3.2][har32] `runTurn`; N6; agent AD5, A9, A11 | major | `runTurn` writes the turn input as user `message_block` entries and offers no way to set their `origin`. AD5 taints any context with an `origin: "user"` block. The planner's input is code-built trusted metadata plus the reader's enums, so under N6 as written it would be tainted, and A9's criterion "the planner's context in a scripted run is clean" cannot pass. This need is missing from §3.7. | Add `TurnOptions.inputOrigin?: "user" \| "operator"` (default `"user"`) and test both values in N6. Then have A11 pass `"operator"`, and list the need in agent §3.7 as H14. |
| R8 | Harness, agent | [harness HD12][har-hd12], §3.4 `Approvals.resolve`; N14; agent AD3, AD11, A8, A12 | major | Sticky allowances (matched by tool and input hash) and grouped approvals apply to every tool, and nothing lets a product turn them off. A session-sticky allow on `support_send_reply` would skip the person on a repeated reply, which contradicts AD11 and A12's "Every reply pauses for approval in every stage". Grouping also has no defined meaning for non-shell tools ("the same normalised command") or for quorum. | Add `RegisteredTool.approvalReuse?: "sticky" \| "group" \| "both" \| "none"` (default `"both"`), and make the pipeline refuse `sticky` or `group` on a tool set to `"none"`. Add that test to N14. Then have `compilePolicy()` set `"none"` for T2–T4, and add to A8 or A12 a test that a sticky resolution on a T3 call is refused. |
| R9 | Harness, agent | [harness §3.4][har34] `Approvals.resolve`; N13; agent AD9, A13 | major | HD9 passes `budgetUsd: sessionCap − spend` "to each `run` and `continueRun`", but `Approvals.resolve(session, resolutions, { sticky, group })`, the only resume path, takes no budget or signal. AD9's per-ticket budget would not bind on a resumed planner or a resumed code call. | Extend the options to `{ sticky?; group?; budgetUsd?; signal?; hostContext? }`, and add an N13 test that a resume stops with `budget` when the remaining cap is too small. |
| R10 | Harness, agent | [harness §3.4][har34] `quorum?: QuorumPolicy`; N14; agent §3.3, A8 | major | `QuorumPolicy` is named but has no fields. The agent's `quorumPolicy()` returns one and needs each approver's roles, yet `Resolution.by` is a bare string and `Approvals.resolve` takes no approver credential, so the policy cannot tell a `billing` approver from any other. | Define `interface QuorumPolicy { evaluate(request: SignedPendingRequest, resolutions: Resolution[]): Promise<"met" \| "pending" \| "rejected" \| "expired"> }` in N14. State that the host fills `by` only after authenticating the approver, and add `roles(principalId)` to the agent's `ApproverDirectory`, which A8 tests. |
| R11 | Harness, agent | harness §3.5 `EvalRow`; N36; agent §3.5 `Grade` | minor | `EvalRow.passed` is a boolean, but the agent's `Grade` can be `unscored: "judge_unknown"`, and §5.3 says an unparsable verdict is "never a fail". The row has nowhere to carry an unscored trial. | Change the field to `passed: boolean \| null` and add `unscored?: "judge_unknown" \| "infra_error"`. Fold this into H13's change to N36 (§4). |
| R12 | SDK | B11 scope; [SDK §3.3][sdk33] `AgentEvent` | minor | B11 promises "a warning event when it fires" for `maxSteps`, and the guide §3 says the SDK warns. The closed `AgentEvent` union has no warning type, so B11's own closure check would fail it. | Add `{ type: "warning"; code: "max_steps"; detail: string }` to the union in §3.3 and to `AGENT_EVENT_TYPES`. |
| R13 | Agent | [agent §3.4][agt34] `TriageAgentOptions`; A13 | minor | `Bundle.models` holds `ModelRef`s, but `ContextSettings.model` needs a `Model`, and `createModel()` needs an adapter and a `ProviderConfig` with an API key. No option supplies them. | Add `models: (ref: ModelRef, role: "reader" \| "planner" \| "drafter" \| "judge" \| "simulator") => Model` to `TriageAgentOptions`, and test it in A13 with `ScriptedModel`. |
| R14 | SDK | [SDK §3.2][sdk32]–§3.3 | minor | The harness and agent plans use several types the SDK sketch never declares: `ModelContent`, `ModelCaps`, `Clock`, `TracerLike`, `DeliveryReceipt`, `ToolCallEvent` and `ContextEvent`. Needs 2, 3 and 12 cover three of them; the rest would be guessed. | Declare each in one line in §3.2 or §3.3. For example, `type ModelContent = Extract<ContentBlock, { type: "text" \| "image" }>` and `interface Clock { now(): string }`. |
| R15 | SDK, harness | [SDK §6.3][sdk63]; [harness §6.4][har63] | minor | The SDK plan says the harness round starts "as soon as B11, B13 and B15 are done" and draws a branch "from B15 to the first harness todo". The harness plan and roadmap M6 start Round N after B1 and B2, with `B2 ─► N1`. | Replace the SDK §6.3 sentence with the harness plan's staged list, and keep one roadmap line. |
| R16 | Agent | [agent §3.7][agt37]; ADR 0022; A12 | minor | The agent's needs are labelled H1–H13 and S1–S2. H1–H3 are already todo IDs (`docs/todos/done/H1-hn-corpus.md`), which is why the harness plan chose the `HD` prefix. "H4" now means two things. | Rename the labels AH1–AH13 and AS1–AS2 in build-agent §3.7, §6, ADR 0022 and A12. This review keeps the current labels so it matches the plan as written. |

### 2.2 Coverage: the guides are almost fully planned, and five recommendations are silently missing

Each plan maps its guide's design sections to todos and lists deferrals and rejections. Reading each guide's "Recommended design" paragraphs and their supporting paragraphs against those tables found five recommendations that are neither planned nor deferred, plus R6's frozen system prompt (§2.1).

| ID | Plan(s) | Section / todo | Severity | Finding | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| R17 | SDK | §1 table, row §4; B10 | minor | The SDK guide §4 says "redaction becomes an opt-in per tool rather than OpenAI's generic default". No todo builds per-tool redaction, and §1 does not defer it. | Add `redactErrors?: boolean` to `ToolDefinition` with a B10 test, or list it under §1's non-goals with a reason. |
| R18 | SDK | B8, B9 | minor | The guide §4 says each adapter "lowers the canonical schema to its strict form and strips the nulls it added before validation". B8 and B9 lower to strict form but never strip the added nulls. | Add "strip nulls added by strict lowering before validation" to the scope and acceptance criteria of B8 and B9. |
| R19 | Agent | [agent §1][agt], §8 row | minor | The agent guide §8 says to "put graders and capability runs on batch pricing". No todo plans it, and the deferred list omits it. Neither gateway adapter supports a batch API. | Add it to §1's deferred list ("needs a batch adapter in the gateway; revisit after A20"), or add a todo after A20. |
| R20 | Agent | [agent §3.5][agt35] `DashboardRow`; A22 | minor | The agent guide §7's dashboard row includes "tool and guardrail error rates" and "a sampled judge score". `DashboardRow` has `toolErrorRate` but neither of the other two. | Add `guardrailFlagRate` and `sampledJudgeScore: number \| null` to `DashboardRow` and to A22, or defer the judge score until the judge is calibrated (A20). |
| R21 | SDK | D9, D11; ADR 0009 | minor | Two settling tests are handed to "P2": D9 says "P2 reruns the measurement on recorded runs", and D11 says "P2's eval round retunes". P2 is a planning todo, and the work sits in N39, which already names HD9 and SDK D11. | Replace "P2" with "N39" in D9, D11 and ADR 0009, so each settling test points at a todo. |

### 2.3 Buildability: the graph is sound, and one cross-round task source is unscheduled

The scripted checks passed on every structural rule. IDs are unique across 83 files, every `Depends on` link names an existing todo, the graph is acyclic, every todo's acceptance criteria include the repo gate, and every plan table's dependencies and sizes match its todo file. Adding `N38 → A19` would create no cycle, because nothing in Round A depends on N38 or N39.

| ID | Plan(s) | Section / todo | Severity | Finding | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| R22 | Harness, agent | HD8; N38; A19; [agent §6.2][agt62] | major | N38's scope holds "10 triage tasks shared with P3", but N38 depends only on N37, and A19's criterion is "N38 can read the 10 classification tasks". Adding `N38 → A19` would hold the harness baseline behind most of Round A (A19 → A17 → A15 → N35). Round N also builds no runner for a `TriageTask`, which needs the fake helpdesk and the triage tools, and mini-swe-agent has only bash. N38 also commits "the task list", while AD8 keeps real tickets out of the repo. Finally, N38's first task asks for the owner's sign-off on HD8, which the owner already gave. | Split N38. N38 keeps the 20 tasks from this repository's history and its live budget check. A new N38b, "Add the 10 shared triage tasks" (Depends on N38, A19 and A17), adds them through `@agent-speak/triage-agent/evals` and records how mini-swe-agent receives a ticket, or else scores those 10 for our harness only. Commit only task ids and graders, never tickets. Update HD8, the agent's §6.3 line "N38's 10 shared tasks come from A19", and N38's task list. |
| R23 | SDK | B1 `Depends on` | minor | B1 links to `P4-plan-review.md` relative to `ready/`, but P4 sits in `ongoing/` and ends in `done/`, so the link is broken now and stays broken. | Link to `../done/P4-plan-review.md`, which resolves once P4 closes. |
| R24 | SDK, agent | [SDK §4.4][sdk44]; agent §4.5 | minor | Two plans state the wrong longest chain. The SDK plan says nine todos through B5 and B8. The real longest is ten: B1 → B2 → B3 → B4 → B11 → B13 → B15 → B18 → B19 → B20. The agent plan says twelve; the real longest is 13: A1 → A2 → A3 → A6 → A7 → A11 → A12 → A13 → A14 → A15 → A17 → A18 → A20. The harness's 15 is correct, though N7 → N27 → N28 ties it. | Correct both sentences. |
| R25 | SDK | B8, B9, B11, B15, B19 | minor | Five SDK todos are size L, which the template defines as "a day: split it if you can", while the other two rounds have none. B15 alone carries the signers, hashing, the pending record, `continueRun`, `blockingApprovals()` and clarification, across nine acceptance criteria. | Split B15 into B15a (signers, `canonicalInputHash`, the pending record and S1's `createPendingRequest`) and B15b (`continueRun`, `blockingApprovals()` and clarification). Then move B19's reference loop into its own todo, B19b. B8, B9 and B11 can stay L. |
| R26 | All | Tasks sections of A8, A9, A12, A14, A16, A22, A23, N14, N23, N25, N28, N30, N32, N33, N34, N35, N36, N39 | minor | These 18 todos list one task each, although the template asks for "a checklist detailed enough that someone new to the repo could do the work in order". Their scope and acceptance criteria carry the detail, so each is checkable, but N35, N28 and N14 are M-size todos with four or more deliverables. | Expand the Tasks sections of N14, N28 and N35 into ordered steps now, and the rest when each todo is claimed. |
| R27 | SDK | B10 | minor | B10's D7 check runs "on the strict schemas B8 and B9 emit (or their fixtures)", but B10 depends on neither B8 nor B9, and no todo produces those fixtures before B10. | Have B10 write its own strict-schema fixtures from the Anthropic and OpenAI references, or move the comparison into B18 and keep ADR 0007 provisional until then. |

### 2.4 Standards, ADRs and accepted decisions: the repo rules hold, but the write-up still reads as if the owner had not answered

The repo coding standards hold in every plan. All three plans use ESM, `tsconfig.base.json`, Biome, `node:test` through tsx, exact pins and removable components. Every named pin is already in `pnpm-lock.yaml` (pi-schema 1.5.2, `@cfworker/json-schema` 4.1.6, `@standard-schema/spec` 1.1.0, `@opentelemetry/sdk-trace-base` 2.12.0, the OTLP exporter 0.223.2, `@modelcontextprotocol/client` and `server` 2.4.0, and zod 4.6.7). The still-unpicked pins (the JSON Schema generator, `srt` and `inspect-ai`) each carry the one-week rule in their todo. The ADR index lists all 31 records, and each decision without an ADR says why.

| ID | Plan(s) | Section / todo | Severity | Finding | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| R28 | All | 13 headings; §2 intros, "Why the owner decides" paragraphs and §6.2 in each plan; B15, N38 | major | Thirteen decision headings still end "(owner to confirm…)": D2, D5, D8, HD4, HD5, HD8, HD11, AD2, AD3, AD6, AD8, AD9 and AD14. Their anchors are linked 57 times from 37 files (ADRs 0002, 0005, 0008, 0015, 0018, 0020, 0023, 0024, 0027, 0028 and 0031, the ADR index, 23 todos and two plans). The text under them also reads as open. "Choice, provisional" or "Choice, proposed" appears under accepted HD4, HD8 and HD11, as does "Choice, proposed" under AD6 and "Agent side, proposed" under AD8. Twelve "Why the owner decides" paragraphs remain, and D5's still argues for a required `signer`, the opposite of what was accepted. The SDK intro says "three need the owner", §1 keeps the packages private "until the owner confirms D8", and §6.2 asks the owner about D2, D5 and D8. Harness §6.2 asks the owner about HD4, HD5, HD8 and HD11, and asks P3 questions that agent §3.6 already answered. Agent §6.2 says "six decisions need the owner's call", which contradicts [implementation plans §6][ip6] ("the plans now hold no open owner decision"). B15's risk ("may make `signer` required") and N38's sign-off task are stale too. | Drop the parenthetical from each heading, so the D2 heading ends "…Chat Completions first", and regenerate the 57 links with the scratchpad `slugs.mjs` rules. Replace "Choice, proposed" or "provisional" with "Choice", keeping "N19 may propose a superseding ADR" in HD4. Rename each "Why the owner decides" to "What the owner still supplies", or delete it where nothing remains (D2, D5, D8, HD5). Rewrite each §6.2 to list only the inputs scheduled in A19, A20, A24 and N19. Fix B15's risk and N38's task. |
| R29 | Agent | [agent AD8][agt-ad8] "Eval data" bullet, §6.1; ADR 0027; A19 | major | The accepted wording disagrees with the body. The acceptance line, ADR 0027's status and implementation plans §6 say the repo holds "only synthetic and de-identified tickets". The AD8 "Eval data" bullet says "the repository holds only synthetic tickets", §6.1 keeps real tickets out "unless the owner allows them", and A19 commits "only the converter and the checklist". Whether de-identified customer tickets enter git is a data-policy fact, so a builder needs one answer. | Ask the owner to confirm one wording. This review proposes the accepted one: de-identified tickets may be committed once they pass A19's checklist, and raw tickets never. Then align the AD8 bullet, §6.1, A19's task and ADR 0027's body, and R22's N38b. |
| R30 | SDK | ADR 0005, Consequences | minor | ADR 0005 says "If the owner and P2 choose a multi-process deployment, `signer` becomes a required option". P2 did choose one (HD5), and the owner kept the ephemeral default (ADR 0015), so the conditional now reads as unmet. | Add a dated outcome line to 0005: "2026-11-18: the default stays `ephemeralSigner()`; the harness always passes `hmacSigner()` (ADR 0015)." If the ADR rules forbid editing an accepted record, record the outcome in a new ADR 0032. |
| R31 | SDK, harness | ADR 0009; [harness HD9][har-hd9]; harness §6.2 | minor | Harness §6.2 asks whether ADR 0009 should take HD9's session cap. It should, because ADR 0028 builds on both, and ADR 0009 is still Proposed. | Add to 0009's Consequences: "The harness adds a session cap by passing the remainder (HD9); summary calls are pre-checked with `projectCallCost()` (B14); N39 measures overshoot." Then close the §6.2 question. |
| R32 | All | [ADR index](../../decisions/README.md); HD15; ADR 0020 | minor | The index drifts from the records. It drops the status qualifiers of six ADRs (0005, 0020, 0023, 0027, 0028 and 0031) and shortens the titles of four (0022, 0026, 0030 and 0031). HD15's row says "none: §3.4 records the API", yet ADR 0020's Decision records HD15's proxy shape. ADR 0020 is Accepted but says N19 "may move interactive runs to Docker", while the ADR rules require a new record for any change. | Copy titles and statuses verbatim into the index. Point HD15's ADR cell at 0020, or move the proxy sentence into its own ADR. In HD4, N19 and ADR 0020, say that a change after N19 is a superseding ADR. |
| R33 | All | ADR README "Status"; 12 Proposed ADRs | minor | The README defines Accepted as "reviewed in P4 or confirmed by the owner". Twelve ADRs are Proposed and not provisional: 0001, 0003, 0004, 0006, 0009, 0010, 0012, 0016, 0017, 0019, 0029 and 0030. P4's acceptance criteria do not say which of them become Accepted when P4 closes. | When P4 closes, mark those twelve Accepted (after R1, R2 and R31 change 0001, 0012 and 0009), or record which stay Proposed and why. Leave the provisional ones for their named todos. |
| R34 | Harness | N16, N37 | minor | AGENTS.md requires an allowlisted environment for third-party code. N16 spawns the `srt` binary, and N37 runs `inspect-ai` and mini-swe-agent, yet neither states its environment. N17, N24, N29 and N30 do say `spawnEnv`. | Add "spawn with `spawnEnv()`" to N16's tasks. For N37, add a criterion that the bridge and mini-swe-agent get `spawnEnv()` plus the bridge's proxy URL and a dummy key, never a real provider key. |
| R35 | Harness | N34 | minor | N34's matrix runs "a scripted session with each flag off", and one flag sets the sandbox tier to `none` with `unsafe: true`. If that session calls `bash`, `write` or `edit`, a mock model touches the host, which AGENTS.md forbids. | Add a criterion to N34: under `sandbox: "none"`, the scripted session calls no host tool, or the matrix keeps `fakeSandbox()` and asserts only the tier stamp in `env_stamp`. |

### 2.5 Prose: each plan states its thesis well, and the longest lists and overloaded terms cost the most

The rubric in §5 gives the evidence. These four findings change how a builder reads the plans.

| ID | Plan(s) | Section / todo | Severity | Finding | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| R36 | Agent | Introduction | minor | The introduction is one 245-word paragraph, and its bolded thesis is a 57-word sentence with four verbs ("build…, compose…, prove…, and release…"). | Split the paragraph after "…against the lower plans' APIs", and split the thesis into two sentences: what to build first, then how it ships. |
| R37 | Harness, agent | [harness §3.6][har36]; [agent §3.7][agt37] | minor | The needs come as one 13-item numbered list (416 words) and one 13-item bullet list (511 words), well past seven items, so the middle items sit in the dead zone of the list. Those middle items include H4 and H8, the two the agent plan asks P4 to decide first. | Group each list by its upstream todo (for the harness: hooks and events, resume, gateway, deferred), and lead with the needs that have no workaround. |
| R38 | Agent | AD1, AD5, §3.2–§3.4 | minor | "Context" names four things: a model context (reader, planner, drafter), the SDK's `Context`, `TrustedContext` and "context taint". One sentence uses two of them: "A context is tainted when any block in its session has `origin: "user"`". | Call the reader, planner and drafter "roles" (the plan already writes "context role" in H1), and keep "context" for the SDK's `Context`. |
| R39 | All | §4.1–§4.7 and §6.1–§6.2 headings | minor | The decision and test-strategy headings state conclusions, but the stage headings ("Stage 1: foundations", "Stage 2: providers") and "Risks" and "Open questions" do not. | State each stage's outcome, for example "4.1 Stage 1 builds the gateway types and the scripted model every later todo tests against". |

## 3. The P4 questions the plans raised all have an answer

- **`Cost.total` nullable, and whether `context_transformed` is enough (from P1):** both are answered in harness §3.6, and the answers stand.
- **Whether `continueRun` re-runs the gate (harness need 7):** it should not. With a verified `allow` resolution, `continueRun` runs the call without calling `beforeToolCall`, and the harness re-evaluates policy before it resolves (HD5). If the SDK re-ran the gate, the harness's own pipeline would ask again on every resume.
- **Whether ADR 0009 takes HD9's session cap:** yes, through R31.
- **Whether N38 depends on A19:** no. Split N38 instead (R22), so the harness baseline does not wait for Round A.
- **Whether the canary's "every T2+ action approved by a person" holds in general release:** yes, as written. AD2 already says T2 "asks one person in every stage", and the automatic T2 rule is deferred in agent §1. The question can be closed.
- **H4 and H8, which the agent plan asks P4 to decide first:** H4 becomes the new todo N40 (R3), and H8 becomes two entry types in N2 (§4).

## 4. Needs reconciliation: 24 change upstream, 3 drop, 1 is already covered

The table covers the 13 needs in [harness §3.6][har36] and the 15 in [agent §3.7][agt37], under their current labels.

| Need | Upstream plan | Verdict | Exact change |
| --- | --- | --- | --- |
| Harness 1: `transformContext` returns a per-call view | SDK | change upstream | In SDK §3.3, add to `transformContext` the comment "the returned messages are this call's request only; `result.messages` and `context` keep the full history". Add a B13 test that a masked view leaves the next step's history unchanged. |
| Harness 2: `ContextEvent` fields | SDK | change upstream | In SDK §3.3, declare `interface ContextEvent extends HookEventBase { system: string; messages: readonly Message[]; model: ModelRef; lastUsage?: Usage }`, and test the fields in B13. |
| Harness 3: the model's window | SDK | change upstream | Give `Model` a field `readonly caps: ModelCaps`, with `interface ModelCaps { contextWindow: number; maxOutputTokens: number; images: boolean; reasoning: boolean }` (SDK §3.2). Have `catalog.json` carry the first two fields, B4 expose them, and B5 fill them. D9's projection uses `maxOutputTokens` too. |
| Harness 4: overflow as a typed, resumable outcome | SDK | change upstream | Define `RunError` with `kind` (R5) in B11. In B6, add a criterion that `transformMessages` drops a trailing errored assistant message, which the guide §2 already asks for ("skips errored turns"). Then add a B15 test that `continueRun` on such a context re-issues the call. |
| Harness 5: `tool_call_end.result` is the post-`afterToolCall` result | SDK | change upstream | Add a comment on `tool_call_end` in SDK §3.3 and a B13 test that the event carries the replaced result. |
| Harness 6: `Context` is constructible | SDK | change upstream | After the R1 move, document `Context` as plain JSON in SDK §3.3. In B15, add a test that resumes from a `Context` built by hand from stored messages, beside the existing JSON round trip. |
| Harness 7: resume does not re-run the gate | SDK | change upstream | State in `continueRun`'s comment (SDK §3.3) that a call with a verified `allow` resolution runs without `beforeToolCall`. Add a B15 test that the gate is not called for it. |
| Harness 8: `activeTools` semantics | SDK | change upstream | In SDK §3.3, add to `ModelCallPatch.activeTools` that it may name `deferred` tools, which are then sent, and that tools go out in definition order whatever the list's order. Test both in B13. |
| Harness 9: the cost projection as an export | SDK | change upstream | Add `declare function projectCallCost(model: Model, context: ModelContext, options?: StreamOptions): Cost` to SDK §3.3 (`budget.ts`), exported from B14. D9's loop check then calls it too. |
| Harness 10: shared OTel names | SDK, harness | change upstream | In B17, have `@agent-speak/sdk/otel` export `GEN_AI_ATTRIBUTES` and `SEMCONV_GENAI_COMMIT = "d28355d"`. Then delete the constant from harness §3.5, and import it in N31. |
| Harness 11: the capability list's contents | SDK | change upstream | Have B20 export `const CAPABILITIES` and list each string in the SDK README, and add the B20 criterion that `run_start.capabilities` equals `CAPABILITIES`. The plan itself need not list the strings now. |
| Harness 12: `DeliveryReceipt` fields | SDK | change upstream | In SDK §3.3, declare `interface DeliveryReceipt { id: string; kind: "steer" \| "follow_up"; message: ContentBlock[]; stepIndex: number }`, and fire `steer_applied` for both kinds. Test it in B16. |
| Harness 13: a client-tool pause kind | SDK | drop | Drop the need for Rounds B and N, because harness §1 defers the third host-tool pattern. Record it in SDK §6.2 as a later item. |
| Agent S1: a pending request built outside a run | SDK | change upstream | Add `declare function createPendingRequest(fields: { kind: "approval"; callId: string; tool: string; input: unknown; policyVersion?: string }, signer: ApprovalSigner): Promise<SignedPendingRequest>` to SDK §3.3, built in B15 (B15a under R25). The new harness todo N40 depends on it. |
| Agent S2: an output-only run | SDK | change upstream | Add B11 criteria that a run whose only tool is an `outputTool` ends `done` after one valid call, and that a schema failure spends one model call of `maxSteps`. |
| Agent H1: per-turn run settings | Harness | change upstream | In harness §3.2, add `system?`, `tools?: string[]` (an allowlist of registered names), `output?`, `model?`, `maxSteps?` and `modelOptions?` to `TurnOptions`, built in N6. The protocol's `turn/start` (N27) stays as it is. Then drop the agent's workaround of one harness per role. |
| Agent H2: per-turn host context | Harness | change upstream | Make the types generic, `createHarness<H>()` and `TurnOptions<H>.hostContext?: H`, and have the registry's `ToolWrapper` receive the turn's value (N6, N11). Then drop the `AsyncLocalStorage` workaround. |
| Agent H3: child sessions for workflow steps | Harness | change upstream | Change the signature to `Session.child(link: { spawningCallId: string } \| { stepId: string })` and add `stepId?` to `subagent_link` (N5). |
| Agent H4: a code-initiated tool call | Harness | change upstream | Add the new todo N40 (R3). |
| Agent H5: `PermissionHook`, `ToolCall` and `PolicyContext` types | Harness | change upstream | In N12, declare `interface ToolCall { callId: string; tool: string; input: unknown; initiator: "model" \| "code" }`. Declare `interface PolicyContext { session: Session; hostContext: unknown; entries: readonly SessionEntry[]; mode: PermissionMode; policyVersion: string }`, and `type PermissionHook = (call: ToolCall, ctx: PolicyContext) => Promise<{ decision: "deny" \| "ask"; reason: string; rule?: string } \| undefined>`, so a hook cannot allow at the type level. |
| Agent H6: `PolicyStore` | Harness | drop | Remove `policyStore?` from `PermissionConfig` (harness §3.4). Rewrite R4 in harness §3.7 as "a `PermissionHook` reads the product's store", which also frees the name for the agent's `PolicyStore`. |
| Agent H7: shadow mode by tool | Harness | drop | The agent shadows at the helpdesk boundary (AD14), which keeps reads live. Leave the harness's `shadow` mode as it is, and add to harness §3.7 R5 that the agent uses `shadowHelpdesk` instead. |
| Agent H8: product entries | Harness | change upstream | In N2, add `session_header.product?: { name: string; version: string; bundleHash: string }` and the entry `{ type: "product_record"; name: string; data: unknown }`. The `name` is namespaced (`"triage.record"`), and `data` is documented as outside HD11's stable surface. Then store shadow labels as `product_record` entries. |
| Agent H9: decision entries for every gate decision | Harness | change upstream | In N2 and N12, add `{ type: "permission_decision"; callId: string; tool: string; decision: "allow" \| "deny" \| "ask"; rule?: string; by?: string; policyVersion: string; inputHash: string }`, written on every `decide()`. |
| Agent H10: declared output trust on tool results | Harness | change upstream | Add `outputTrust?: "trusted" \| "untrusted"` to `RegisteredTool`, defaulting to `"untrusted"` for `mcp:*` and `"trusted"` otherwise (N11). Copy it into `tool_result.trust` (N2). |
| Agent H11: pipelines without allow rules | Harness | covered | The harness §3.4 comment already limits `PermissionConfigError` to an allow rule that shadows the callback. Add one N12 test that a config of deny rules, hooks and a host callback starts cleanly. |
| Agent H12: identifier hashing in spans | Harness | change upstream | Add `hashAttributes?: { key: Uint8Array; names: string[] }` to `projectSpans` options, with HMAC-SHA-256 per named attribute (N31). |
| Agent H13: a third eval baseline | Harness | change upstream | Change `EvalRow.harness` to `string`, documenting `"ours"`, `"mini-swe-agent"` and `"single-call"`, and add `tags?: string[]` for the slice and `safety`. Include R11's `passed: boolean \| null` with `unscored?` (N36). |

## 5. The writing-review rubric scores each plan 3 or 4 out of 5 on every C

The review ran `/anthropic-skills:writing-review` on each plan. The sentence counts below come from a scratchpad script over prose lines, with code blocks and tables excluded.

### 5.1 SDK plan: the tightest of the three, held back by stale owner text

**Diagnosis.** The thesis is clear and well placed. It is the bolded last sentence of the introduction: build the gateway and scripted model first, then the loop, and finish on a triage capstone. The biggest structural problem is that three decisions read as open after the owner closed them (R28). For a builder starting B1, the plan lacks only the cross-plan types in R14.

| C | Score | Evidence |
| --- | --- | --- |
| Coherence | 4 | The thesis ends the 196-word introduction, and the D1–D12 and §5 headings state conclusions. But the introduction says "three need the owner", three "Why the owner decides" paragraphs argue a settled choice, and the §4 and §6 headings are vague (R39). |
| Continuity | 4 | Terms hold steady (`uncachedInput`, "seam", "pause"), but "P2" means both a planning todo and the harness round's work (D9, D11; R21). |
| Clarity | 4 | 11 of 244 prose sentences (5%) exceed 35 words, and one exceeds 45. Most sentences are actor-first ("B7 builds the table…"). |
| Concision | 4 | The text has little padding. Only the stale owner paragraphs (about 150 words) can be cut. |
| Cadence | 4 | Sentence openings vary, and lists stay at or under seven items, apart from the 11-row seams table, which is a table. |

Fix coherence first, because a builder who reads D5's "Why the owner decides" would make `signer` required.

**Line-level fixes.**
1. **COH-6 / accuracy**, introduction, sentence 7: "Nine of the decisions follow from the evidence; three need the owner, who must name the first providers, approve the signing-key model and choose when the SDK is published (§2)." **Fix:** "Nine decisions follow from the evidence, and the owner accepted the other three, D2, D5 and D8, on 2026-11-18."
2. **CON-6 Synonym rotation**, D11 Evidence, sentence 3: "…a starting point that B14 makes configurable and that P2's eval round retunes." **Fix:** "…a starting point that B14 makes configurable and N39 retunes."
3. **COH-7 Vague heading**, §4.1: "Stage 1: foundations". **Fix:** "Stage 1 builds the gateway types and the scripted model that every later todo tests against."
4. **CON-5 Overlong sentence**, D7 Evidence, sentence 2 (45 words, beginning "Pi-schema "compiles once into plain closures"…"). **Fix:** end the sentence after "has no dependencies", and move the README test count into its own sentence.

**Cut list.** The "Why the owner decides" paragraphs under D2, D5 and D8 (settled). The §6.2 "For the owner" bullet (settled). Cuts remove about 200 words (about 2%).

### 5.2 Harness plan: strong reasoning, but the long lists and status wording slow it down

**Diagnosis.** The thesis is clear. It is the bolded last sentence of the second introduction paragraph, and the first paragraph ends on a preliminary claim, as the rules require. The biggest structural problem is the 13-item needs list in §3.6, whose most important items sit mid-list (R37). Status wording also contradicts the decision table (R28). A builder of N26 would also miss that the protocol types point back into the harness (R2).

| C | Score | Evidence |
| --- | --- | --- |
| Coherence | 4 | The opening statistic (24.3 points) gives the stakes, and the thesis closes the introduction. HD headings state conclusions, but four still say "owner to confirm", and §6.2 asks questions that the agent plan answered. |
| Continuity | 3 | HD4, HD8 and HD11 are "Accepted" in the table but "Choice, provisional" or "Choice, proposed" in their bodies. The 13-item list (416 words) has no grouping transitions. |
| Clarity | 4 | 18 of 317 prose sentences (6%) exceed 35 words. Most subjects are actors ("The harness folds…", "N4 runs…"). |
| Concision | 3 | §1's non-goals run 272 words in one paragraph. Each merged decision repeats the SDK side under "SDK side, unchanged" (HD5, HD7, HD9). |
| Cadence | 3 | HD6 lists 12 methods inline, and §3.6 lists 13 needs. Several §6 bullets run past 40 words (the risks bullet is 58). |

Fix continuity first, because the conflicting status words make accepted decisions look provisional.

**Line-level fixes.**
1. **CON-6 / accuracy**, HD4, Choice: "**Choice, provisional.** Interactive local runs default to the OS backend over `srt`." **Fix:** "**Choice.** Interactive local runs default to the OS backend over `srt`; N19's measurement can only change this through a superseding ADR."
2. **CON-8 Overlong list**, §3.6: "The harness needs thirteen things the SDK plan does not yet state." **Fix:** "The harness needs twelve things for Round N and one for later. Four concern hooks and events (B13), three concern resume (B15), and five concern the gateway, budget, telemetry and versioning."
3. **CON-5 Overlong sentence**, §6.1, the first bullet (58 words, beginning "**The SDK plan may not absorb the thirteen needs.**"). **Fix:** split it after "names each with its SDK todo", and move the three workarounds into a second sentence.
4. **COH-6 Stale foot**, §6.2: "**For the owner:** HD4 (the sandbox defaults, after N19's measurement), HD5 (with SDK D5: …)…". **Fix:** "The owner answered HD4, HD5, HD8 and HD11 on 2026-11-18. N19's measurement is the only open input."

**Cut list.** The "Why the owner decides" paragraph under HD5 (settled). The §6.2 "For P3" bullet (answered in agent §3.6). The duplicate "SDK side, unchanged" restatements, which a link to the SDK decision can replace. Cuts remove about 350 words (about 3%).

### 5.3 Agent plan: the most concrete opening, with the heaviest introduction and the most overloaded term

**Diagnosis.** The thesis is clear and well placed. It is the bolded last sentence of the introduction, which opens on the concrete "also check bob@example.com" case. The biggest structural problem is the length: one 245-word introduction paragraph and a 57-word thesis (R36). Agent §6.2 also contradicts the owner record (R28). For a builder, "context" carries four meanings (R38), and the need labels collide with todo IDs (R16).

| C | Score | Evidence |
| --- | --- | --- |
| Coherence | 3 | The thesis ends the introduction, but the paragraph is 245 words and the thesis 57. The AD headings state conclusions, yet six still say "owner to confirm", and §6.2 says "six decisions need the owner's call". |
| Continuity | 3 | "Context" means four things (R38), and the H and S labels reuse todo IDs (R16). Transitions within the AD sections are good ("First… Second… Third" in AD1's evidence). |
| Clarity | 4 | 21 of 355 prose sentences (6%) exceed 35 words, and three exceed 45. Most are actor-first ("Code applies one rule", "A7 measures…"). |
| Concision | 3 | "SDK and harness sides, unchanged" restatements fill AD3, AD5, AD7, AD8, AD9 and AD10. "Why the owner decides" remains under six accepted decisions. |
| Cadence | 3 | §3.7 is a 13-item list of 511 words, and the §6.3 schedule is one 134-word block. |

Fix coherence first, because the introduction and §6.2 are where a builder decides what is still open.

**Line-level fixes.**
1. **CON-5 Overlong thesis**, introduction, last sentence: "In one sentence: **build the trusted context, the tool contracts and the tier table first, compose the reader, planner and drafter as linked harness turns whose side effects run in code behind the pipeline, prove the design offline against injection and cross-customer tasks, and release only through a pass^5 gate, shadow mode and a graded kill switch.**" **Fix:** "**Build the trusted context, the tool contracts and the tier table first, then run the reader, planner and drafter as linked harness turns whose side effects run in code. Prove the design offline against injection and cross-customer tasks, and release only through a pass^5 gate, shadow mode and a graded kill switch.**"
2. **COH-6 Stale foot**, §6.2: "**For the owner:** six decisions need the owner's call." **Fix:** "The owner accepted AD2, AD3, AD6, AD8, AD9 and AD14 on 2026-11-18. What remains are inputs, scheduled in A19, A20 and A24."
3. **CLA-11 Garden path**, AD9 heading: "…hands the ticket to a person (value owner to confirm)". "Value owner" reads as a noun phrase. **Fix:** drop the parenthetical (R28), or write "(the owner confirms the production value)".
4. **CON-6 Synonym rotation**, AD5: "A context is tainted when any block in its session has `origin: "user"`…". **Fix:** "A role's session is tainted when any block in it has `origin: "user"`…".

**Cut list.** Six "Why the owner decides" paragraphs (keep only what the owner still supplies). The "SDK and harness sides, unchanged" restatements, replaced by one link each. The §3.6 closing paragraph, which repeats answers given in AD1, AD2, AD5 and AD6. Cuts remove about 600 words (about 5%).

### 5.4 After the fixes, every plan scores 4 or 5 on every C

The review re-ran `/anthropic-skills:writing-review` on the three fixed plans (2026-11-18). The sentence counts come from the same scratchpad script, over prose lines with code blocks and tables excluded.

| Plan | Coherence | Continuity | Clarity | Concision | Cadence | Evidence for the change |
| --- | --- | --- | --- | --- | --- | --- |
| SDK | 4 → 5 | 4 → 5 | 4 → 4 | 4 → 5 | 4 → 4 | The introduction now says the owner accepted D2, D5 and D8, and the three "Why the owner decides" paragraphs are gone (D5's became a one-line outcome). Stage, risk and question headings state conclusions. "P2" now means only the harness plan, and N39 carries the retuning. 9 of 248 prose sentences (4%) exceed 35 words and one exceeds 45 (the 46-word thesis, unchanged). |
| Harness | 4 → 5 | 3 → 4 | 4 → 4 | 3 → 4 | 3 → 4 | HD4, HD8 and HD11 now read "Choice." and their status words match the table. §6.2 states that nothing is open. §3.6 groups twelve needs under three upstream heads, none longer than four items. The "SDK side, unchanged" blocks under HD5, HD7 and HD9 became one-line links. 17 of 335 sentences (5%) exceed 35 words and one exceeds 45. §1's 281-word non-goals list and HD6's twelve inline methods remain, which holds concision and cadence at 4. |
| Agent | 3 → 4 | 3 → 4 | 4 → 4 | 3 → 4 | 3 → 4 | The introduction is two paragraphs (132 and 118 words), and the thesis is two sentences of 30 and 23 words. "Role" names the reader, planner and drafter, "context" means only the SDK's `Context`, and "session taint" replaces "context taint". The need labels are AS and AH. §3.7 groups sixteen needs under six heads of at most four items. §6.2 matches implementation plans §6. 17 of 342 sentences (5%) exceed 35 words, against 21 before, and one exceeds 45 (the guide-design sentence in the introduction). Coherence stays at 4 because the first introduction paragraph still opens on a 52-word sentence. |

Fix the harness plan's §1 non-goals next if the plans are edited again: split the list into "other plans" and "later work", which would lift its concision and cadence to 5.

## 6. P4 closes after the 13 blocker and major fixes, and the owner decides R29

The fixes fall into three batches, and the plans can be fixed in this order:
1. **SDK plan:** R1, R4, R5, R12, R14 and the 14 SDK-side needs in §4, with B15 split (R25). These changes unblock the other two plans.
2. **Harness plan:** R2, R3 (the new N40), R6–R10, R22 (the N38 split) and the harness-side needs. R7 adds the H14 need.
3. **All three plans and the ADRs:** R28's heading and link rename across 37 files, R29 once the owner picks the data wording, R30–R33, and the minor items.

The owner needs to decide only R29. The other 38 findings have a proposed fix that stays inside the decisions the owner accepted on 2026-11-18. (Resolved: the owner's acceptance of AD8 already settles R29, so §7 applies the accepted wording without a new question.) Once the blocker and major fixes land and the minor ones are fixed or accepted, P4 can mark the ADRs in R33, close M4 in the roadmap, and start Round B with B1.

## 7. Fixes applied: 38 findings fixed, one accepted in part, and no question left for the owner

Every finding below ends fixed or accepted with a reason. "Fixed" names the files, sections and todos that changed on 2026-11-18. The owner's decisions of 2026-11-18 stayed as accepted; R29 needed no new question, because the owner's AD8 answer already fixes the wording.

### 7.1 Findings R1–R39

| ID | Resolution | What changed |
| --- | --- | --- |
| R1 | fixed | `Context` moved to `@agent-speak/sdk` (`run.ts`) in SDK §3.1–§3.3; the gateway keeps `ModelContext` and names no SDK type. B2 (scope, out of scope, a no-SDK-import criterion), B11 (scope), harness §3.2 intro, ADR 0001. |
| R2 | fixed | The `SessionEntry` union moved into `@agent-speak/protocol` (`src/entries.ts`, re-exported by the harness); protocol declares gateway and SDK as types-only dependencies (harness HD13, §3.1, §3.2; ADR 0012). N26 now depends on N2, B11 and B15, and its criterion is "the emitted JS imports nothing outside the package" plus "no dependency on the harness". N2 writes the union in protocol. |
| R3 | fixed | New todo [N40](../../todos/ready/N40-code-initiated-calls.md) (M; Depends on N13, N14, B15) builds `Harness.invokeTool()`, the `code_call` entry and the code-call branch of `Approvals.resolve`. Harness §3.2 (`code_call`), §3.4 (`CodeCallResult`), §3.5 (`Harness.invokeTool`), §3.7, §4.3 table, §6.3; agent §3.6, §3.7 (AH4), §4.3 table, §6.3. A12 and A13 depend on N40, and A12's workaround task is gone. |
| R4 | fixed | `shouldStop` may return `{ stop: "no_progress" \| "hook"; reason }`, and `RunResult` gained `stopReason: "stopped"` with `stoppedBy` (SDK §3.3). B13 and B14 criteria; B11 scope; A7 maps a `stopped` result with reason `kill_switch` to the handoff; agent AD4 and §3.3. |
| R5 | fixed | `RunError` defined in SDK §3.3 with `kind: "overflow" \| "quota" \| "retryable" \| "fatal" \| "unknown_price" \| "hook"`. B11 copies `AssistantMessage.error.kind`; B14 sets `unknown_price`. |
| R6 | fixed | `turn_start.system` stores the frozen prompt (harness §3.2); N2 scope, N6 scope, N7 rebuilds `system` from it and tests a byte-for-byte match after a configuration change. SDK §1 table row §2 notes the harness persists it. |
| R7 | fixed | `TurnOptions.inputOrigin?: "user" \| "operator"` (harness §3.2) with an N6 test of both values; A11 passes `"operator"`; agent §3.7 lists it as AH14; A9's clean-planner criterion now names the operator input. |
| R8 | fixed | `RegisteredTool.approvalReuse` (harness §3.3, HD12, ADR 0019); N11 adds the field, N14 refuses sticky or grouped resolutions for `"none"` and defines grouping by canonical input hash and per-request quorum. Agent AD2: T2–T4 tools register with `"none"` (A3); A8 tests that a sticky resolution on a T3 call is refused. |
| R9 | fixed | `ResolveOptions` with `budgetUsd`, `signal` and `hostContext` (harness §3.4); HD9 says the remainder reaches the resume; N13 tests a resume that stops with `budget`; agent AD9 and A13 pass the remainder on resume. |
| R10 | fixed | `QuorumPolicy.evaluate()` typed in harness §3.4 and built in N14; the host fills `Resolution.by` only after authentication (harness §3.4, §3.7, N14); `ApproverDirectory.roles(principalId)` in agent §3.3 and AD3, tested in A8; ADR 0024 consequence. |
| R11 | fixed | `EvalRow.passed: boolean \| null` with `unscored?` (harness §3.5), tested in N36; agent §3.5 notes how an unscored `Grade` maps to a row. |
| R12 | fixed | `{ type: "warning"; code: "max_steps"; detail }` added to `AgentEvent` (SDK §3.3); B11 criterion checks it and `AGENT_EVENT_TYPES`. |
| R13 | fixed | `TriageAgentOptions.models(ref, role)` (agent §3.4); A13 scope and a `ScriptedModel` criterion. |
| R14 | fixed | SDK §3.2–§3.3 declare `ModelContent`, `ModelCaps`, `Clock`, `TracerLike` (with `SpanLike`), `DeliveryReceipt`, `HookEventBase`, `ContextEvent`, `ToolCallEvent` and the other hook events. |
| R15 | fixed | SDK §6.3 now defers to the harness plan's staged list and keeps one roadmap line; roadmap M5 and M6 rows list the new todos. |
| R16 | fixed | Agent need labels renamed AS1–AS2 and AH1–AH14 in agent §2, §3.7, §6; ADRs 0022, 0024, 0025, 0026, 0027, 0031; todos A3, A8–A14, A18, A22. |
| R17 | fixed | `ToolDefinition.redactErrors?: boolean` (SDK §3.3, §1 table row §4); B10 scope and criterion. |
| R18 | fixed | B8 and B9 strip the nulls strict lowering adds before validation, with a fixture criterion each; SDK §1 table row §4. |
| R19 | fixed | Agent §1 deferred list: batch pricing for graders and capability runs waits for a gateway batch adapter; revisit after A20. |
| R20 | fixed | `DashboardRow.guardrailFlagRate` and `sampledJudgeScore: number \| null` (agent §3.5); A22 scope and two criteria. |
| R21 | fixed | "P2" replaced with N39 in D9, D11 (text and table row), SDK §6.1, B14 and ADR 0009. |
| R22 | fixed | N38 keeps the 20 repository tasks and the live budget check; new todo [N38b](../../todos/ready/N38b-shared-triage-tasks.md) (M; Depends on N38, A17, A19) adds the 10 shared tasks, records how mini-swe-agent receives a ticket or scores them for our harness only, and commits only task ids and graders. Harness HD8, §4.7, §6.3; agent AD6, §6.2, §6.3; A19; N38's sign-off task replaced. |
| R23 | fixed | B1 links `../done/P4-plan-review.md`. The link resolves once P4 moves to `done/`; until then the link checker reports it, as intended. |
| R24 | fixed | SDK §4.4 states eleven todos (B1 → … → B15 → B15b → B18 → B19 → B20, with the B15 split); agent §4.5 states thirteen (A1 → A2 → A3 → A6 → A7 → A11 → … → A20). Harness §4.7 names the ties. |
| R25 | fixed | B15 keeps signers, hashing, the pending record and `createPendingRequest` (now M), and new todo [B15b](../../todos/done/B15b-continue-run.md) holds `continueRun`, `blockingApprovals()` and clarification. B15 keeps its id, so existing links stay valid. New todo [B19b](../../todos/done/B19b-reference-loop.md) holds the reference loop, and B19 is now M. B18, B19 and N7 depend on B15b. B8, B9 and B11 stay L. |
| R26 | fixed in part | N14, N28 and N35 now list ordered steps. Accepted for the other fifteen todos: as the finding says, their scope and criteria carry the detail, and each gains steps when it is claimed. |
| R28 | fixed | The 13 headings now end "(accepted)" or "(accepted, with …)", and all 58 links to their anchors were rewritten (57 found by the review plus this file's own AD8 link); a repository-wide search finds no old anchor. "Choice, proposed" and "provisional" under HD4, HD8, HD11, AD6 and AD8 now read "Choice" or "Agent side". "Why the owner decides" became "What the owner still supplies" or was deleted (D2, D8, HD5), and D5's argument for a required signer became an outcome line. Each plan's §2 intro, §6.2 and closing paragraph, the SDK intro and §1 non-goal, B15's risk, N19 and N38 were updated. Agent §6.2 now matches implementation plans §6, whose P4 bullets now record the answers. |
| R27 | fixed | B10 writes its own strict-schema fixtures from the Anthropic and OpenAI references; D7's provisional check says so. |
| R29 | fixed | The owner's AD8 answer settles the wording: synthetic and de-identified tickets may be committed once they pass A19's checklist, and raw tickets never. Agent AD8 "Eval data" bullet, §6.1, A19 (tasks and criteria), N38b and an ADR 0027 consequence line now say this. |
| R30 | fixed | ADR 0005 gained a dated outcome line (default stays ephemeral; the harness passes `hmacSigner()`), appended rather than rewritten; ADR 0015 records the same outcome. |
| R31 | fixed | ADR 0009's consequences record HD9's session cap, the pre-checked summary call and N39; harness HD9's ADR cell and §6.2 close the question. |
| R32 | fixed | The ADR index copies every title and status verbatim from its record. HD15's ADR cell points at 0020. HD4, N19 and ADR 0020 (an appended consequence) say a change after N19 is a superseding ADR. |
| R33 | fixed | The twelve plain-Proposed ADRs (0001, 0003, 0004, 0006, 0009, 0010, 0012, 0016, 0017, 0019, 0029, 0030) are now "Accepted (P4 review, 2026-11-18)", after R1, R2 and R31 changed 0001, 0012 and 0009. The provisional ones stay Proposed for their named todos. |
| R34 | fixed | N16 spawns `srt` with `spawnEnv()` and tests it; N37 has a criterion that the bridge and mini-swe-agent get `spawnEnv()`, the proxy URL and a dummy key. |
| R35 | fixed | N34's matrix keeps `fakeSandbox()`; the `sandbox: "none"` arm asserts only the tier stamp and calls no host tool. |
| R36 | fixed | The agent introduction splits after the package sentence, and the thesis is two sentences (30 and 23 words). |
| R37 | fixed | Harness §3.6 groups the needs by upstream todo; agent §3.7 leads with the two needs that had no workaround and groups the rest by plan and purpose. |
| R38 | fixed | Agent plan: "role" for the reader, planner and drafter; "context" only for the SDK's `Context`; "trusted run context" for `TrustedContext`; "session taint" (`SessionTaint`, `sessionTaint()`) for the taint; `RoleSettings` and the `./roles` subpath. Applied to AD1, AD5, AD9 (heading), §3–§6, todos A1–A4, A7, A9–A13, and ADRs 0022, 0025, 0026 (title) and 0030. Accepted ADR 0028's title keeps "contexts", because an accepted record is not rewritten. |
| R39 | fixed | Every stage heading (§4.1–§4.7) and every §6.1 and §6.2 heading in the three plans now states a conclusion; links to the old anchors were rewritten. |

### 7.2 Needs (§4)

All 24 upstream changes landed with the exact types and criteria §4 gives. Harness needs 1, 2, 5 and 8 went to SDK §3.3 and B13; need 3 to `Model.caps` (SDK §3.2, B4, B5); need 4 to `RunError`, B6 and B15b; needs 6 and 7 to SDK §3.3 and B15b; need 9 to `projectCallCost()` (SDK §3.3, D9, B14); need 10 to B17 and N31, with the constant deleted from harness §3.5; need 11 to `CAPABILITIES` (SDK §3.3, B20); need 12 to `DeliveryReceipt` (SDK §3.3, B16). Agent AS1 went to B15, AS2 to B11, AH1 and AH2 to N6 and N11 (with `createHarness<H>()`), AH3 to N5, AH4 to N40, AH5 and AH9 to N12 and N2, AH8 and AH10 to N2 and N11, AH12 to N31 and AH13 to N36.

The three drops left the needs lists with a one-line reason each: harness need 13 (the client-tool pause kind; harness §1 defers that pattern, recorded in SDK §1 and §6.2), AH6 (`policyStore` removed from harness §3.4; R4 is a `PermissionHook` reading the product's store) and AH7 (the agent shadows at its helpdesk boundary; harness §3.7 R5 says so). The covered need, AH11, is marked with its new N12 test.

### 7.3 Prose fixes (§5)

All twelve line-level fixes in §5.1–§5.3 were applied, as were the three cut lists (the stale owner paragraphs, the "SDK side, unchanged" restatements, the §6.2 owner and P3 bullets, and the agent §3.6 closing paragraph, now one sentence). §5.4 gives the new scores.

[ip3]: ../implementation-plans.md#3-the-review-p4
[ip6]: ../implementation-plans.md#6-open-questions
[sdk]: ../build-sdk.md
[sdk32]: ../build-sdk.md#32-gateway-api
[sdk33]: ../build-sdk.md#33-sdk-api
[sdk44]: ../build-sdk.md#44-stage-4-ships-telemetry-the-testing-exports-the-capstone-and-the-docs-checks
[sdk63]: ../build-sdk.md#63-where-round-b-slots-into-the-roadmap
[har]: ../build-harness.md
[har32]: ../build-harness.md#32-session-log-api
[har34]: ../build-harness.md#34-permission-approval-and-sandbox-apis
[har35]: ../build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis
[har36]: ../build-harness.md#36-needs-from-the-sdk-plan
[har63]: ../build-harness.md#64-where-round-n-slots-into-the-roadmap
[har-hd9]: ../build-harness.md#hd9-sdk-d9s-per-call-check-plus-a-session-cap-and-a-pre-checked-summary-call-with-sdk-d9
[har-hd12]: ../build-harness.md#hd12-three-middle-ground-modes-and-no-classifier-allow-outside-the-host-callback
[agt]: ../build-agent.md
[agt34]: ../build-agent.md#34-roles-gates-and-the-workflow
[agt35]: ../build-agent.md#35-evals-and-rollout
[agt37]: ../build-agent.md#37-needs-from-the-sdk-and-harness-plans
[agt62]: ../build-agent.md#62-no-question-is-open-the-owners-remaining-inputs-are-scheduled-in-todos
[agt-ad8]: ../build-agent.md#ad8-code-appends-the-ai-label-spans-hash-identifiers-and-later-stages-need-a-retention-period-accepted-with-hd11
