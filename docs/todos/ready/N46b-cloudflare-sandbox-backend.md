# N46b: Cloudflare Sandbox backend and `outboundByHost` egress

| Field | Value |
| --- | --- |
| ID | `N46b` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N45](N45-portability-conformance-suite.md) |
| Size | M |

## Goal

Implement the Cloudflare side of the portable seams and pass the N45 conformance suite, so our harness runs on Cloudflare as ADR 0033 requires.

## Context

- [Portable agents report, sandboxes](../../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first): Cloudflare Sandbox's egress model.
- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the target table.

## Scope

**In scope**

- A `SandboxClient` on `@cloudflare/sandbox`
- `EgressPolicy` compiled to `enableInternet = false`, `allowedHosts` and an `outboundByHost` handler that adds credentials outside the sandbox

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

Cloudflare Sandbox can be driven only from Workers; its cold start is unmeasured until N49.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
