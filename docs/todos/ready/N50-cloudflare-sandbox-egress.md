# N50: Verify Cloudflare Sandbox 1.0 egress on a real sandbox before N46b picks a design

> **Narrowed (owner, 2026-11-25, [ADR 0060](../../decisions/0060-sandboxes-hold-no-credentials-by-default.md)).** A sandbox holds no credentials by default, and provider-side injection is a narrow opt-in. The owner's ruling that this todo prepares therefore covers TLS interception for the opt-in credential route only. Case (a) still matters most: if plain allowlisted HTTPS, such as `npm install`, fails without interception, the default itself needs a ruling on Cloudflare.

| Field | Value |
| --- | --- |
| ID | `N50` |
| Status | `ready` |
| Plan | [Build harness §4.8](../../plans/build-harness.md#48-stage-8-makes-the-harness-portable-to-cloudflare-aws-and-vercel-added-2026-11-18) |
| Round / milestone | Round N (build harness, stage 8: portability; a verification todo added in plan review 2), M6 |
| Depends on | None |
| Size | M |

## Goal

On a real Cloudflare sandbox, find out how an allowlisted HTTPS request can leave the sandbox and how a host outside it can add a credential, so N46b builds on measured behaviour rather than on docs that changed under it. As written, N46b compiles `EgressPolicy` to `enableInternet = false`, `allowedHosts` and `outboundByHost`. `@cloudflare/sandbox` 1.0 removed those options, and even on 0.x every HTTPS request failed with internet off and no interception. The owner chose to measure before building (2026-11-19, "Research it first"). This todo produces the evidence and a proposed ADR; the owner decides.

## Context

- [Browser-use fact-check](../../research/browser-use/fact-check-browser-use.md), rows 112, 114 and 117: on SDK 0.x, outbound rules apply to HTTPS only with `interceptHttps`, HTTPS fails while `enableInternet` is `false`, and `outboundByHost` covers HTTP only.
- [Cloudflare Containers, outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/): `interceptOutboundHttp()` and `interceptOutboundHttps()`, and the container-wide rule that only intercepted traffic leaves.
- [Migrate from Sandbox SDK 0.x: outbound rules](https://developers.cloudflare.com/sandbox/sdk/migrate/outbound-traffic/): what replaced `outbound`, `outboundByHost`, `allowedHosts` and `interceptHttps` in 1.0.
- [ADR 0020](../../decisions/0020-default-sandbox-backend.md) and [HD15](../../plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls): our current "no TLS interception" rule, which this todo may propose to change for the Cloudflare backend only.
- [N46b](N46b-cloudflare-sandbox-backend.md): the backend that waits for this todo and the owner's decision.
- [ADR 0060](../../decisions/0060-sandboxes-hold-no-credentials-by-default.md): no credentials in a sandbox by default, and provider-side injection only as a narrow opt-in, which narrows the proposed ADR below to that opt-in.

## Scope

**In scope**

Tests against `@cloudflare/sandbox` 1.0.3 and the Durable Object Container API, on a real sandbox:
- (a) Whether HTTPS to an allowlisted host works with internet off and no interception. We expect it to fail.
- (b) Whether per-host `interceptOutboundHttps()` works, with the credential added in the intercept handler outside the sandbox, and the interception CA installed in the sandbox's trust stores for npm, git, curl and Node.
- (c) Whether a denied host fails closed.
- (d) Whether loopback and cloud metadata addresses, such as `169.254.169.254`, are blocked.
- (e) The 128-intercept-entry limit: what happens at entry 129, and whether one wildcard entry can stand in for many hosts.

Two outputs:
- A short findings note under `docs/research/deployment/`, with its own fact-check file.
- A proposed ADR text, for the owner to accept or reject, that would allow TLS interception on the Cloudflare backend for an opt-in credential route only, as ADR 0060 allows it on E2B and Vercel. If case (a) fails, the text also proposes how the default reaches allowlisted HTTPS hosts.

**Out of scope** (and which todo covers it)

- Building the backend (N46b)
- Accepting or numbering the ADR (the owner; the next free number is 0061 as of 2026-11-25)
- Browser traffic inside the sandbox (a later browser-use todo)

## Tasks

- [ ] Use a disposable Cloudflare account or test project, which the owner provides, for this todo alone. Use no real credentials: the injected "credential" is a dummy token checked by a test echo server.
- [ ] Pin `@cloudflare/sandbox` 1.0.3 and the Containers tooling exactly, under the one-week rule, in a scratch verify project.
- [ ] Run cases (a) to (e) and record each request, response and error verbatim.
- [ ] For (b), install the CA and check each client in turn: `npm install` from the registry, `git clone` over HTTPS, `curl`, and Node's `fetch`.
- [ ] Write the findings note and its fact-check, citing the two Cloudflare pages and fact-check rows 112, 114 and 117.
- [ ] Draft the proposed ADR text in the findings note, marked Proposed.
- [ ] Delete the test project and record that in the note.

## Acceptance criteria

- [ ] Each of cases (a) to (e) has a recorded result: pass, fail or not testable, with the evidence.
- [ ] The findings note states how N46b should compile `EgressPolicy`, and what that costs in trust-store setup per client.
- [ ] The proposed ADR text names the decision, the options and the evidence, and limits any change to the Cloudflare backend.
- [ ] No real credential was used, and the disposable project is deleted.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline (the repo-wide gate; this todo adds no package code).

## Tests

The live cases run once, by hand, against the disposable project. None runs in CI.

## Docs to update

The findings note and its fact-check under `docs/research/deployment/`, the AGENTS.md research index, and N46b's scope once the owner decides.

## Risks and open questions

- The live run costs money and needs an account; the owner provides the disposable project.
- Cloudflare may change the Container API again; record the date and versions of every result.
- The owner may reject TLS interception for Cloudflare. Then the opt-in needs another route, such as a reverse-proxy route outside the sandbox, or E2B behind `SandboxClient` (CA3), and authenticated actions stay host-side tools as ADR 0060 makes them by default.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
