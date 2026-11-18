# N47b: E2B backend and egress Secrets

| Field | Value |
| --- | --- |
| ID | `N47b` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N45](N45-portability-conformance-suite.md) |
| Size | M |

## Goal

Implement the E2B (used on AWS, and as Cloudflare's swap) side of the portable seams and pass the N45 conformance suite, so our harness runs on E2B (used on AWS, and as Cloudflare's swap) as ADR 0033 requires.

## Context

- [Portable agents report, sandboxes](../../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first): E2B's egress and injection model and its scope gaps.
- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the target table.

## Scope

**In scope**

- A `SandboxClient` on `e2b`, pinned to 2.63.0 under the one-week rule
- `EgressPolicy` compiled to `allowOut` and egress-proxy Secrets, keyed on host
- A check that fails provisioning when a secret fails to resolve, since E2B silently omits it

**Out of scope**

- The coding agent's deployment (W4, W9, W10)

## Tasks

- [ ] Implement each item behind the existing interfaces
- [ ] Run N45 against an emulator or recorded HTTP exchanges offline
- [ ] Add an opt-in live run that uses the owner's account and is never part of CI
- [ ] Pin every new dependency exactly, at least a week old

## Acceptance criteria

- [ ] N45 passes offline for every new implementation
- [ ] The opt-in live run is documented and passes once on the owner's account

## Tests

N45 offline; live mode opt-in.

## Docs to update

Harness plan §4 stage 8 table; README of the new adapter.

## Risks and open questions

E2B injects into every process that calls an allowed host, so method scoping needs our own proxy through BYOP.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
