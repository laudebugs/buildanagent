# N20: Credential proxy: default-deny egress, sentinel routes, gated fetch, secret scrub

| Field | Value |
| --- | --- |
| ID | `N20` |
| Status | `done` |
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

- [x] Test against a local HTTPS server with a self-signed certificate trusted only in the test.
- [x] Resolve names in the proxy, not in the sandbox, and check every resolved address.

## Acceptance criteria

- [x] A request to a name not on the allowlist gets 403 and a log line
- [x] An allowed name resolving to `127.0.0.1` or `169.254.169.254` is refused
- [x] A route request with the right sentinel and method reaches the upstream with the real header; a wrong method is refused
- [x] The real secret never appears in the sandbox's environment, any entry or any log line
- [x] `EgressProxy.fetch` refuses a non-allowlisted host
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/credentials/proxy.test.ts`, `scrub.test.ts`.

## Docs to update

`packages/harness/README.md`: the credential boundary and its limit (an allowed credential can still act). The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

DNS rebinding between check and connect; connect to the checked address, not the name.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`startEgressProxy()`, `scrubSecrets()` and `isPublicAddress()` in `packages/harness/src/credentials/` are the credential boundary: a default-deny egress proxy, host-scoped credential routes, a gated in-process fetch and an entry scrubber. Every acceptance criterion has a test that runs offline against a real HTTPS server.

- **Default deny, logged.** A tunnel to a name, a port or a form that isn't allowed gets 403 and a log record before any lookup. The record holds the kind, host, port, method, status, bytes and a reason, and never a header. Rows N20-1 and N20-2 in `docs/plans/reviews/fact-check-egress-proxy.md` check the proxy's behaviour against its tests.
- **Addresses are checked, and the connection is pinned.** The proxy resolves each name, refuses the request when any address is loopback, link-local (169.254.169.254 included), private, shared, multicast or reserved, and connects through a `lookup` that returns only the checked answers. A test with a resolver that changes its answer shows one lookup for each connection. The ranges come from the IANA special-purpose registries (rows N20-3 and N20-4).
- **A route swaps the sentinel for the secret.** The right sentinel and method reach the upstream with the real header. A wrong method gets 405, a wrong, missing or borrowed sentinel and an unknown route get 403, and a secret that can't be read or holds a line break gets 502. None of these sends anything upstream.
- **The secret stays on the host.** A test checks the sandbox's environment values, every log record, every response to the sandbox and a scrubbed entry for it. A service that echoes its headers back would still reveal it, which the README names as a limit.
- **In-process tools use the same gate.** `proxy.fetch` rejects with `egress_denied` for a host, a port, a literal or a plain-HTTP URL that isn't allowed, and a route URL gets the same injection.
- **A review hardened the edges.** A secret with a character Node refuses in a header is a 502 and no longer crashes the process, a tunnel whose name never resolves times out with a record, a client that disconnects takes its upstream request with it, and a response nobody reads is still logged.
- **The tests found two slips of ours.** `knownSecrets()` listed one secret twice when two routes shared it, and the first tests read log lines from the previous test's late tunnel.
- **A Unix socket works.** `socketPath` serves the same routes for `dockerSandbox`'s `proxySocket`. Nothing wires the two together yet: a program inside the container needs a bridge to speak to that socket, and the image supplies it.
- **TLS interception stays out**, as HD15 decided. The test certificate is made with `openssl` when the test runs, and `knip.jsonc` lists the binary.
