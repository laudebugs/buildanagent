# Fact-check log: rewind versus rollback

The report's thesis holds: every rewind mechanism we checked restores only state its framework owns, and none of our pinned SDKs or plans rolls back external data. Of the 84 rows below, 20 needed a correction, and none of them changes a conclusion. The most consequential is LangGraph JS durability: the docs mirror says `sync` can lose recent checkpoints mid-run, but the pinned 1.6.0 source awaits every checkpoint write at each super-step. Two corrections sharpen the plan analysis, because the triage reply is a code-initiated call that N7's crash rule does not cover, and N13 and B15b promise "once", not "exactly once". Seven fix overclaims or details, such as the claim that every vendor states the boundary and that adk-js never mentions rewind. Five fix citations, one fixes a verification marker, and four label as our synthesis what the draft cited to Azure, Stripe and AIP-194. Beyond the rows, the status header now marks the ideas borrowed from the unreviewed sibling reports, and every number in the recommendation, as our proposals, and every relative link now resolves.

- **Date:** 2026-11-18
- **Document checked:** [rewind-vs-rollback.md](rewind-vs-rollback.md), with its notes [agent-rewind-mechanisms.md](notes/agent-rewind-mechanisms.md) and [rollback-in-our-sdks-and-plans.md](notes/rollback-in-our-sdks-and-plans.md)
- **Method:** for every number, version, date, status and behavioural claim, I opened the cited note and then the primary source. Docs claims were read from the LangChain mirror at commit `9d9747d` (`docs/reference/langchain/source/`), the Pi mirror at tag `v1.5.2`, the ADK docs mirror at `ff7a5f5`, and code.claude.com (checkpointing and Agent SDK file-checkpointing pages). Source claims were read from adk-python at tag `v2.14.1` (raw.githubusercontent.com), a shallow clone of adk-js `main` at `0fcab55` (2026-11-17), and the installed packages in the main checkout's `verify/<sdk>/node_modules` (as of November 2026: `@langchain/langgraph` 1.6.0, `langchain` 1.6.1, Pi 1.5.2, `@anthropic-ai/claude-agent-sdk` 0.3.327, `@google/adk` 2.5.0, `@openai/agents-core` 0.21.0, `ai` 7.0.162, `agents` 0.33.0, `@cloudflare/think` 0.23.0, `@github/copilot-sdk` 1.0.31). Plan claims were read from `docs/plans/` and `docs/todos/ready/` at commit `13b28a9`. Web pages were fetched with `curl` on 2026-11-18. Nothing ran against a real model, and fetched pages were treated as data.
- **Abbreviations:** `LC` = `docs/reference/langchain/source/src/oss/langgraph`; `CSDK` = `@anthropic-ai/claude-agent-sdk`; `CP` = [Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing.md); `FCP` = [Agent SDK file checkpointing](https://code.claude.com/docs/en/agent-sdk/file-checkpointing.md); `ADKR` = the ADK rewind page in the docs mirror (`adk-docs/docs/sessions/session/rewind.md`); `ADKP` = adk-python `src/google/adk` at `v2.14.1`; `CPL` = `@github/copilot-sdk/dist`.
- **Legend:** ✅ confirmed as written · ✏️ corrected in the report (the note it came from keeps the old text) · ⚠️ confirmed only in part, or an absence that a search cannot prove

## Versions and LangGraph

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 1 | `@langchain/langgraph` 1.6.0 with `langchain` 1.6.1 (and `@langchain/core` 1.3.4) | Status; table | ✅ | installed `package.json` files under `verify/langchain/node_modules` |
| 2 | Python `langgraph` 1.2.22 is the latest release, uploaded 2026-11-14 | Status; table; note | ✅ | [PyPI JSON](https://pypi.org/pypi/langgraph/json): 1.2.22 at 2026-11-14T01:43Z |
| 3 | The docs mirror is commit `9d9747d` of `main`, with no tag matching the npm pins | Status; LangGraph ¶2 | ✅ | `docs/reference/langchain/source/_manifest.json` ("No docs tag matches the pinned npm versions") |
| 4 | A checkpoint is "a snapshot of the graph state saved at each super-step"; resume only from a super-step boundary | LangGraph ¶1 | ✅ | `LC/checkpointers.mdx:91, 95` |
| 5 | Replay re-runs later nodes "including any LLM calls, API requests, and interrupts"; it "doesn't just read from cache" | LangGraph ¶1; "Rewind cannot…" ¶1 | ✅ | `LC/use-time-travel.mdx:14, 22` |
| 6 | `update_state` "does **not** roll back a thread" and creates a branching checkpoint | LangGraph ¶1 | ✅ | `LC/use-time-travel.mdx:131` |
| 7 | On resume "the runtime restarts the entire node from the beginning", so a pre-interrupt record update can create duplicates | LangGraph ¶1 | ✅ | `LC/interrupts.mdx:1023, 1369` |
| 8 | Retries give "**at-least-once** semantics"; failed-attempt graph writes are discarded; "payments, emails, external writes" are outside the boundary | LangGraph ¶2; table | ✅ | `LC/fault-tolerance.mdx:279, 286` |
| 9 | The idempotency key must be durable before the side effect; "Treat missing local state as unknown" | LangGraph ¶2; saga ¶3 | ✅ | `LC/fault-tolerance.mdx:292, 375` |
| 10 | In JS, even `sync` durability "can still lose recent checkpoints" mid-run | LangGraph ¶2 | ✏️ | The docs say so (`LC/checkpointers.mdx:670`), but the pinned 1.6.0 source awaits all pending checkpointer writes inside `tick()` after each super-step under `sync` (`@langchain/langgraph/dist/pregel/loop.js:661`, `_awaitCheckpointerPromises` at `:321`). Now says the warning tracks `main` and does not match our pin |

## Pi

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 11 | Pi 1.5.2; docs from tag `v1.5.2`, commit `b4afddd` | Status; table | ✅ | installed `package.json`; `docs/reference/pi/source/_manifest.json` |
| 12 | "returning to an earlier point does not erase the branch you leave"; `/tree`, `/fork`, `/clone` as described; the model receives "the active branch" | Pi ¶ | ✅ | `docs/reference/pi/source/coding-agent/sessions.md:38-54` |
| 13 | Example 05 verified that `branch(id)` moves the leaf and both paths stay in `getEntries()` | Pi ¶ | ✅ | [Pi guide](../../reference/pi/guide.md) line 122 **[verified: 05]** |
| 14 | Pi core restores no files, a conclusion resting on the docs because "we did not read the 1.5.2 source" | Pi ¶ | ✏️ | `pi-coding-agent/dist/core/agent-session.js:3363`: `navigateTree()` calls only `sessionManager` methods (`getLeafId`, `getEntry`, `branchWithSummary`, `appendLabelChange`, `resetLeaf`, `branch`) and no file API. Now cites the source as confirmation |
| 15 | `git-checkpoint.ts` runs `git stash create` on `turn_start`, asks "Restore code state?" on `session_before_fork`, does nothing without a UI, and does not hook `/tree` | Pi ¶ | ✅ | `docs/reference/pi/source/examples/extensions/git-checkpoint.ts` |

## Claude Code and the Claude Agent SDK

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 16 | Claude Code "automatically tracks Claude's file edits"; one checkpoint per prompt that starts a turn; `/rewind`, `/undo` or Esc twice | Claude ¶ | ✅ | `CP` lines 9, 19, 26 |
| 17 | It "keeps the 100 most recent checkpoints, which expire with the session after about 30 days" | Claude ¶ | ✏️ | `CP` lines 20, 22: it keeps *file snapshots* for the 100 most recent checkpoints, and a retention sweep deletes them "about 30 days after the session last saved one". Now says so |
| 18 | Bash-only file changes are untracked ("use version control"); subagent edits usually not captured; "quick, session-level recovery" | Claude ¶; table | ✅ | `CP` lines 76, 82-85, 105 |
| 19 | The SDK tracks Write, Edit and NotebookEdit; rewind "deletes the files it created and restores the files it modified", "does not rewind the conversation itself", skips directories and "Remote or network files" | Claude ¶; table | ✅ | `FCP` lines 17, 21, 23, 621-622 |
| 20 | `enableFileCheckpointing` and `Query.rewindFiles(userMessageId, { dryRun })` | Claude ¶; SDK table | ✅ | `CSDK/sdk.d.ts:1831, 3466-3475` |
| 21 | `resumeSessionAt` truncates at a message UUID; `forkSession` copies the transcript; "Forked sessions start without undo history" | Claude ¶; SDK table | ✅ | `CSDK/sdk.d.ts:2272-2278, 891-905` |
| 22 | Agent SDK 0.3.327 | Status; table | ✅ | installed `package.json` |
| 23 | Permission denials carry `message` and `interrupt` | SDK table | ✅ | `CSDK/sdk.d.ts:2715, 2728` |

## Google ADK

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 24 | Python `google-adk` 2.14.1, uploaded 2026-11-12; TS `@google/adk` 2.5.0 is npm `latest`, published 2026-11-12 | Status; table | ✅ | [PyPI JSON](https://pypi.org/pypi/google-adk/json); [npm registry](https://registry.npmjs.org/@google/adk) (2026-11-12T19:53Z) |
| 25 | Rewind since Python v1.17.0 and Kotlin v0.3.0 | ADK ¶1 | ✅ | `ADKR` line 4 (PyPI dates 1.17.0 to 2025-10-22) |
| 26 | `rewind_async(user_id, session_id, rewind_before_invocation_id)` undoes an invocation and everything after it | ADK ¶1 | ✅ | `ADKR` lines 14-52; `ADKP/runners.py:1389-1412` |
| 27 | "All requests, including rewound requests, are preserved in the log"; the model "effectively forgets" | ADK ¶1; "Rewind cannot…" ¶2 | ✅ | `ADKR` lines 74-79 |
| 28 | Only session-scoped keys are kept; `app:`, `user:` and `temp:` are dropped | ADK ¶1 | ✅ | `ADKP/sessions/_rewind_utils.py:40-50` |
| 29 | Table: "App and user state are not restored" | Mechanism table | ✏️ | Same lines: `temp:` keys are dropped too, and `user:` artifacts are skipped (`:131-132`). Now "App, user and temp state" |
| 30 | Later keys set to `None`, new artifacts get a "rewind tombstone", changed artifacts saved as a new version, then a user-authored event | ADK ¶1 | ✅ | `ADKP/sessions/_rewind_utils.py:68-98, 131-165, 224` |
| 31 | `_apply_rewinds` is the single source of truth for live events, so rewound content cannot "leak back into prompts through a compaction summary" | ADK ¶1 | ✅ | `ADKP/events/_rewind_events.py:35-38` |
| 32 | Rewind "does not manage external dependencies" ("your responsibility"); updates are "not performed in a single atomic transaction" | ADK ¶1; table | ✅ | `ADKR` lines 89-96 |
| 33 | TS 2.5.0 has no rewind: neither its types, its ESM build nor adk-js `main` mention the word | ADK ¶2 | ✏️ | `verify/google-adk/node_modules/@google/adk/dist`: zero files mention "rewind" (confirmed). adk-js `main` at `0fcab55` has no rewind method, but `integrations/src/bigquery_analytics/event_row.ts:321` reads `rewindBeforeInvocationId`. Now says so |
| 34 | Our gap list records session rewind as missing from the TS port | ADK ¶2 | ✅ | [typescript-gaps.md](../../comparison/typescript-gaps.md) line 27 |

## Boundary, Copilot and the SDK table

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 35 | "Each vendor says, in its own words, that payments, emails and external writes sit outside that boundary" | Intro ¶1 | ✏️ | Only LangGraph names payments and emails (row 8). ADK says "external dependencies" (row 32), and Claude Code says Bash-only and remote files (rows 18-19). Pi's docs say nothing about external effects (row 12). Now names the three vendors and says Pi's docs describe only session-file operations |
| 36 | A compensating transaction "does not necessarily return the database to the state that existed" | "Rewind cannot…" ¶1 | ✅ | [Garcia-Molina and Salem, 1987](https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf), p. 2 |
| 37 | Copilot 1.0.31's experimental history `rewind` is "Not crash-atomic"; outcomes include `rollback-incomplete`; a skip reason reads "The file changed after Copilot's last captured write" | "Rewind cannot…" ¶2; SDK table | ✅ | `CPL/generated/rpc.d.ts:3179, 3242, 45599-45600` (`@experimental` on `history`), `45632`; `CPL/session.d.ts:106` (`session.rpc`) |
| 38 | No framework ties compensation or sagas to rewind, as of November 2026 | "Rewind cannot…" ¶3 | ⚠️ | An absence: none of the pages and `.d.ts` files read for this report describes one. A search cannot prove it for frameworks outside our eight SDKs |
| 39 | All eight SDKs rewind or fork the conversation; two (Claude, Copilot) restore local files | Intro ¶2; SDK table | ✅ | rows 20-21, 37 and the SDK table; Copilot's file restore is [d.ts] only (`CPL/types.d.ts:2523-2528`) |
| 40 | Pi row: `branch()`, `branchWithSummary()`, `fork()` all [verified] | SDK table | ✏️ | Only `branch()` is verified (row 13). `branchWithSummary()` (`pi-coding-agent/dist/core/session-manager.d.ts:366`) and `fork()` (`dist/core/extensions/types.d.ts`) are declaration-only. Now marked [d.ts] |
| 41 | Pi's `block: true` becomes an error result | SDK table | ✅ | `pi-agent-core/dist/types.d.ts:41` ("The loop emits an error tool result instead") |
| 42 | OpenAI `Session.popItem()`; `RunState` resumes a paused run | SDK table | ✅ | `agents-core/dist/memory/session.d.ts:72-75`; [feature table](../../comparison/feature-table.md) line 52 |
| 43 | OpenAI `operationId` "remains stable when this transaction is retried"; a repeat "must succeed without applying the transaction again"; history only | "Two SDK details…" | ✅ | `agents-core/dist/memory/session.d.ts:110-121` |
| 44 | OpenAI `reject({ message })` and `errorFunction` | SDK table | ✅ | `agents-core/dist/runState.d.ts:20896-20905`; `agents-core/dist/tool.d.ts:242` |
| 45 | Vercel `regenerate`; `tool-error` and `execution-denied` [verified] | SDK table | ✅ | `ai/dist/index.d.ts:6469-6472`; [Vercel guide](../../reference/vercel-ai-sdk/guide.md) line 123 **[verified: 03]** |
| 46 | LangChain `ToolMessage.status: "error"` | SDK table | ✅ | `@langchain/core/dist/messages/tool.d.ts:14` |
| 47 | Cloudflare Think `regenerate()` makes a new branch; `sessions.fork` and `operationId` on submit [d.ts]; schedule `idempotent` | SDK table | ✅ | `agents/dist/harness/think/index.d.ts:633-642`; `agents/dist/harness-B6B9S3rb.d.ts:18, 96`; `agents/dist/scheduler-BCLESHSC.d.ts:73-77` |
| 48 | ADK TS: `{ error }`; "This tool call is rejected." [verified] | SDK table | ✅ | [ADK guide](../../reference/google-adk/guide.md) line 137 |
| 49 | Copilot `ToolResultType` has five values and no `compensated` or `partial` | SDK table; "Two SDK details…" | ✅ | `CPL/types.d.ts:526` |

## Our plans

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 50 | `Session` offers `checkout`, `fork`, `revert` ("a new immutable file; moves the pointer"), `playback()` ("no model or tool calls"), `rerunFrom()` ("branches, then calls the model again"), cited as `build-harness.md §3` | "Our plans repeat…" | ✏️ | Quotes confirmed in [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api) lines 305-316. The citation now names §3.2 and links its anchor |
| 51 | `SessionStore.append` is "idempotent by id" with `expectedLastId`; no rollback, compensation or undo entry | "Our plans repeat…" | ✅ | build-harness.md §3.2, lines 257-294 |
| 52 | `ToolResult` has one `isError` flag; `CodeCallResult` is `done \| denied \| awaiting_approval` | "Our plans repeat…" | ✅ | [build-sdk.md §3.3](../../plans/build-sdk.md#33-sdk-api) lines 332-336; [build-harness.md §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis) lines 439-441 |
| 53 | `Helpdesk` writes return `WriteReceipt { id, shadow, at }`; no idempotency key; no inverse methods | "Our plans repeat…" | ✅ | [build-agent.md §3.2](../../plans/build-agent.md#32-trusted-run-context-helpdesk-and-tool-contracts) lines 305-319 |
| 54 | T1 "undoable"; T2 "reversible but costs people's attention" | "Our plans repeat…" | ✅ | [agent guide §5](../../guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg) lines 116-117 |
| 55 | The harness guide names playback and re-run as separate modes because LangGraph re-executes | "Our plans repeat…" | ✅ | [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries) line 49 |
| 56 | The plan review raised no finding on rollback, undo, compensation or idempotency | "Our plans repeat…" | ✅ | [plan-review.md](../../plans/reviews/plan-review.md): a search for those words finds only "duplicate" in an editorial cut list (line 196) |
| 57 | "The 'exactly once' claims in N13, N40, B15b and the A15 capstone" | "Three risks…" | ✏️ | N40:55 and A15:43 say "exactly once"; N13:48 and B15b:48 say "runs once". Now "runs once" and "exactly once" |
| 58 | A crash after the helpdesk accepts a reply but before the `tool_result` is appended makes N7 write an "aborted error result" | "Three risks…" | ✏️ | N7:29 covers "open tool calls" in a turn. The reply is a code-initiated call ([build-agent.md](../../plans/build-agent.md) line 78, AD1), and no todo states a crash rule for a `code_call` with no result. Now says both, and that either way the log cannot tell whether the reply went out |
| 59 | `revert` is log-only and leaves the original file byte-identical | "Three risks…" | ✅ | [N5](../../todos/ready/N5-head-fork-revert.md) line 44 |
| 60 | A13 maps every stop to a handoff "without retry" | "Three risks…" | ✅ | [A13](../../todos/ready/A13-triage-workflow.md) line 30 |
| 61 | The helpdesk has not been chosen (A24) | "Three risks…"; conclusion | ✅ | [AD14](../../plans/build-agent.md#ad14-one-helpdesk-interface-is-the-agents-only-way-out-with-a-fake-for-tests-a-shadow-wrapper-for-rollout-and-a-real-adapter-the-owner-names-accepted) line 239; [A24](../../todos/ready/A24-real-helpdesk-adapter.md) line 27 |

## The recommendation

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 62 | The canary auto-applies `category` and `priority`, cited as agent guide §8 | Undo windows ¶ | ✏️ | The stage list is in [agent guide §7](../../guides/agent.md#7-ship-in-four-stages-behind-a-graded-kill-switch-hand-off-to-people-by-design-and-turn-each-incident-into-a-regression-task), line 195. Citation corrected |
| 63 | Nielsen: confirm "actions with serious consequences"; "go to great lengths to provide undo" | Undo windows ¶ | ✅ | [NN/g confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/) |
| 64 | Snapshot undo is unsafe in mixed human and agent UIs, cited to `research_notes/…/state-library-undo.md` | Undo windows ¶ | ✏️ | That path is gitignored, so the link resolved nowhere. The finding is in the sibling U4 report (`docs/research/agent-ui/undo-agent-edits.md` on branch `docs/undo-agent-edits`, line 36: "restoring a snapshot reverts everything since then"), which is unreviewed. Now cites U4 as under review and states guarded inverse writes as our proposal |
| 65 | A 24-hour undo window, matching the T3 and T4 quorum windows in AD3 | Undo windows ¶ | ✅ | [AD3](../../plans/build-agent.md#ad3-a-role-based-quorum-per-tier-and-amount-band-bound-to-the-host-signed-pause-and-expiring-on-age-or-policy-change-accepted-with-sdk-d5-and-hd5) lines 115-117 (T3 and T4: 24 hours). The window itself is labelled our judgement |
| 66 | A queue change that triggers automations should move to T2 | Undo windows ¶ | ⚠️ | A recommendation, now labelled one. No plan discusses it; `getTicket` returns a `queue` (build-agent.md line 307), but `TriageFields` is not spelled out |
| 67 | Exact-text approval of replies is already planned for T3 | Replies ¶ | ✅ | [AD2](../../plans/build-agent.md#ad2-the-tier-table-is-code-t5-is-never-registered-and-t4-stays-denied-until-the-owner-sets-the-caps-accepted) line 93 |
| 68 | Gmail's Undo Send "works because the send is actually delayed by 5 to 30 seconds" | Replies ¶ | ✏️ | [Gmail help](https://support.google.com/mail/answer/2819488?hl=en) offers a "Send cancellation period of 5, 10, 20, or 30 seconds" but does not say the send is delayed. Now quotes the page and marks the hold as our reading |
| 69 | In v1, T4 is denied while `caps` is `null`, cited to A5 | Saga ¶1 | ✏️ | The rule is AD2's (build-agent.md lines 84-95); A5 only links to it. Citation now names AD2 |
| 70 | The refund is the pivot; Microsoft calls a pivot "the point of no return" | Saga ¶1 | ✅ | [Azure saga pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga): "Pivot transactions serve as the point of no return" |
| 71 | An API caller cannot rely on reversing a card refund | Saga ¶1 | ✅ | [Stripe refunds](https://docs.stripe.com/refunds): "Only Dashboard cancellations are currently supported for card refunds" |
| 72 | Replying before the refund is the order to forbid, cited to the Azure saga page | Saga ¶1 | ✏️ | The Azure page defines pivots and compensation but says nothing about replies or email. The ordering is the sibling U6 report's synthesis, and the report now labels it so |
| 73 | One approval over the whole plan, before the first step | Saga ¶2 | ✏️ | Presented as a design rule with no label. It is U6's synthesis ("No vendor source discusses approval relative to a pivot"). Now labelled as our synthesis |
| 74 | Microsoft calls the reread countermeasure "reread values" | Saga ¶2 | ✅ | Azure saga pattern: "Reread values: Confirm that data remains unchanged before you make updates" |
| 75 | A regenerated model turn emits a fresh call id, cited to Stripe's error-handling page | Saga ¶3 | ✏️ | Stripe supports only the key half: "A new key can start a second operation" ([Stripe advanced error handling](https://docs.stripe.com/error-low-level)). The call-id claim is the sibling U5 report's inference. Now quotes Stripe and labels the rest |
| 76 | A5's "no duplicate refund" rule is a business check | Saga ¶3 | ✅ | [A5](../../todos/ready/A5-outbound-money-tools.md) line 27 |
| 77 | Each component should be removable and "earn its place" | v1 ¶ | ✏️ | [AGENTS.md](../../../AGENTS.md) line 63 says "Each component should be removable so it can be ablated as models improve"; "earn its place" is not there. Now quotes the rule |
| 78 | D5 already signs the canonical `inputHash` | Rollback ¶2 | ✅ | [build-sdk.md, D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5); AD3 (build-agent.md line 108) lists the signed fields |
| 79 | The `code_call` entry is appended before the helpdesk call | Rollback ¶2 | ✅ | build-harness.md §3.4 line 443: `invokeTool()` "writes code_call, runs decide()", then the result |
| 80 | The outcome vocabulary comes from "distributed-API practice", cited to the AWS Builders' Library and AIP-194 | Rollback ¶3 | ✏️ | AIP-194 covers retry configuration and defines no outcomes; AWS covers client request identifiers. The four kinds are the sibling U5 report's proposal. Now says so and drops AIP-194 |
| 81 | `invokeTool()` writes `code_call`, `permission_decision` and `tool_result` | Rollback ¶4 | ✅ | [N40](../../todos/ready/N40-code-initiated-calls.md) line 52 |
| 82 | `product_record` data sits outside HD11's stable surface | Rollback ¶4 | ✅ | build-harness.md §3.2, entry union comment |
| 83 | The repo's rule that errors say what not to do next | Rollback ¶5 | ✅ | [agent guide §3](../../guides/agent.md#3-tools-deserve-more-design-effort-than-the-prompt-few-workflow-shaped-tools-identity-from-trusted-context-and-errors-that-say-what-to-do-next) line 73 |
| 84 | Pi's `branchWithSummary()` gives the summary shape, cited to the Pi guide | Rollback ¶6 | ✏️ | The Pi guide never mentions it. Now cites `pi-coding-agent/dist/core/session-manager.d.ts:366` |

Two further fixes are not claims. Every relative link in the report pointed one level too high (`../docs/…` from `docs/research/reversible-actions/`); all now resolve. The rollback note's repo links pointed at the repo root from `notes/`; they now resolve, and links into gitignored folders (`node_modules`, the Claude docs mirror) became code paths.

## Corrections made

Each correction is in the report; the notes keep their original findings, and their headers point here.

1. **LangGraph JS durability (row 10).** "in JS even `sync` can lose recent checkpoints mid-run. That last detail comes from a `main`-branch docs mirror with no tag matching JS 1.6.0, so it may postdate our pin" became "For JS, the docs mirror warns that even `sync` 'can still lose recent checkpoints' mid-run. That page tracks `main`, however, and under `sync` the pinned 1.6.0 source awaits every pending checkpointer write at the end of each super-step … For our pin, then, JS `sync` matches Python's."
2. **Pi file restore (row 14).** "No Pi sentence says 'files are not restored' in those words, and we did not read the 1.5.2 source to confirm it" became "The 1.5.2 source confirms that Pi core restores no files. `AgentSession.navigateTree()`, which serves `/tree`, calls only session-manager methods … and touches no file."
3. **Claude Code retention (row 17).** "It keeps the 100 most recent checkpoints, which expire with the session after about 30 days by default" became "Claude Code keeps file snapshots for the 100 most recent checkpoints in a session, and a retention sweep deletes them by default about 30 days after the session last saved one."
4. **ADK scopes (row 29).** "App and user state are not restored" became "App, user and temp state are not restored".
5. **adk-js `main` (row 33).** "neither its types, its ESM build nor adk-js `main` mention the word" became "No file in the `dist` folder of `@google/adk` 2.5.0 mentions the word … adk-js `main` (commit `0fcab55`, 2026-11-17) has no rewind method either. Its only mention is a BigQuery analytics field that copies `rewindBeforeInvocationId`."
6. **Vendor boundary statements (row 35).** "Each vendor says, in its own words, that payments, emails and external writes sit outside that boundary and belong to the developer" became "LangGraph, ADK and Claude Code each say in their own words that external effects sit outside that boundary, and Pi's docs describe only session-file operations."
7. **Pi verification markers (row 40).** "`branch()`, `branchWithSummary()`, `fork()` [verified]" became "`branch()` [verified]; `branchWithSummary()`, `fork()` [d.ts]".
8. **Harness section (row 50).** "build-harness.md §3" became "build-harness.md §3.2", with an anchor.
9. **"Once" versus "exactly once" (row 57).** "the 'exactly once' claims in N13, N40, B15b and the A15 capstone are tested only on a clean resume" became "the plans test 'runs once' and 'exactly once' only on a clean resume, in N13, N40, B15b and the A15 capstone".
10. **Crash rule scope (row 58).** "If the process crashes after the helpdesk accepts a reply but before the `tool_result` is appended, N7 writes an 'aborted error result'" became "The reply is a code-initiated call, so a crash … leaves a `code_call` entry with no result. N7's crash rule covers only open tool calls in a turn, which get an 'aborted error result'. Either way, the log cannot say whether the reply went out."
11. **Canary citation (row 62).** "agent guide §8" became "agent guide §7".
12. **Snapshot undo citation (row 64).** The link to the gitignored `research_notes/Undo for agent edits in UIs/state-library-undo.md` became a reference to the sibling U4 report, marked as under review. Update: U4, U5 and U6 have since merged ([#4](https://github.com/laudebugs/agent-speak/pull/4), [#6](https://github.com/laudebugs/agent-speak/pull/6), [#7](https://github.com/laudebugs/agent-speak/pull/7)), so the report now links all three directly.
13. **Gmail (row 68).** "Undo Send works because the send is actually delayed by 5 to 30 seconds" became "Undo Send lets a user retract a sent message within a 'Send cancellation period of 5, 10, 20, or 30 seconds' … The page does not say how retraction works, so our reading is that Gmail holds the message for that period."
14. **T4 citation (row 69).** The citation for "T4 is denied while `caps` is `null`" moved from A5 to AD2.
15. **Reply-before-refund ordering (row 72).** The Azure citation was removed from that sentence, which now opens "In our synthesis".
16. **Plan-wide approval (row 73).** The approval paragraph now ends "Both rules are our synthesis, following U6; no vendor source discusses approval relative to a pivot."
17. **Regenerated call ids (row 75).** "because a re-run or a regenerated model turn emits a fresh call id … ([Stripe advanced error handling])" became a Stripe quotation ("A new key can start a second operation") followed by the call-id point, marked "our inference, following U5".
18. **AGENTS.md rule (row 77).** "the repo's rule that each component be removable and earn its place" became a quotation of the actual rule.
19. **Outcome vocabulary (row 80).** "The outcome vocabulary comes from our earlier server-rollback research and distributed-API practice, not from any agent vendor ([AWS]; [AIP-194])" became "The outcome kinds are our proposal from the sibling U5 report …, not a vendor's vocabulary. Their basis is distributed-API practice such as client request identifiers ([AWS Builders' Library])."
20. **`branchWithSummary()` citation (row 84).** The citation moved from the Pi guide to `session-manager.d.ts:366`.
21. **Borrowed terms and numbers (status header).** The status header now lists, as recommendation rather than finding, the outcome kinds (U5), the refund as saga pivot and one approval per plan (U6), guarded inverse writes (U4), and every specific number in the recommendation, including the 24-hour window.
22. **Links.** Every relative link was rewritten from `docs/research/reversible-actions/`, and all now resolve.

None of these corrections changes the report's conclusions. The LangGraph durability fix removes one example of local state being lost, but the report's point was that durability never reaches external systems, which still holds. The crash-rule fix strengthens the case for an `unknown` outcome, because the gap it describes now has no rule at all rather than a wrong one.
