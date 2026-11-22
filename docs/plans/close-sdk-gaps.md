# Plan: close seven SDK gaps with a standalone safety package first, then fold it into our SDK and harness

- **Status:** Approved; being built (2026-11-19). The owner accepted SG1–SG5 on 2026-11-18 and 2026-11-19 and approved the reviewed todos. The owner first put the plan on hold ("Approve plan, don't start yet"), then lifted the hold on 2026-11-19 for all of Round E ("Lift hold on all of E"), so Round E is now built beside the SDK and harness.
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18): "Let's make detailed todos for these gaps. And review all them before beginning work on them."
- **Builds on:** the [server rollback report][sr], the [sagas report][sg], the [rewind versus rollback report][rr], the [portable agents report][pa], the [agent-building platforms report][abp] and the [feature table][ft]
- **Decision records:** [ADR 0043](../decisions/0043-standalone-safety-core.md) (accepted, owner, 2026-11-18)
- **Todos:** Round E ("effects") on the [todo board](../todos/README.md); §4 lists them, and §3 lists the existing todos this plan amends.

The SDKs we studied already run a loop, call tools, stream and keep sessions, so a second loop is not where our stack adds value. Strands, for example, "shares the SDK-level shapes we chose" but misses "our safety floor" ([Strands report][strands]). The gaps sit where an agent changes the world: what the model is told after a write fails, whether a crash can send an email twice, who approved what, and what a run may spend. The owner asked for detailed todos for seven such gaps, reviewed before any work starts. This plan maps each gap to the todos that already cover it and adds Round E for the rest. **Round E builds the guarantees first as a small package on the verified third-party SDKs, Cloudflare `agents` 0.33.0 and `ai` 7.0.162, and then folds the same code into our own SDK and harness. The guarantees can therefore ship before Round B finishes, and each exists in only one implementation.**

## 1. Goal and non-goals

**Goal.** At the end of Round E, `@buildanagent/agent-safety` passes `pnpm test` offline and gives an agent on `agents` 0.33.0 or `ai` 7.0.162 one guarantee per gap:

- typed write outcomes;
- crash-safe write identity;
- signed, fail-closed approvals that re-check policy on resume;
- one approval for a whole plan with an irreversible step;
- a spend cap checked before each model call;
- durable stores that pass one conformance suite on local Node, Cloudflare, AWS and Vercel;
- a guarantee that model calls carry only the user's own key.

The amended todos in §3 make our SDK and harness use the same package once Round B and Round N reach them.

**Non-goals.**

- **A compensation engine for specific tools.** Each agent writes its own `compensate` functions; Round E supplies the log, the order rule and the outcome.
- **A durable workflow engine.** The sagas report found that the harness, not the engine, owns order, approval and outcome, and that Temporal or Durable Task stays a replaceable layer ([sagas report][sg-harness]).
- **New wire formats.** Outcomes travel in the tool result body plus the provider's error flag ([server rollback report][sr-out]).
- **A second price catalog or a second signer.** Both stay single implementations ([SG1](#sg1-the-safety-core-is-a-standalone-package-that-our-sdk-later-imports-accepted-adr-0043)).

## 2. Decisions

| ID | Decision | Status | ADR |
| --- | --- | --- | --- |
| SG1 | The safety core is a standalone package that our SDK later imports | Accepted (owner, 2026-11-18) | [0043](../decisions/0043-standalone-safety-core.md) |
| SG2 | Round E may start before Round B, after B1 and B5 | Accepted (owner, 2026-11-19); hold lifted (owner, 2026-11-19) | none |
| SG3 | A write reports one of five outcomes, and `unknown` is never retried with a fresh key | Accepted (owner, 2026-11-18) | none |
| SG4 | Generated agents' model calls never go through Vercel AI Gateway | Accepted (owner, 2026-11-18) | none; narrows [0040](../decisions/0040-tenant-cloud-connections-and-byok.md), follow-up below |
| SG5 | A plan approval keeps its own signature, separate from D5's signed-request kinds | Accepted (owner, 2026-11-19) | none |

### SG1. The safety core is a standalone package that our SDK later imports (accepted, ADR 0043)

**Accepted by the owner on 2026-11-18**, with ADR 0043, including `EffectStore` as the eighth portable seam.

**Options.** Build the guarantees inside our SDK (Round B) and have the safety package import them, as [F5](../todos/ready/F5-agent-safety-package.md) does today by depending on [B15](../todos/done/B15-signed-pauses.md). Or build them in a package with no dependency on the loop, which the SDK then imports.

**Choice: a standalone core.** `@buildanagent/agent-safety` holds the signer, the canonical input hash, the effect identity, the outcome types and the plan approval. It depends only on `@buildanagent/gateway` for the price catalog and the cost projection. Our SDK imports the signer and hashing from it instead of defining them, and `projectCallCost()` moves from the loop (B14) to the gateway beside the catalog (B5). D5's contract does not change: the `ApprovalSigner` and `SignedPendingRequest` shapes of [build-sdk.md §3.3][sdk-33], key ids, a fail-closed resume and the same signed fields ([build-sdk.md, D5][d5]).

**Evidence.** F5 depends on B15, and B15 is the seventh todo on Round B's longest chain (B1 → B2 → B3 → B4 → B11 → B13 → B15), so today the package cannot start until most of our SDK exists ([build-sdk.md §4.3][sdk-43]). The owner wants to test these guarantees before building anything big, which needs a package that runs on SDKs we have already verified. Two copies of a signer or a cost formula would drift, and the plans already rely on one formula for the loop and the harness's summary layer ([build-sdk.md, D9][d9]).

**What changes.** ADR 0001 gains a third package, ADR 0009's "exported `projectCallCost()` (todo B14)" becomes "exported from the gateway (todo B5)", and ADR 0005's interface moves package without changing its rules or its shape. ADR 0033's seven portable seams gain an eighth, `EffectStore`, which N45's suite runs on every target. ADR 0043 records all four. The owner accepted it on 2026-11-18, so those consequences now hold, while ADRs 0001, 0005, 0009 and 0033 keep their own text.

### SG2. Round E may start before Round B, after B1 and B5 (accepted, hold lifted)

**Accepted by the owner on 2026-11-19** as the ordering, at first with a hold: "Approve plan, don't start yet."

**Amended (owner, 2026-11-19):** the owner lifted the hold for all of Round E ("Lift hold on all of E"). Round E is part of the SDK and harness build, and its todos start by the ordering below.

Round E depends on [B1](../todos/done/B1-sdk-workspace-scaffold.md), which creates `packages/`, and on [B5](../todos/done/B5-usage-cost-catalog.md), which ships the catalog that E5 needs. B5 sits at the end of the gateway chain (B1 → B2 → B3 → B4 → B5), and that chain needs none of the loop. E1–E4b and E6 need only B1, so they can run beside B2–B5, and E5 waits for B5. The amended B and N todos in §3 start when their own **Depends on** are done.

### SG3. A write reports one of five outcomes, and `unknown` is never retried with a fresh key (accepted)

**Accepted by the owner on 2026-11-18**, with B10's `effect: { kind: "write"; businessKey? }` declaration on `ToolDefinition`. The owner also chose the business key's scope: one tenant, which under [PF1](build-agent-platform.md#pf1-other-users-from-the-start-one-tenant-per-user-accepted) means one user, so the same refund or email is blocked across all of that user's sessions.

The server rollback report proposes four failure outcomes, `not_applied`, `compensated`, `partial` and `unknown`, each with a retry rule; `unknown` may be retried only with the same key ([server rollback report][sr-out]). The rewind report adds `applied` for success, making five, and treats a write whose call entry exists without a result as `unknown`, not as an error ([rewind report][rr-entry]). The saga outcome union maps onto these five, with `pending` covering a pivot whose result is not yet known ([sagas report][sg-five]). The kinds are our proposal from distributed-API practice, not a vendor vocabulary ([server rollback report][sr-out]).

### SG4. Generated agents' model calls never go through Vercel AI Gateway (accepted)

**Accepted by the owner on 2026-11-18:** "Refuse it." Vercel AI Gateway falls back to Vercel's own billed credentials by default, and that setting lives only in the team dashboard, so no deploy config can show it is off ([E6](../todos/done/E6-byok-no-fallback.md)). Generated agents therefore call providers directly or through a Cloudflare AI Gateway set to `byok_only`. This narrows [ADR 0040](../decisions/0040-tenant-cloud-connections-and-byok.md): its attested-setting path is not used for generated agents' model calls. ADR 0040's text is unchanged for now; a short amending ADR should record the narrowing when [F9](../todos/ready/F9-byok.md) starts, and F9 lists that follow-up.

### SG5. A plan approval keeps its own signature, separate from D5's signed-request kinds (accepted)

**Accepted by the owner on 2026-11-19:** keep plans separate for now. [E4a](../todos/done/E4a-plan-approval-record.md) signs a plan approval with its own domain-separated signature, and D5's union of signed-request kinds gains no `"plan"` kind ([build-sdk.md, D5][d5]). The question returns when [B15](../todos/done/B15-signed-pauses.md) starts.

**Note (2026-11-19, B15).** When B15 started, the owner answered the revisit: keep the signed-request kinds as D5 defines them, `"approval"` and `"clarification"`, with no `"plan"` kind. Plan approvals stay on E4a's own signature.

## 3. Each gap, the todos that cover it, and what changes

| # | Gap | Already covered by | What this plan adds |
| --- | --- | --- | --- |
| 1 | Typed side-effect outcomes reach the model | Nothing: `ToolResult` signals failure only with `isError` ([build-sdk.md §3.3][sdk-33]) | [E1](../todos/done/E1-safety-core-outcomes.md); a revision to [B10](../todos/done/B10-tool-runtime.md) adds `outcome` to `ToolResult` |
| 2 | Crash-safe write identity | Partly: `SessionStore.append` is "idempotent by id" ([rewind report][rr-plans]), and [ADR 0036](../decisions/0036-loop-outside-sandbox-and-pr-approval.md), [W6](../todos/ready/W6-pr-delivery.md) and [N45](../todos/ready/N45-portability-conformance-suite.md) persist an idempotency key before each outward write. None defines the crash rule, a business key or the `unknown` outcome | [E2](../todos/done/E2-effect-identity-crash-rule.md); revisions to [N7](../todos/done/N7-rebuild-resume-replay.md), [N40](../todos/ready/N40-code-initiated-calls.md) and [N35](../todos/ready/N35-harness-capstone.md) |
| 3 | Signed approvals that resume anywhere, fail closed and re-check policy | Our SDK and harness, fully: [B15](../todos/done/B15-signed-pauses.md), [B15b](../todos/done/B15b-continue-run.md), [N13](../todos/ready/N13-signed-approvals.md) ("A deny rule added after the pause turns an `allow` resolution into a denial result"), [N42](../todos/ready/N42-read-only-key-store.md) | [E3](../todos/done/E3-signed-approvals-third-party.md) for the third-party SDKs |
| 4 | One approval for a whole plan with an irreversible pivot | Nothing: no plan has a plan approval kind ([sagas report][sg-approval]) | [E4a](../todos/done/E4a-plan-approval-record.md), [E4b](../todos/done/E4b-ordered-plan-execution.md) |
| 5 | A spend cap checked before each model call | Our SDK, fully: D9 and [B14](../todos/done/B14-budget-progress.md) | [E5](../todos/done/E5-pre-call-cost-guard.md) for the AI SDK, which has "no spend cap" ([feature table][ft]) |
| 6 | One code base on local Node, Cloudflare, AWS and Vercel | The harness, fully: [N41](../todos/ready/N41-scheduler-wake.md)–[N49](../todos/ready/N49-hosted-sandbox-measurement.md) with the [N45](../todos/ready/N45-portability-conformance-suite.md) suite ([ADR 0033](../decisions/0033-three-deployment-targets.md)) | [E7](../todos/done/E7-safety-portability.md); a revision to N45 adds the safety stores to the suite |
| 7 | The user's own key, with no silent fallback | Partly: our gateway takes an explicit `apiKey` ([build-sdk.md §3.2][sdk-32]); [F9](../todos/ready/F9-byok.md) and [ADR 0040](../decisions/0040-tenant-cloud-connections-and-byok.md) for the platform. The AI SDK has three silent paths: a provider key from the environment, a base URL from the environment, and string model ids that route through Vercel AI Gateway | [E6](../todos/done/E6-byok-no-fallback.md); revisions to [B4](../todos/done/B4-gateway-runtime.md) and F9 |

[F5](../todos/ready/F5-agent-safety-package.md) keeps its place in the platform plan, but its scope moves into Round E. A revision makes F5 depend on E7, which closes the round, instead of B15, and narrows it to releasing the package for the generation templates. Under ADR 0043 the signer comes from E3, and PF5's text in the platform plan has said so since plan review 2 (2026-11-19).

Two more revisions follow from SG1, which the owner accepted on 2026-11-18. [B5](../todos/done/B5-usage-cost-catalog.md) exports `projectCallCost()` and the token-level `projectCost()` it calls, so E5 and B14 share one formula. [B10](../todos/done/B10-tool-runtime.md) also adds an optional `effect` declaration to `ToolDefinition`, which the N7 and N40 revisions read to tell a write from a read. Because the owner accepted ADR 0043, [B14](../todos/done/B14-budget-progress.md) and [B15](../todos/done/B15-signed-pauses.md) carry revisions too: B14 imports `projectCallCost()` from the gateway, and B15 imports the signer and input hash from the safety package and depends on E3.

**Revision (plan review 2, 2026-11-19).** Four clarifications follow. First, E1 builds `canonicalInputHash()`, because E2, B10 and B14 need it before E3 runs; B14 therefore also depends on E1. Second, the safety package owns `SignedPendingRequest` and `Resolution`, and the SDK re-exports them (confirmed by the owner on 2026-11-19, and recorded in E3 and ADR 0043). Third, the package's root export imports no third-party SDK, and the `ai` and `agents` adapters live in `./ai` and `./agents` subpaths (E1; owner to confirm). Fourth, W6 uses E2's `guardedWrite()` for its pushes and pull requests, the owner's choice of 2026-11-19 ("E2 owns it; W6 uses it").

**Note (2026-11-19, E2).** E2's build changed three details of its design notes, which N7, N40, W6 and E7 should follow. `effectKey()` is async, because Web Crypto's digest is. `EffectStore` gains `takeOver()`, and each record an `attempt` number, so two processes that resume one crashed write cannot both send it. `guardedWrite()` also takes a required `dedupe` of `"idempotency_key"`, `"reconcile"` or `"unknown_only"`, which is how a tool with neither an idempotency key nor a reconcile query declares itself `unknown`-only ([E2's outcome](../todos/done/E2-effect-identity-crash-rule.md#outcome)).

**Note (2026-11-20, E4a).** E4a's build changed five details of its design notes, which E4b should follow. `verifyPlanBeforeStep(approval, call, options)` takes the step as the host is about to run it (`{ stepId, tool, input }`), so it can hash the input itself. Its options take a `readState` callback in place of a `freshState` value, so steps after the pivot never read the state. A required `PlanLedger` claims each step after every other check passes, which adds two results, `replayed` and `out_of_order`, and refuses a replayed approval or a skipped step. The record's signature field is `signature`, as in `SignedPendingRequest`, not `sig`. Last, `signPlan()` takes each step's input and the read values and signs their hashes, and `planCard()` builds the card from the same fields, so both see the same hashes; `SafetyErrorCode` gains `invalid_plan` ([E4a's outcome](../todos/done/E4a-plan-approval-record.md#outcome)).

## 4. Round E and its todos

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [E1](../todos/done/E1-safety-core-outcomes.md) | Safety core: the five outcomes and how the model reads them | B1 | M |
| [E2](../todos/done/E2-effect-identity-crash-rule.md) | Effect identity, the persist-before-execute rule and the crash test | E1 | M |
| [E3](../todos/done/E3-signed-approvals-third-party.md) | Signed, fail-closed approvals on `agents` 0.33.0 and `ai` 7.0.162, with policy re-checked on resume | E1 | M |
| [E4a](../todos/done/E4a-plan-approval-record.md) | The plan approval record: exact steps, the pivot, and an input hash that expires it | E2, E3 | M |
| [E4b](../todos/done/E4b-ordered-plan-execution.md) | Ordered plan execution: compensable steps, the pivot, the compensation log and the outcome | E4a | M |
| [E5](../todos/done/E5-pre-call-cost-guard.md) | A pre-call USD cap for the AI SDK through model middleware | E1, B5 | M |
| [E6](../todos/done/E6-byok-no-fallback.md) | BYOK with no silent fallback: explicit keys, an egress assertion and gateway settings | E1 | S |
| [E7](../todos/done/E7-safety-portability.md) | The safety stores on Cloudflare, AWS and Vercel, and the package tests in workerd | E4b, E5, E6 | M |

E1 → E2 → E4a → E4b → E7 is the longest chain. E3, E5 and E6 can run beside it, and E7 closes the round because it runs the whole package suite in workerd.

## 5. Every test runs offline against a mock model

Every acceptance criterion in Round E runs offline: against the AI SDK's `MockLanguageModelV4` and the Cloudflare `agents` workerd test setup our references verified ([Vercel AI SDK skill](../../.agents/skills/vercel-ai-sdk/SKILL.md); [Cloudflare reference §12][cf12]). Mock tools never touch the host, following the repo's rule ([AGENTS.md](../../AGENTS.md#process-for-documenting-an-sdk)). Three tests carry the round's main claims:

- **The crash test.** A tool is killed between persisting its effect and returning; the resume reports `unknown`, reconciles, and sends nothing twice. The rewind report names this as the missing test: "Until that test passes, 'exactly once' in our plans means 'once, if nothing crashes'" ([rewind report][rr-ledgers]).
- **The stale plan test.** A plan approval whose inputs change before the pivot fails closed.
- **The egress test.** No outgoing request carries any credential but the user's.

## 6. Risks and sequence

1. **The third-party SDKs move.** E3, E5 and E6 wrap documented hooks (`needsApproval`, `toolApproval`, `wrapLanguageModel`, explicit provider keys), and the package pins exact versions, following ADR 0038 ([ADR 0038](../decisions/0038-generated-agent-sdk-policy.md)).
2. **A model outside the middleware escapes the cap.** In `ai` 7.0.162, `generateText` and `streamText` call the step model's `doGenerate` or `doStream` on every step and every retry, so a `wrapLanguageModel` middleware sees each provider request (fact-check rows 37–38). A `prepareStep` that returns an unwrapped model, or a string model id, bypasses it, so E5 wraps the whole provider and E6 refuses string ids.
3. **Outcome wording is untested on models.** No published study measures how models respond to outcome fields ([server rollback report][sr-out]). E1's eval tasks are the first measurement.
4. **The pins may have moved.** Round E was on hold until 2026-11-19. If `agents` 0.33.0 or `ai` 7.0.162 have moved on when E1 starts, E1's first task re-pins them under ADR 0038 and reruns their verify harnesses before any E todo builds on them.

Round E fits the roadmap beside Round B: B1 ─► E1 … E7, with E5 after B5. The owner lifted the hold on 2026-11-19. The folded-in revisions in §3 run when their own todos come up in Rounds B, N and F.

[sr]: ../research/reversible-actions/server-rollback.md
[sr-out]: ../research/reversible-actions/server-rollback.md#after-a-rollback-tell-the-model-one-of-four-outcomes-in-the-result-body
[sg]: ../research/reversible-actions/sagas.md
[sg-approval]: ../research/reversible-actions/sagas.md#approval-belongs-before-the-first-compensable-step-and-covers-the-whole-plan
[sg-five]: ../research/reversible-actions/sagas.md#the-agent-needs-five-outcomes-and-only-masstransit-tells-compensated-from-compensation-failed
[sg-harness]: ../research/reversible-actions/sagas.md#the-harness-not-the-engine-owns-order-approval-and-outcome
[rr]: ../research/reversible-actions/rewind-vs-rollback.md
[rr-plans]: ../research/reversible-actions/rewind-vs-rollback.md#our-sdks-and-plans-rewind-the-conversation-and-roll-back-no-data
[rr-entry]: ../research/reversible-actions/rewind-vs-rollback.md#a-rollback-is-a-new-linked-entry-and-the-model-must-read-it
[rr-ledgers]: ../research/reversible-actions/rewind-vs-rollback.md#two-ledgers-and-the-first-fields-to-add
[pa]: ../research/deployment/portable-agents.md
[abp]: ../research/deployment/agent-building-platforms.md
[ft]: ../comparison/feature-table.md
[strands]: ../research/external-designs/strands-harness-sdk.md
[d5]: build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5
[d9]: build-sdk.md#d9-the-usd-cap-is-checked-before-each-model-call-against-a-projected-cost
[sdk-32]: build-sdk.md#32-gateway-api
[sdk-33]: build-sdk.md#33-sdk-api
[sdk-43]: build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses
[cf12]: ../reference/cloudflare-agents/guide.md#12-tests-run-in-workerd-with-a-mock-model
