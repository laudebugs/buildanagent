# A10: The reader role, order-id validation and routing

| Field | Value |
| --- | --- |
| ID | `A10` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 3](../../plans/build-agent.md#43-stage-3-runs-the-three-roles-as-linked-turns-and-proves-the-workflow-in-a-capstone) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A2](A2-trusted-context-helpdesk.md), [N7](N7-rebuild-resume-replay.md), [B19](B19-triage-capstone.md) |
| Size | M |

## Goal

Run the tool-less reader as a harness turn with an output schema, store its summary behind a reference, validate its order ids against the trusted run context, and route T5 and unclassifiable tickets to a person.

## Context

- [AD1](../../plans/build-agent.md#ad1-the-product-composes-the-workflow-from-three-linked-harness-turns-and-code-runs-every-side-effect-through-the-pipeline-provisional): the reader as a loop run with only an output tool
- [AD12](../../plans/build-agent.md#ad12-a-missing-fact-becomes-a-templated-question-through-the-reply-gate-and-missing-authority-becomes-a-handoff-provisional): `missing` and `needsHuman`
- [build-agent.md §3.4](../../plans/build-agent.md#34-roles-gates-and-the-workflow): `ReaderOutput`, `ReaderResult`, `READER`
- [agent guide §4](../../guides/agent.md#4-the-system-prompt-stays-short-and-frozen-skills-hold-procedures-and-only-code-enforces): a short, frozen, static-first prompt

## Scope

**In scope**

- `prompts/reader.md`
- `READER` settings: no tools but the output tool, `maxSteps: 2`
- The variable store for `$SUMMARY`
- Validation: `orderIds` ⊆ `ctx.orderIds`, else handoff `invalid_order_ids`; `needsHuman` or a T5 request → handoff
- A child session for the reader, opened with `Session.child({ stepId: "step:reader" })`, and the reader's settings passed per turn (harness N5, N6)

**Out of scope** (and which todo covers it)

- The planner (A11)
- Prompt overlays (A14)

## Tasks

- [ ] Keep volatile data (timestamps, ticket ids) in the user turn after the cached system prompt.
- [ ] Assert in a test that the reader's request lists no tools besides the output tool.

## Acceptance criteria

- [ ] A scripted reader output with a foreign order id ends in handoff `invalid_order_ids`
- [ ] A schema-invalid first output is repaired on the second step; a second failure hands off
- [ ] The `$SUMMARY` text appears in no planner request
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/roles/reader.test.ts`.

## Docs to update

The package README's "Workflow" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None open. AH1 and AH3 are in harness N6 and N5, which this todo's N7 dependency covers.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
