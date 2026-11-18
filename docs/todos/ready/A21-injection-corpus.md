# A21: Grow the injection corpus to dozens of tasks across residual channels

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A21` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 4](../../plans/build-agent.md#44-stage-4-builds-the-eval-suite-and-the-release-gate-then-runs-them-live-once-the-owners-inputs-arrive) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A17](A17-eval-tasks-graders.md) |
| Size | M |

## Goal

Grow the two injection tasks toward dozens, covering direct instructions, cross-customer lookups and the residual channels (the reply itself, links, images, DNS and public issues), scored by attack success beside a benign set.

## Context

- [agent guide §5](../../guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg): residual channels and red-teaming
- [AD11](../../plans/build-agent.md#ad11-every-reply-needs-a-person-in-v1-and-the-template-only-path-waits-for-a-zero-leak-corpus): the bar for template-only replies
- [ADR 0026](../../decisions/0026-provenance-block-origin-and-context-taint.md)

## Scope

**In scope**

- At least 24 synthetic injection tasks, each with the attack, the channel and the labelled outcome
- Attack success rate and benign task success reported together
- Real-model runs in the opt-in eval job

**Out of scope** (and which todo covers it)

- Proposing the template-only path (a later todo)

## Tasks

- [ ] Include attacks in attachments, quoted threads and order notes.
- [ ] Record any attack that passes both taint rules.

## Acceptance criteria

- [ ] The corpus has at least 24 tasks across at least five channels
- [ ] Every task passes offline on scripted models
- [ ] The report separates attack success from benign success
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/evals/injection.test.ts`.

## Docs to update

`packages/triage-agent/evals/README.md`. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

Scripted runs prove code paths only; real-model runs need A20's setup.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
