# A15: Agent capstone: injection, cross-customer, quorum and kill-switch cases end to end

| Field | Value |
| --- | --- |
| ID | `A15` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 3](../../plans/build-agent.md#43-stage-3-the-workflow) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A14](A14-bundle-hash-overlays.md), [N35](N35-harness-capstone.md) |
| Size | M |

## Goal

Run the whole agent on the harness end to end and prove each design guarantee against the guide's failure cases, on the scripted model and on the SDK's mock transports.

## Context

- [build-agent.md §5.6](../../plans/build-agent.md#56-the-agent-capstone-checks-the-whole-stack-against-the-guides-failure-cases): the six capstone rows
- [agent guide §5](../../guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg): the injection walk-through
- [ADR 0026](../../decisions/0026-provenance-block-origin-and-context-taint.md): the provisional check

## Scope

**In scope**

- `packages/triage-agent/examples/triage-capstone.ts`
- The six rows of §5.6: cross-customer, injection, T4 above the cap, kill switch, second-process resume, budget
- Runs on `ScriptedModel` and on both adapters' mock transports

**Out of scope** (and which todo covers it)

- Real-model behaviour (A20)

## Tasks

- [ ] Reuse the harness capstone's second-process setup from N35.
- [ ] Record any case where taint alone would have missed an injection, for ADR 0026.

## Acceptance criteria

- [ ] All six rows pass on `ScriptedModel` and on both mock transports
- [ ] No request in the injection case contains another requester's data
- [ ] The second-process approval sends the reply exactly once
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/capstone.test.ts`.

## Docs to update

The README's capstone section; ADR 0026's status if a case fails. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None beyond the needs it exercises.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
