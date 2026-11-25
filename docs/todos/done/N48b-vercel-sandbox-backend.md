# N48b: Vercel Sandbox backend and firewall `transform`

| Field | Value |
| --- | --- |
| ID | `N48b` |
| Status | `done` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N45](N45-portability-conformance-suite.md) |
| Size | M |

## Goal

Implement the Vercel side of the portable seams and pass the N45 conformance suite, so our harness runs on Vercel as ADR 0033 requires.

## Context

- [Portable agents report, sandboxes](../../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first): Vercel Sandbox's firewall model.
- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the target table.

## Scope

**In scope**

- A `SandboxClient` on `@vercel/sandbox`, pinned to 3.9.1 under the one-week rule
- `EgressPolicy` compiled to a firewall policy with `transform` credential injection
- A policy check that rejects `subnets.allow`, which bypasses brokering

**Out of scope**

- The coding agent's deployment (W4, W9, W10)

## Tasks

- [x] Implement each item behind the existing interfaces
- [x] Run N45 against an emulator or recorded HTTP exchanges offline (an in-process fake of `@vercel/sandbox`, `test/sandbox/fake-vercel.ts`)
- [x] Add an opt-in live run that uses the owner's account and is never part of CI (`scripts/vercel-live.ts`)
- [x] Pin every new dependency exactly, at least a week old (`@vercel/sandbox` 3.9.1, 2026-10-28)

## Acceptance criteria

- [x] N45 passes offline for every new implementation (the sandbox and egress seams; only the process-tree case skips)
- [ ] The opt-in live run is documented and passes once on the owner's account (documented in the harness README; not run, because the build session can't reach vercel.com and has no Vercel account: the owner runs it)

## Tests

N45 offline; live mode opt-in.

## Docs to update

Harness plan §4 stage 8 table; README of the new adapter.

## Risks and open questions

The pin is a major version behind 4.0.0, which was also more than a week old when this todo was built (2026-11-12); the scope pins 3.9.1, and the upgrade is a later todo.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`vercelSandbox()` is in `packages/harness/src/sandbox/vercel/` and exported from the new subpath `@buildanagent/harness/sandbox/vercel`, with `@vercel/sandbox` 3.9.1 as an optional peer that only `sdk.ts` imports by value. The harness README's Vercel section describes it, the fact-check log is [fact-check-vercel-sandbox.md](../../plans/reviews/fact-check-vercel-sandbox.md), and the harness plan's §3.1 exports list and stage 8 table link it.

**What shipped**

- `vercelSandbox({ sdk?, egress?, secret?, deniedSubnets?, timeoutMs?, persistent?, image?, vcpus?, name? })`: tier `microvm`, stops `mistakes`, `exfiltration` and `hostile_process`, capabilities `resume` and `snapshot`, plus `pause` when `persistent` is set.
- `vercelSandboxSdk(credentials?)`, the real client, and the `VercelSandboxSdk`, `VercelSandboxInstance`, `VercelCommand`, `VercelFinishedCommand`, `VercelRunParams`, `VercelCreateParams` and `VercelCredentials` types, so a test passes a fake.
- `checkVercelNetworkPolicy(policy)`, `VERCEL_DENIED_SUBNETS` and `VercelSecretError` (code `egress_secret_unresolved`, field `credential`), a new code in `HarnessErrorCode`.
- `scripts/vercel-live.ts` (`pnpm --filter @buildanagent/harness live:vercel-sandbox`), which does nothing unless `HARNESS_VERCEL_LIVE=1`.

**Decisions**

- **By default the sandbox holds no credential and needs none.** Authenticated work runs as host-side tools behind the permission pipeline ([ADR 0036](../../decisions/0036-loop-outside-sandbox-and-pr-approval.md)). An `EgressPolicy` with no credential route calls no `secret()`, sends Vercel no secret and injects nothing, and a test checks it. Vercel's `transform` injection is a narrow opt-in that only a credential route turns on, for scoped, revocable or short-lived, low-value tokens, with review rather than code enforcing that limit (the owner's decision of 2026-11-25, ADR 0060). Its costs are in the README: Vercel's firewall intercepts TLS to the route's host with a per-sandbox CA in the VM's trust store, Vercel's proxy holds the secret and sees plaintext to that host, the host reads the secret at each provision and resume, and an echoing host hands it back. ADR 0020's no-interception rule stays for our local proxy and the local backends; Cloudflare's N46b and N50 wait on a separate ruling.
- **The `SandboxPolicy`'s `network.allow` is the whole allowlist, and `egress` must name the same hosts.** A route can't add a host the policy didn't ask for. [Add route hosts to the firewall on top of `network.allow`: the read-back would then report hosts the request never named.]
- **The secret resolves with the header's whole value.** The firewall sets a header, where the local proxy swaps a placeholder inside one. [Format it as `Bearer <token>`: a guess that is wrong for `x-api-key` and Basic.]
- **A git route, a port, an upper-case host and two routes on one host are refused.** The firewall can't read git's ref list or a port, and applies the first matching rule. [Compile a git route as a header route: a push could go to any branch.]
- **A route-only host takes only the route's methods**, through a trailing 403 `response` rule, as the local proxy's routes do; a host also in `allow` passes other methods with no credential. The route's rule also pins `host`, which Vercel's firewall page recommends against domain fronting.
- **The firewall also denies loopback, private, shared and link-local ranges.** [Rely on the domain allowlist alone: an allowed name that resolves to 169.254.169.254 would be reached.]
- **The roots are checked on the file calls and the working directory, with each path resolved in the VM.** A command can still touch the whole VM, which holds nothing of the host's, so `mistakes` is claimed for the host's files.
- **Every command, variable, path and file is scanned for each credential value and its bare token, and output and file reads are scrubbed.** [Trust the firewall alone: an echoing service hands the credential to the sandbox, and the log would keep it.]
- **Dispose deletes without stopping first, because a persistent sandbox's stop saves a snapshot that outlives the delete; a failed provision deletes too, even after a create that failed once Vercel had made the sandbox.** A resume by name never deletes on a mismatch, as `resumeSandbox()` requires.

**Mutation checks.** The builder broke 16 rules one at a time and ran `test/sandbox/vercel.test.ts` after each; every mutation failed between 1 and 13 tests: no secret scan, no delete on dispose, no output scrub, no file-read redaction, `"allow-all"` for an empty policy, no subnet check, no credential-rule check, no 403 rule, no cleanup after a failed create, no dispose after a failed provision, no real-path check, no kill on dispose, no host-set check, git routes allowed, and no `-i` on `env`.

**What could not be done**

- **The live run was not run.** vercel.com is unreachable from the build session, which has no Vercel account. The owner runs `HARNESS_VERCEL_LIVE=1 pnpm --filter @buildanagent/harness live:vercel-sandbox` once, and ticks the second acceptance box when it passes.
- **Four claims stay ⚠️** in the fact-check log after it was settled against Vercel's docs: that the denied ranges leave DNS and allowed hosts working, that a `SIGKILL` ends a command's children, that the default image has `curl`, and the sandbox name rule. The live run checks the first three.
- **The process-tree conformance case skips**, because the fake can't fork and the host can't see the VM's processes.
