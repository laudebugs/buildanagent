# N20: Credential proxy: default-deny egress, sentinel routes, gated fetch, secret scrub

| Field | Value |
| --- | --- |
| ID | `N20` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-adds-the-sandbox-backends-and-the-credential-proxy) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N15](../done/N15-sandbox-interface.md) |
| Size | M |

## Goal

Keep every credential outside the sandbox: a host-side, default-deny egress proxy that logs each request, injects host-scoped credentials on local routes by sentinel, gates in-process fetch with the same allowlist, and scrubs secrets from entries.

## Context

- [HD15](../../plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls): the decision and its evidence
- [harness guide §6](../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both): credential boundary, sentinels, private-range refusal, in-process fetch bypass
- [build-harness.md §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis): the API sketch

## Scope

**In scope**

- `startEgressProxy({ allow, routes, log })` on `127.0.0.1`
- `CONNECT` only to allowlisted names whose resolved addresses are outside loopback, link-local, private and metadata ranges
- Credential routes: sentinel match, method check, header injection, forward over HTTPS
- `EgressProxy.fetch` for in-process tools
- `scrubSecrets()` applied before every append. When hosted-browser, CDP or OAuth connector tools exist, it also covers their tokens and session URLs (plan review 2, 2026-11-19)
- An egress log entry per request (host, method, status, bytes), never headers

**Out of scope** (and which todo covers it)

- TLS interception (deferred, §1)
- The `fetch` built-in tool (N21)

## Tasks

- [ ] Test against a local HTTPS server with a self-signed certificate trusted only in the test.
- [ ] Resolve names in the proxy, not in the sandbox, and check every resolved address.

## Acceptance criteria

- [ ] A request to a name not on the allowlist gets 403 and a log line
- [ ] An allowed name resolving to `127.0.0.1` or `169.254.169.254` is refused
- [ ] A route request with the right sentinel and method reaches the upstream with the real header; a wrong method is refused
- [ ] The real secret never appears in the sandbox's environment, any entry or any log line
- [ ] `EgressProxy.fetch` refuses a non-allowlisted host
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/credentials/proxy.test.ts`, `scrub.test.ts`.

## Docs to update

`packages/harness/README.md`: the credential boundary and its limit (an allowed credential can still act). The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

DNS rebinding between check and connect; connect to the checked address, not the name.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
