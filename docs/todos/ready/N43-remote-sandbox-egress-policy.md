# N43: Remote `SandboxClient` extensions and `EgressPolicy` compiled per backend

| Field | Value |
| --- | --- |
| ID | `N43` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N15](../done/N15-sandbox-interface.md), [N20](N20-credential-proxy.md) |
| Size | M |

## Goal

Give `SandboxClient` what hosted backends need, and replace the loopback proxy URL with a policy each backend compiles, which are U11 changes 8 and 9.

## Context

- [Portable agents report, sandboxes](../../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first): the per-provider egress and injection models.
- [Harness plan, HD15](../../plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls): the current proxy.

## Scope

**In scope**

- `resume(id)`, `snapshot` and `pause` capability flags
- `stops` computed from the applied policy
- post-provision policy read-back that throws on a mismatch
- `EgressPolicy { allow, routes }` and a local compiler targeting the HD15 proxy

**Out of scope**

- The hosted backends themselves (N46b, N47b, N48b)

## Tasks

- [ ] Extend harness §3.4's `SandboxClient` with the fields above
- [ ] Define `EgressPolicy` and compile it for the HD15 proxy
- [ ] Add a `routes` entry kind for git over HTTPS with a ref filter, used by W3
- [ ] Add sandbox and egress cases to N45's collection

## Acceptance criteria

- [ ] The `none`, `srt` and Docker backends pass the extended conformance suite
- [ ] `pnpm test` passes offline

## Tests

Conformance cases: network denied unless allowlisted, credentials absent from the sandbox environment, read-back mismatch throws.

## Docs to update

Harness plan §3.4 and HD15.

## Risks and open questions

Each vendor reports denials differently; the typed denial may need per-backend mapping.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
