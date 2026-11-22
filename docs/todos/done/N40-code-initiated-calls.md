# N40: Code-initiated tool calls: `Harness.invokeTool()` and the `code_call` entry

| Field | Value |
| --- | --- |
| ID | `N40` |
| Status | `done` |
| Plan | [Build harness §4, Stage 3](../../plans/build-harness.md#43-stage-3-adds-the-registry-the-permission-pipeline-signed-approvals-and-code-initiated-calls) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N13](../done/N13-signed-approvals.md), [N14](../done/N14-sticky-grouped-quorum.md), [B15](../done/B15-signed-pauses.md), [E2](../done/E2-effect-identity-crash-rule.md) |
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

- [x] Add `code_call` to the entry union and `SESSION_ENTRY_TYPES`, and regenerate the schema.
- [x] Implement `invokeTool()` on the harness: write `code_call` (origin `harness`), call `decide()`, then branch on the decision.
- [x] Route `Approvals.resolve()` by call id: a call id from a turn goes to `continueRun` as before, and one from a `code_call` goes to the code-call runner.
- [x] Apply `ResolveOptions` (`signal`, `hostContext`) to the code-call runner; a code call makes no model call, so `budgetUsd` does not apply to it.
- [x] Refuse a `sticky` or `group` resolution for a tool whose `approvalReuse` forbids it, as N14 does for model calls.
- [x] Test from a second process: one process asks, another resolves and runs the call.

## Acceptance criteria

- [x] An allowed code call runs the tool once and writes `code_call`, `permission_decision` and `tool_result` entries in that order, with no model call (`ScriptedModel.calls` stays empty)
- [x] A denied code call writes an `isError` `tool_result` and never runs the tool
- [x] An `ask` writes an `approval_requested` entry whose signature verifies with the harness's key ring, and whose payload is byte-identical to the one `createPendingRequest()` builds for the same fields
- [x] `Approvals.resolve()` with an `allow` from a second process runs the tool exactly once and returns `{ status: "done" }`
- [x] A deny rule added after the pause turns an `allow` resolution into `{ status: "denied" }`
- [x] A quorum policy of two keeps a code call pending after one resolution and runs it after the second distinct approver
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root (all pass here except `framing-interop.test.ts`, whose two dev dependencies this environment has not installed; see the outcome)

## Tests

`packages/harness/test/permissions/code-call.test.ts` and `code-call-second-process.test.ts`.

## Docs to update

`packages/harness/README.md`: code-initiated calls. [build-harness.md §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis) if the signature changes, and the plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

A code call's input often comes from a tainted draft. The harness records the call and its decision; taint is the product's rule (agent AD5), so a product hook must ask for such calls.

## Revision (2026-11-18, SDK gaps)

Gap 2 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) gives code-initiated writes the same identity as model-initiated ones. The `code_call` entry is appended before the tool runs, so the effect key must be derived from that entry ([rewind report](../../research/reversible-actions/rewind-vs-rollback.md#a-rollback-is-a-new-linked-entry-and-the-model-must-read-it)). Add:

- [x] `invokeTool()` derives the effect key from the `code_call` entry id, or from the tool's business key when it declares one, and a resumed call finds the same key.
- [x] A compensation runs through `invokeTool()` with its own key and writes a linked record naming the call it compensates.

The business key is the tool's `effect.businessKey` from the [B10](../done/B10-tool-runtime.md) revision, and the key function is [E2](../done/E2-effect-identity-crash-rule.md)'s `effectKey()`. The owner accepted SG3 on 2026-11-18, so E2 is in **Depends on**. The `EffectScope` this todo passes to E2 takes `tenant` from the harness config (default `"local"`), with the session key, the branch and the tool call id, as [N7](../done/N7-rebuild-resume-replay.md) does (plan review 2, 2026-11-19).

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`Harness.invokeTool()` runs a tool call that the host's own code chose through the permission pipeline, the signed pause and the log, with no model call. It is built in `packages/harness/src/session/code-call.ts`, which reads the log through `code-call-log.ts`, and `Approvals.resolve()` routes a code call's answer to it. `createHarness()` moved to `packages/harness/src/create-harness.ts`, because `harness.ts` holds the types the runner imports, and a type-only import counts as a cycle for `pnpm check:deps`. The plan's §3.2, §3.4 and §3.5 and its status line record the changes, and every link to this todo now points at `done/`.

- **The entry.** `code_call` (`callId`, `tool`, `input`, `inputHash`, optional `compensates`) is in `@buildanagent/protocol`'s union and `SESSION_ENTRY_TYPES`, after `tool_result`. `pnpm --filter @buildanagent/protocol schema` regenerated both JSON Schemas. The fixtures, the protocol and harness READMEs and the session format page count twenty-one types.
- **The call id is the entry's id.** The effect key is the tool's business key when it declares one, and otherwise `effectScope(session, harness, callId)`. A tool that builds its key from `ctx.callId` gets the same key, and a resolution in another harness or process finds it again. Every result except `denied` returns it as `effectKey`.
- **The order of entries.** An allow writes `code_call`, `permission_decision` and `tool_result`. A deny writes an error `tool_result` from the harness. An ask that no sticky allowance covers writes `approval_requested` with a request from `createPendingRequest()`, bound to `hostContext` when one is given. A sticky allowance covers a code call as it covers a model call.
- **Resolving.** An answer to a code call's request is checked against the signature, the bound host context, the call, the tool and the input before anything is written. The input must hash to the recorded hash in the `code_call` entry, the `approval_requested` entry and the request alike. A failure throws the new code `approval_refused`, whose message names only the cause. The answer is then written, the quorum policy decides, and `met` decides the call again with the pipeline before the tool runs.
- **Exactly once.** A call with a result no longer waits, so a replay throws `approval_not_pending`. A call that was let run, by an allow, a sticky allowance or an accepted answer, and has no result is never run again. The next `invokeTool()` settles it with the result an interrupted model call gets. One code call of a session runs at a time in a process; the session's lock keeps out other processes.
- **Compensation.** `compensates` names an earlier code call that ran or may have run. The compensation must reach an effect key of its own, or `invokeTool()` throws the new code `invalid_code_call`. The link is the `compensates` field of the compensation's own `code_call` entry.
- **Tests.** `test/permissions/code-call.test.ts` covers every acceptance criterion and the revision's two tasks, plus the failure paths: a forged signature, a key the ring lacks, an input changed in the `approval_requested` entry or edited in the session file, the wrong host context, a replay, an answer naming no request, a code call's answer given with another answer, and a crash after the tool ran and before its result was stored. `test/permissions/code-call-second-process.test.ts` pauses a refund in this process and resolves it in a child process with a cleared environment: the refund runs once, there, with no model call, and a second child's replay runs nothing.

Judgement calls, where the spec left a choice:

- **`invokeTool()` takes `compensates`, `signal`, `clock` and `newId`** beside the plan's `tool`, `input` and `hostContext`, and `CodeCallResult` adds `effectKey`. The plan's §3.4 records both.
- **The compensation link is a field, not a `product_record`.** The rewind report has the product write a `triage.rollback` record with the actor, the reason and what can't be undone. This todo writes only the harness's part, the call id the compensation undoes; the product's richer record stays the product's.
- **A request that fails its check is refused, not asked again.** A turn's tampered request is re-signed and asked again by the SDK. Re-signing a code call's tampered input would launder it, so the call keeps waiting, nothing is written, and only a request that passes the check can resolve it.
- **One `resolve()` answers one code call.** `CodeCallResult` describes one call, so an answer to a code call's request together with any other answer throws `invalid_code_call`. A code call has no step, so `group: true` covers only its own call, and it is refused for a tool whose `approvalReuse` forbids grouping even then. N14 checks grouping only when a group joins several requests; this is the stricter reading.
- **`resolve(session, [])` evaluates a turn's requests only.** A policy that expires a code call does so when the call is next answered.
- **The model never reads a code call.** Its result answers no call the model made, and a provider refuses a tool result without its call, so the rebuilt context leaves code calls out.
- **The input is not checked against the tool's schema.** The harness has no schema validator of its own, and the SDK's is internal. The host's code chose the input, so the pipeline decides on it, the request signs it and the tool runs it as given.
- **A harness with no pipeline or no signer refuses every code call** (`invalid_code_call`, `approval_unavailable`), before anything is written.
- **A crash's settlement waits for the next `invokeTool()`.** `runTurn()` does not settle code calls, so a turn and a code call never race to settle the same call.
- **The dispatcher lists a turn's requests only.** `approval/list` now reads the log as the rest of the dispatcher does, so a client is never shown a code call's request that the protocol can't answer yet. `Approvals.pending()` lists both.


**Verification gap.** In the build environment, `@modelcontextprotocol/client` and `json-rpc-2.0` (N29's dev dependencies) were missing from the local pnpm store, and no network was allowed. So `test/server/framing-interop.test.ts` and the type-checks that read it (`pnpm typecheck` for the harness and the docs app's API-docs check) failed for that reason alone. Every other check passed: `pnpm check`, `check:deps`, `check:duplicates`, `check:unused`, `check:ids`, and every other test file in the workspace. CI, which installs the lockfile, should confirm the criterion.
