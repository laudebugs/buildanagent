# W5: Control-plane Worker and the ingress design

| Field | Value |
| --- | --- |
| ID | `W5` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [W4](W4-durable-object-task-runner.md) |
| Size | M |

## Goal

Accept task requests from the CLI and from GitHub, deduplicate them at least once, and start the task runner; this is the ingress design CA7 shares with the deferred triage agent.

## Context

- [12-factor report](../../research/external-designs/twelve-factor-agents.md#five-small-changes-follow-led-by-an-ingress-design): the ingress gap.
- [Plan CA7](../../plans/build-coding-agent.md#ca7-triggers-start-with-the-cli-and-github-webhooks-behind-one-ingress-design-decided): the decision.

## Scope

**In scope**

- A Worker with a task-create endpoint for the CLI
- GitHub webhook handling with signature checks, an owner-only sender check and hidden-HTML stripping
- Deduplication by request id

**Out of scope**

- Slack and schedule triggers

## Tasks

- [ ] Write the ingress design as a short section in the plan
- [ ] Implement the endpoint and webhook handler
- [ ] Store request ids in the task's object for deduplication

## Acceptance criteria

- [ ] A redelivered webhook starts one task
- [ ] A webhook from another user is rejected

## Tests

Offline tests with recorded webhook payloads.

## Docs to update

Plan CA7; package README.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
