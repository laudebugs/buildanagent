# F6: Generation templates for Cloudflare `agents` and the AI SDK

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `F6` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F3](F3-gate-type-check-and-mock-tests.md), [F5](F5-agent-safety-package.md) |
| Size | M |

## Goal

Write one generation template per target: project layout, safety-package wiring, test and eval scaffolding, graders, and instructions taken from the verified skill.

## Context

- [PF2](../../plans/build-agent-platform.md#pf2-our-sdk-by-default-once-it-ships-plus-verified-third-party-sdks-accepted) and [ADR 0038](../../decisions/0038-generated-agent-sdk-policy.md).
- [Cloudflare skill](../../../.agents/skills/cloudflare-agents/SKILL.md) and [Vercel AI SDK skill](../../../.agents/skills/vercel-ai-sdk/SKILL.md).

## Scope

**In scope**

- A template for `agents` 0.33.0 and one for `ai` 7.0.162
- Graders for each template's agent shape: a tool-using agent with approval-gated writes
- An explicit approval policy in every template: the template sets it, never the SDK's default. The safety package carries the tool pins and the tool tiers that the policy reads ([agent connectors report](../../research/connectors/agent-connectors.md), plan-change item 10; plan review 2, 2026-11-19)

**Out of scope**

- The task type that uses the templates (F12)

## Tasks

- [ ] Write each template's project skeleton with the safety package wired in.
- [ ] Write the generator's instructions from the verified skill, pinned to the same versions.
- [ ] Write graders for approval behaviour, refused writes and outcome reporting.
- [ ] Check a hand-written sample agent from each template through the gate (F3, F4).

## Acceptance criteria

- [ ] Each template's sample agent passes the gate.
- [ ] A sample that skips the approval gate fails a grader.

## Tests

The sample agents and their gate runs in CI.

## Docs to update

The plan's §5.1 table.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
