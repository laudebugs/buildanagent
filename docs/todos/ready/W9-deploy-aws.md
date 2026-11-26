# W9: The coding agent on AWS

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `W9` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [W8](W8-cloud-mode-evals.md), [N47a](../done/N47a-aws-state-adapters.md), [N47b](../done/N47b-e2b-sandbox-backend.md) |
| Size | M |

## Goal

Deploy the same coding agent on AWS with N47's adapters, proving the second target ADR 0033 requires.

## Context

- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the target table.

## Scope

**In scope**

- Runner on Lambda with EventBridge Scheduler wakes
- E2B sandboxes
- The control plane behind a function URL

**Out of scope**

- GCP and Azure

## Tasks

- [ ] Package the runner for Lambda
- [ ] Wire the AWS adapters
- [ ] Run W8's suite once on AWS

## Acceptance criteria

- [ ] One end-to-end task on the owner's AWS account opens a draft pull request
- [ ] W8's report gains an AWS row

## Tests

Opt-in live run.

## Docs to update

Deployment README.

## Risks and open questions

Lambda's 900 s limit forces step-per-wake.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
