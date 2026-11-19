# F17: AWS connection by cross-account role and deploy adapter

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `F17` |
| Status | `ready` |
| Plan | [Build agent platform §5.3](../../plans/build-agent-platform.md#53-stage-f-c-is-m9-aws-and-our-own-sdk) |
| Round / milestone | Round F (build the agent platform), M9 |
| Depends on | [F16](F16-platform-v1-end-to-end.md), [N47a](N47a-aws-state-adapters.md) |
| Size | M |

## Goal

Let a user connect AWS through a cross-account role with a per-tenant external ID, and deploy a gated agent into it.

## Context

- [ADR 0040](../../decisions/0040-tenant-cloud-connections-and-byok.md).
- [AWS, third-party access](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html) and [AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html).

## Scope

**In scope**

- Role setup with a generated `sts:ExternalId`
- A deploy adapter that verifies the gate report

**Out of scope**

- An AWS-native generation template (F18 uses our SDK)

## Tasks

- [ ] Generate a unique external ID per tenant.
- [ ] Give the user a trust policy that requires it.
- [ ] Assume the role per deploy and verify the gate report.

## Acceptance criteria

- [ ] A role without the external ID condition is refused at connection time.

## Tests

Tests against recorded STS and deploy exchanges.

## Docs to update

Platform docs for AWS connection.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
