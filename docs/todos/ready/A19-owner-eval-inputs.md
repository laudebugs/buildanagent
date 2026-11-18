# A19: Owner inputs: the priority policy, 30 labelled real tickets, judge and simulator models (AD6)

| Field | Value |
| --- | --- |
| ID | `A19` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 4](../../plans/build-agent.md#44-stage-4-builds-the-eval-suite-and-the-release-gate-then-runs-them-live-once-the-owners-inputs-arrive) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A17](A17-eval-tasks-graders.md) |
| Size | M |

## Goal

Collect the inputs only the owner can supply for the real eval suite, de-identify the tickets and convert them into `TriageTask`s, and hand the 10 classification tasks to the harness seed suite (N38b).

## Context

- [AD6](../../plans/build-agent.md#ad6-the-owner-names-the-policy-writer-and-two-labelling-leads-and-the-judge-and-simulator-run-on-the-other-provider-accepted): eval ownership
- [AD8](../../plans/build-agent.md#ad8-code-appends-the-ai-label-spans-hash-identifiers-and-later-stages-need-a-retention-period-accepted-with-hd11): the repo holds only synthetic and de-identified tickets; raw tickets never enter it
- [N38b](N38b-shared-triage-tasks.md): the harness todo that adds the 10 classification tasks to its seed suite

## Scope

**In scope**

- **The owner supplies:** a written priority policy and its author; two support leads who label independently; 30 de-identified real tickets with fixtures; the judge and simulator model ids and an account on the D2 provider the agent does not use; 50 human-labelled summaries for judge calibration
- A de-identification checklist and a converter into `TriageTask`
- Dropping or rewriting tickets the leads disagree on

**Out of scope** (and which todo covers it)

- Running the suite (A20)

## Tasks

- [ ] Run every ticket through the de-identification checklist, and commit only tickets that pass it, as `TriageTask`s under `packages/triage-agent/evals/real/`, with the converter and the checklist.
- [ ] Keep raw tickets out of the repository and out of every commit; they stay in the helpdesk under its own retention.
- [ ] Record the agreement rate between the two leads.

## Acceptance criteria

- [ ] 30 real tasks exist in the agreed location, balanced across the seven slices
- [ ] Every task has two labels that agree
- [ ] Every committed real task has a checklist record showing it passed, and a scan, run before each commit against the raw tickets, finds none of their email addresses, phone numbers or order ids in the repository
- [ ] N38b can read the 10 classification tasks through `@agent-speak/triage-agent/evals`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The converter's unit tests on a synthetic ticket.

## Docs to update

`packages/triage-agent/evals/README.md` (where real tasks live and who owns them). The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

Blocked until the owner supplies the inputs; every earlier todo runs without them.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
