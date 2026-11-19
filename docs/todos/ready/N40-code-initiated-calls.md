# N40: Code-initiated tool calls: `Harness.invokeTool()` and the `code_call` entry

| Field | Value |
| --- | --- |
| ID | `N40` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 3](../../plans/build-harness.md#43-stage-3-adds-the-registry-the-permission-pipeline-signed-approvals-and-code-initiated-calls) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N13](N13-signed-approvals.md), [N14](N14-sticky-grouped-quorum.md), [B15](B15-signed-pauses.md), [E2](E2-effect-identity-crash-rule.md) |
| Size | M |

## Goal

Let product code run a side effect it chose, such as an approved reply or a refund, through the same permission pipeline, signed pause and log as a model-proposed call, with no model step. The agent plan's workflow runs every T2+ side effect this way (agent AD1), so Round A cannot build its drafter or workflow without it.

## Context

- [build-harness.md §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis): `CodeCallResult`, `Approvals.resolve` and the `invokeTool` comment
- [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api): the `code_call` and `permission_decision` entries
- [SDK plan §3.3](../../plans/build-sdk.md#33-sdk-api): `createPendingRequest()`, which signs the same payload as a loop pause (B15)
- [agent plan AD1](../../plans/build-agent.md#ad1-the-product-composes-the-workflow-from-three-linked-harness-turns-and-code-runs-every-side-effect-through-the-pipeline-provisional): why code runs the side effects
- [P4 review R3](../../plans/reviews/plan-review.md#21-consistency-most-names-match-but-six-interfaces-are-missing-or-point-the-wrong-way): the finding this todo closes

## Scope

**In scope**

- `Harness.invokeTool(session, { tool, input, hostContext })` returning a `CodeCallResult`: `done`, `denied` or `awaiting_approval` with its pending request
- The `code_call` entry (`callId`, `tool`, `input`, `inputHash`), added to the entry union in `@buildanagent/protocol` and to the schema
- The pipeline's `decide()` with `ToolCall.initiator: "code"`, writing a `permission_decision` entry as for any call
- On `allow`: run the registered tool through the registry's wrapper with the given host context, and write a `tool_result` entry
- On `deny`: write a `tool_result` entry with `isError` and return `denied`
- On `ask`: build the request with `createPendingRequest()` and the harness's `hmacSigner()`, and write an `approval_requested` entry before any client sees it
- `Approvals.resolve()` on a request whose call id names a `code_call` entry: re-run the pipeline (deny wins), apply the quorum policy, then run the tool itself with no model step and return a `CodeCallResult`

**Out of scope** (and which todo covers it)

- Which side effects a product runs as code calls, and their tiers (agent A6, A12)
- Protocol server requests for these pauses (N28 sends every `approval_requested` alike)

## Tasks

- [ ] Add `code_call` to the entry union and `SESSION_ENTRY_TYPES`, and regenerate the schema.
- [ ] Implement `invokeTool()` on the harness: write `code_call` (origin `harness`), call `decide()`, then branch on the decision.
- [ ] Route `Approvals.resolve()` by call id: a call id from a turn goes to `continueRun` as before, and one from a `code_call` goes to the code-call runner.
- [ ] Apply `ResolveOptions` (`signal`, `hostContext`) to the code-call runner; a code call makes no model call, so `budgetUsd` does not apply to it.
- [ ] Refuse a `sticky` or `group` resolution for a tool whose `approvalReuse` forbids it, as N14 does for model calls.
- [ ] Test from a second process: one process asks, another resolves and runs the call.

## Acceptance criteria

- [ ] An allowed code call runs the tool once and writes `code_call`, `permission_decision` and `tool_result` entries in that order, with no model call (`ScriptedModel.calls` stays empty)
- [ ] A denied code call writes an `isError` `tool_result` and never runs the tool
- [ ] An `ask` writes an `approval_requested` entry whose signature verifies with the harness's key ring, and whose payload is byte-identical to the one `createPendingRequest()` builds for the same fields
- [ ] `Approvals.resolve()` with an `allow` from a second process runs the tool exactly once and returns `{ status: "done" }`
- [ ] A deny rule added after the pause turns an `allow` resolution into `{ status: "denied" }`
- [ ] A quorum policy of two keeps a code call pending after one resolution and runs it after the second distinct approver
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/permissions/code-call.test.ts` and `code-call-second-process.test.ts`.

## Docs to update

`packages/harness/README.md`: code-initiated calls. [build-harness.md §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis) if the signature changes, and the plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

A code call's input often comes from a tainted draft. The harness records the call and its decision; taint is the product's rule (agent AD5), so a product hook must ask for such calls.

## Revision (2026-11-18, SDK gaps)

Gap 2 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) gives code-initiated writes the same identity as model-initiated ones. The `code_call` entry is appended before the tool runs, so the effect key must be derived from that entry ([rewind report](../../research/reversible-actions/rewind-vs-rollback.md#a-rollback-is-a-new-linked-entry-and-the-model-must-read-it)). Add:

- [ ] `invokeTool()` derives the effect key from the `code_call` entry id, or from the tool's business key when it declares one, and a resumed call finds the same key.
- [ ] A compensation runs through `invokeTool()` with its own key and writes a linked record naming the call it compensates.

The business key is the tool's `effect.businessKey` from the [B10](../ongoing/B10-tool-runtime.md) revision, and the key function is [E2](E2-effect-identity-crash-rule.md)'s `effectKey()`. The owner accepted SG3 on 2026-11-18, so E2 is in **Depends on**. The `EffectScope` this todo passes to E2 takes `tenant` from the harness config (default `"local"`), with the session key, the branch and the tool call id, as [N7](N7-rebuild-resume-replay.md) does (plan review 2, 2026-11-19).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
