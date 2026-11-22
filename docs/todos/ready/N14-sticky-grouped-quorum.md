# N14: Sticky allowances, grouped approvals and the quorum hook

| Field | Value |
| --- | --- |
| ID | `N14` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 3](../../plans/build-harness.md#43-stage-3-adds-the-registry-the-permission-pipeline-signed-approvals-and-code-initiated-calls) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N13](../done/N13-signed-approvals.md) |
| Size | M |

## Goal

Cut approval fatigue without widening trust: allow sticky approvals scoped to a run or session that refuse interpreter prefixes and secrets, group equivalent calls into one decision, and give P3 a quorum hook.

## Context

- [HD12](../../plans/build-harness.md#hd12-three-middle-ground-modes-and-no-classifier-allow-outside-the-host-callback): the decision and its evidence
- [harness guide §5](../../guides/agent-harness.md#5-the-permission-pipeline-should-be-ordered-deny-first-and-fail-closed-and-its-approvals-should-be-signed-entries): sticky approvals, interpreter prefixes, grouped calls
- [build-harness.md §3.7](../../plans/build-harness.md#37-what-the-agent-plan-gets-from-the-harness): R1

## Scope

**In scope**

- `sticky: "run" | "session"` on `approval_resolved`, matched by tool and `canonicalInputHash` or by a command prefix
- A refusal list of interpreter prefixes (`bash -c`, `sh -c`, `sh -lc`, `zsh -c`, `node -e`, `python -c`, `bun run`, `npx`, `uvx`)
- A secret check that refuses a sticky pattern containing any value the credential store knows
- Grouped approvals: requests in one step with the same tool and the same canonical input hash (for `bash`, over the normalised command) share a `groupId`; a group resolution counts as one approver's resolution on each request
- `RegisteredTool.approvalReuse`: the pipeline refuses a `sticky` or `group` resolution on a tool whose setting forbids it (R8)
- `QuorumPolicy` with `evaluate(request, resolutions)` returning `met`, `pending`, `rejected` or `expired`, a default of one resolution, and a check that rejects an approver equal to the requester (R10)
- The rule that the host fills `Resolution.by` only after authenticating the approver, stated in the `Approvals` JSDoc

**Out of scope** (and which todo covers it)

- Quorum rules and roles (P3)

## Tasks

- [ ] Add `sticky` matching to `Approvals.resolve()`: store the allowance on the `approval_resolved` entry, and before the next ask match it by tool and `canonicalInputHash`, or by a command prefix for `bash`.
- [ ] Refuse a sticky pattern that starts with a listed interpreter prefix or contains a value the credential store knows, with a typed error that names the reason.
- [ ] Refuse `sticky` and `group` for a tool whose `approvalReuse` is `"none"` (or excludes that kind) before any entry is written.
- [ ] Compute `groupId` for the pending requests of one step from tool and input hash, and resolve a group as one resolution per request.
- [ ] Define `QuorumPolicy` and the default one-resolution policy; reject a resolution whose `by` equals the request's requester.
- [ ] Show grouped requests in one `approval/request` (the `group` field, wired in N28).

## Acceptance criteria

- [ ] A session-sticky allowance skips the prompt for the same call in a later turn and never in a new session
- [ ] Each listed interpreter prefix is refused as a sticky pattern
- [ ] A quorum policy of two keeps the call pending after one resolution and runs it after the second distinct approver
- [ ] An approver equal to `requesterId` is rejected
- [ ] A sticky or grouped resolution on a tool with `approvalReuse: "none"` is refused, and the call still asks on its next attempt (R8)
- [ ] Two grouped `write` calls with the same input hash share a `groupId`, and two with different inputs do not
- [ ] A custom `QuorumPolicy` returning `expired` turns the pending call into a denial result
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/permissions/sticky.test.ts`, `grouped.test.ts`, `quorum.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

The agent's quorum expires on age and policy change (agent AD3); `evaluate()` returning `expired` covers both, and the policy keeps its own clock.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
