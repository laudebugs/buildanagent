# W10: The coding agent on Vercel

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `W10` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [W8](W8-cloud-mode-evals.md), [N48a](../done/N48a-vercel-state-adapters.md), [N48b](../done/N48b-vercel-sandbox-backend.md) |
| Size | M |

## Goal

Deploy the same coding agent on Vercel with N48's adapters, proving the third target ADR 0033 requires.

## Context

- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the target table.

## Scope

**In scope**

- Runner in a Vercel Workflow, one step per `continueRun`
- Vercel Sandbox
- The control plane as a Vercel Function

**Out of scope**

- GCP and Azure

## Tasks

- [ ] Package the runner as a workflow
- [ ] Wire the Vercel adapters
- [ ] Run W8's suite once on Vercel

## Acceptance criteria

- [ ] One end-to-end task on the owner's Vercel account opens a draft pull request
- [ ] W8's report gains a Vercel row

## Tests

Opt-in live run.

## Docs to update

Deployment README.

## Risks and open questions

Vercel's BYOK fallback does not apply: the model key goes direct, not through Vercel's AI Gateway.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
