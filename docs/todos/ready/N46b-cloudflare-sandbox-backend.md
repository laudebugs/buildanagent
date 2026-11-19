# N46b: Cloudflare Sandbox backend and per-host outbound interception egress

| Field | Value |
| --- | --- |
| ID | `N46b` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N45](N45-portability-conformance-suite.md), [S10](S10-cloudflare-sandbox-egress.md) |
| Size | M |

## Goal

Implement the Cloudflare side of the portable seams and pass the N45 conformance suite, so our harness runs on Cloudflare as ADR 0033 requires.

> **Blocked on the owner's decision after S10.** `@cloudflare/sandbox` 1.0 removed `allowedHosts` and `outboundByHost`, and HTTPS egress without interception fails. S10 tests the replacement on a real sandbox and drafts an ADR; this todo starts once the owner has accepted or rejected it.

## Context

- [Portable agents report, sandboxes](../../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first): Cloudflare Sandbox's egress model.
- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the target table.
- [S10](S10-cloudflare-sandbox-egress.md): the measured egress behaviour of Sandbox SDK 1.0 and the owner's decision on interception.
- [Cloudflare Containers, outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/) and [the Durable Object Container API migration](https://developers.cloudflare.com/containers/guides/migrate-to-durable-object-container-api/): the 1.0 API, as of November 2026.

## Scope

**In scope**

- A `SandboxClient` on `@cloudflare/sandbox` 1.0.3 and the Durable Object Container API
- `EgressPolicy` compiled to internet off plus per-host `interceptOutboundHttp()` and `interceptOutboundHttps()` handlers that add credentials outside the sandbox. The final design follows S10's findings and the owner's ADR decision, including the CA trust step for HTTPS and the 128-intercept-entry limit
- N45's egress cases (non-allowlisted host, loopback, metadata addresses) on this backend

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

History: plan review 2 (2026-11-19) retargeted this todo from the removed `allowedHosts` and `outboundByHost` to the Durable Object Container API and added S10 to **Depends on** (owner: "Research it first").

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
