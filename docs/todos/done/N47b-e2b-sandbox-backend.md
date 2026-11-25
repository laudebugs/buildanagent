# N47b: E2B backend and egress Secrets

| Field | Value |
| --- | --- |
| ID | `N47b` |
| Status | `done` |
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

- [x] Implement each item behind the existing interfaces
- [x] Run N45 against an emulator or recorded HTTP exchanges offline
- [x] Add an opt-in live run that uses the owner's account and is never part of CI
- [x] Pin every new dependency exactly, at least a week old

## Acceptance criteria

- [x] N45 passes offline for every new implementation
- [ ] The opt-in live run is documented and passes once on the owner's account (documented in the harness README and `test/live/e2b-live.ts`; not run, because this session has no E2B account or network to E2B, so the owner runs it once)

## Tests

N45 offline; live mode opt-in.

## Docs to update

Harness plan §4 stage 8 table; README of the new adapter.

## Risks and open questions

E2B injects into every process that calls an allowed host, so method scoping needs our own proxy through BYOP.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/harness/sandbox/e2b` adds the E2B backend, whose sandboxes hold no credentials by default, and the harness README's E2B section documents it. The plan's §3.1 entry list, its dependencies paragraph and a "Built by N47b" note record it, and [the fact-check log](../../plans/reviews/fact-check-e2b-backend.md) checks every claim about E2B against `e2b` 2.63.0's declarations and source and E2B's docs.

**What shipped**

- `e2bSandbox(options)`: a `microvm` `SandboxClient` that claims `mistakes`, `exfiltration` and `hostile_process` and lists `resume` and `pause`. It takes the SDK as `sdk` (`{ Sandbox, Secret }` from `e2b`, or a loader) and otherwise imports `e2b` on first use. `e2b` 2.63.0 is an optional peer and a dev dependency, and the module imports no Node module.
- `compileE2BEgress(policy, { fill, secretName?, schemes?, unscopedInjection? })`: an `EgressPolicy` compiled to `allowOut` (exactly `allow` plus route hosts), `denyOut: ["0.0.0.0/0"]`, `dnsServers: []`, `allowPublicTraffic: false` and one header rule per host holding `Secret.fill()` placeholders.
- `SandboxSecretUnresolvedError` (code `sandbox_secret_unresolved`, fields `backend`, `secret`, `credential`) in `./sandbox`, thrown before any sandbox is created or woken when `Secret.exists()` says a named secret is missing.
- A read-back from `getInfo()` that reports open egress, DNS servers, extra deny entries, extra or literal rules, a SOCKS5 proxy and public URLs as a mismatch; a metadata label and sweep that kills a sandbox a lost create reply left; a kill retried three times on dispose; a pause that kills running commands first; a resume that checks the secrets and the recorded root before it reconnects.
- `test/sandbox/e2b.test.ts` runs the sandbox and egress conformance suites and the portability suite's sandbox and egress seams against an in-process fake of the SDK (`test/sandbox/fake-e2b.ts`), plus escape tests for each rule; `test/sandbox/e2b-types.test.ts` checks that the real SDK fits the structural type. `pnpm --filter @buildanagent/harness e2b:live` runs `test/live/e2b-live.ts` on a real account.

**Decisions**

- **The backend uses E2B-stored Secrets and never holds a value.** [Resolve each credential on the host and send its value in the rule: E2B accepts plain header values, but the value would then pass through our process and E2B's sandbox configuration.]
- **Every route needs `unscopedInjection: true`, and git routes are refused.** E2B injects on every method, path and process, and can't filter refs. [Accept the routes silently: the method list would look enforced when it isn't.]
- **`dnsServers` is always empty.** E2B opens every port of a listed DNS server. [Keep E2B's default `8.8.8.8`: a DNS channel and an open IP outside the policy.]
- **`network.allow` must be exact lower-case names with no port, and `network.deny` must be empty.** [Pass entries through: E2B would widen a wildcard, match names on 80 and 443 only, and let an allow beat a deny.]
- **The client claims `hostile_process`, following `stopsFor()`.** ADR 0020's "no backend claims to stop a hostile process" was written for the local backends; N43 made a `microvm` the one tier that delivers it.
- **By default the sandbox holds no credentials.** Authenticated work runs in host-side tools behind the permission pipeline ([ADR 0036](../../decisions/0036-loop-outside-sandbox-and-pr-approval.md)). An `EgressPolicy` with no routes creates no rule and calls no secrets API, and a test checks it.
- **Provider-side injection is a narrow opt-in.** The owner decided on 2026-11-25 (ADR 0060, in [`docs/decisions/`](../../decisions/)) that a credential route is for scoped, revocable or short-lived, low-value tokens only, enforced by documentation and review, not by code. Its costs: injection reaches every method, path and process; E2B holds the secret; E2B intercepts TLS, so its proxy sees the plaintext to the allowed host and the sandbox's trust store carries its CA; and a secret deleted after the check is dropped silently. ADR 0020's no-interception rule still holds for our own proxy and the local backends.
- **Every sandbox is private.** The backend sends `allowPublicTraffic: false` and its read-back refuses a sandbox E2B doesn't report as private, because a public sandbox's URL lets anyone reach a server inside it (found in the first code review).
- **The roots are enforced by path on file calls, and recorded in the sandbox's metadata for a resume.** [Resolve real paths in the VM: a round trip per call, for a boundary that stays inside the VM.]

**What could not be done**

- **The live run was not run.** This session had no E2B account and no network to E2B, so the second acceptance box stays open until the owner runs `pnpm --filter @buildanagent/harness e2b:live` once.
- **Six claims are unverified** (fact-check rows N47b-15, N47b-16, N47b-32, N47b-33, N47b-35 and N47b-41), among them whether `getInfo()` reports an empty `dnsServers` and a private sandbox's `allowPublicTraffic`, and whether killing a command's process group ends what it started. No E2B page settles them; the live run checks all but N47b-35.
- **The symlink and process-tree conformance cases skip on the fake**, which has neither; the live run includes the process-tree case.
