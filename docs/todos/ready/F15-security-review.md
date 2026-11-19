# F15: Security review and abuse tests before sign-ups open

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `F15` |
| Status | `ready` |
| Plan | [Build agent platform §5.2](../../plans/build-agent-platform.md#52-stage-f-b-connects-the-engine-and-ships-m8) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F12](F12-build-agent-task.md), [F9](F9-byok.md), [F13](F13-quotas-and-metering.md), [F14](F14-audit-log-and-retention.md) |
| Size | M |

## Goal

Attack the platform before anyone outside signs up: sandbox escape, egress, MCP-config injection, grader access and cross-tenant reads. The MCP attack classes also cover tool poisoning, tool shadowing, rug pulls (a tool that changes after approval) and SSRF through OAuth discovery fetches ([agent connectors report](../../research/connectors/agent-connectors.md), plan-change item 11; added in plan review 2, 2026-11-19).

## Context

- [ADR 0042](../../decisions/0042-generated-code-isolation.md) and [ADR 0039](../../decisions/0039-check-and-deploy-gate.md).
- [Agent-building platforms report](../../research/deployment/agent-building-platforms.md#approvals-are-common-but-signed-approvals-and-side-effect-undo-exist-nowhere).

## Scope

**In scope**

- A written threat model
- Offline attack tests
- A fix list with owners

**Out of scope**

- A third-party penetration test (owner decision)

## Tasks

- [ ] Write the threat model from the plan's §3.
- [ ] Write attack fixtures for each class, including tool poisoning, shadowing, rug pulls and OAuth-discovery SSRF.
- [ ] Fix or record every finding before F16.

## Acceptance criteria

- [ ] Every attack fixture fails safely.
- [ ] No open high-severity finding.

## Tests

Attack fixtures in the platform's test suite.

## Docs to update

The threat model in the platform docs.

## Risks and open questions

Whether to commission an outside test is the owner's call.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
