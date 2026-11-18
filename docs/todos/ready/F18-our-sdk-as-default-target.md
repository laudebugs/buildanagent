# F18: Our SDK and harness as the default generation target on all three clouds

| Field | Value |
| --- | --- |
| ID | `F18` |
| Status | `ready` |
| Plan | [Build agent platform §5.3](../../plans/build-agent-platform.md#53-stage-f-c-is-m9-aws-and-our-own-sdk) |
| Round / milestone | Round F (build the agent platform), M9 |
| Depends on | [F16](F16-platform-v1-end-to-end.md), [B20](B20-versioning-docs.md), [N45](N45-portability-conformance-suite.md) |
| Size | L |

## Goal

Once our SDK and harness ship, make them the default generation target on Cloudflare, AWS and Vercel (PF2).

## Context

- [ADR 0038](../../decisions/0038-generated-agent-sdk-policy.md).
- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the three targets.

## Scope

**In scope**

- A template on our SDK and harness
- Gate support for our packages' types and scripted model
- The default switch, with third-party templates kept

**Out of scope**

- New third-party SDKs

## Tasks

- [ ] Write the template from our SDK's docs and skill.
- [ ] Point the gate at our pinned packages.
- [ ] Switch the default and keep the other templates selectable.

## Acceptance criteria

- [ ] The sample agent passes the gate on all three targets.

## Tests

Sample agents and gate runs in CI.

## Docs to update

The roadmap's M9 row.

## Risks and open questions

Depends on M5 and M6 shipping.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
