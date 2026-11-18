# F4: Hidden-grader eval runner and signed gate reports

| Field | Value |
| --- | --- |
| ID | `F4` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F3](F3-gate-type-check-and-mock-tests.md) |
| Size | M |

## Goal

Add the gate's third check, evals scored by graders the generator never sees, and sign each gate report for its exact commit.

## Context

- [ADR 0039](../../decisions/0039-check-and-deploy-gate.md): graders out of the generator's reach.
- [Agent-building platforms report](../../research/deployment/agent-building-platforms.md#testing-a-generated-agent-before-showing-it-is-the-least-served-step): DGM's evaluator gaming.

## Scope

**In scope**

- An eval runner that reads generated cases and platform-held graders
- A signed gate report over the commit, the target and the results

**Out of scope**

- Deploy adapters that verify the report (F7, F8)

## Tasks

- [ ] Define the eval case format the generator writes.
- [ ] Store graders per template and per tenant outside the repository.
- [ ] Sign the report with a platform key and expose a verify function.

## Acceptance criteria

- [ ] A report for commit X fails verification for commit Y.
- [ ] A project that edits a file named like a grader cannot change the grader's result.

## Tests

Unit tests for signing and verification; fixture evals.

## Docs to update

The plan's §5.1 table.

## Risks and open questions

Grader design per template is owned by F6.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
