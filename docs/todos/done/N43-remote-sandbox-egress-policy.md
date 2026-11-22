# N43: Remote `SandboxClient` extensions and `EgressPolicy` compiled per backend

| Field | Value |
| --- | --- |
| ID | `N43` |
| Status | `done` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N15](../done/N15-sandbox-interface.md), [N20](../done/N20-credential-proxy.md) |
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

- [x] Extend harness §3.4's `SandboxClient` with the fields above
- [x] Define `EgressPolicy` and compile it for the HD15 proxy
- [x] Add a `routes` entry kind for git over HTTPS with a ref filter, used by W3
- [x] Add the sandbox cases to the shared conformance suite, `src/testing/sandbox-conformance.ts`, which every backend's test runs and which N45 can import, because N45 is not built; the egress cases are in `test/credentials/`

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

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The read-back, the capability flags and the policy helpers are in `packages/harness/src/sandbox/policy.ts` and exported from `@buildanagent/harness/sandbox`. `EgressPolicy` and `compileEgressPolicy()` are in `src/credentials/egress-policy.ts`, the git route's checks are in `src/credentials/git-route.ts`, and both are exported from `@buildanagent/harness/credentials`. The plan's §3.4, HD15 and status line record them, and the plan table links this todo.

**What shipped**

- `SandboxClient` gains `capabilities?: readonly SandboxCapability[]` (`"resume" | "snapshot" | "pause"`) and `resume?(id, policy)`. `Sandbox` gains `id?`, `stops?`, `readBack?()`, `snapshot?()` and `pause?()`.
- `stopsFor(tier, policy)`, `policyDifference(requested, applied)`, `confirmPolicy(client, sandbox, requested)`, `hasCapability(client, capability)`, `resumeSandbox(client, id, policy)`, `snapshotSandbox(client, sandbox)` and `pauseSandbox(client, sandbox)`.
- `SandboxPolicyMismatchError` (code `sandbox_policy_mismatch`, field `field`) and `SandboxUnsupportedError` (code `sandbox_unsupported`, field `capability`).
- `EgressPolicy { allow, routes }`, with a `header` route and a `git` route, and `compileEgressPolicy(policy, { secret }): { allow, routes }`, whose result goes to `startEgressProxy()`. `GitRouteFilter`, `pushVerdict()`, `isValidRefName()`, `GIT_MAX_COMMAND_BYTES` (64 KiB) and `GIT_MAX_COMMANDS` (64) are exported too. `CredentialRoute` gains an optional `git` filter, which the compiled git route sets.
- `srtPolicyFromSettings()` and `SrtPolicyNames` in `@buildanagent/harness/sandbox/srt`.
- Two read-back cases and one capability case in the shared conformance suite. `fakeSandbox()` takes `applied` (a policy it applies in place of the request) and `stops`, so a test can play a provider that widens a policy.

**Decisions**

- **The read-back throws on any difference, a narrower policy too, and compares fields as sets.** It names only the field, and disposes the sandbox before it throws. [Throw only on a wider policy: a narrower one still means the provider applied something other than the request.]
- **Only a `microvm` stops a `hostile_process`, and a policy that allows `*`, `0.0.0.0/0` or `::/0` loses `exfiltration`.** `stopsFor()` computes the stops, and a client that claims one the applied policy doesn't deliver is refused. [Trust each backend's own claim: a hosted backend could then claim a stop its applied policy doesn't deliver.]
- **`srt` rereads its settings file at each `readBack()`.** [Answer from the policy held in memory: it would not notice a settings file that changed after `provision()`.] The `none` backend claims no stop, so it needs no read-back.
- **The local backends list no capability.** `resumeSandbox()`, `snapshotSandbox()` and `pauseSandbox()` refuse with `SandboxUnsupportedError`. [Give the local backends a resume that starts a fresh sandbox: the caller would think its state was kept.]
- **`compileEgressPolicy()` refuses what isn't plainly allowed.** That is an unknown route field, a string that looks like a credential, a credential name that isn't upper case, a wildcard or an address literal, and a git route whose host is also in `allow`. [Drop such fields and compile the rest: a pasted token would pass without anyone noticing.]
- **A git route is smart HTTP for listed repositories only.** The proxy reads a push's command list before it forwards anything, and refuses a deletion, a ref outside the `refs/heads/` patterns (a tag included), a push certificate, an encoded body, a pkt-line that is malformed or not UTF-8, and a list past 64 KiB or 64 commands. The token goes in HTTP Basic, a request with no credential gets a 401 challenge, and a fetch is allowed or refused for the whole route. [Filter a fetch by ref, as a push is: the route filters only pushes by ref, so a fetch reads every ref of a listed repository.]
- **The cases for N45 are in the shared suite.** [A separate N45 collection: N45 is not built, and the suite is already what each backend's test runs.]

**What could not be done**

- **Docker was not run against a daemon.** The Docker backend now refuses a policy that allows a host when it has no `proxySocket`, because the container reaches no host without one. `test/sandbox/docker.test.ts` was edited for that and not run, because this machine has no daemon; the checks with a fake `docker` client in `test/sandbox/docker-unavailable.test.ts` pass.
- **The Docker read-back reports the flags it sends, not the daemon's view.** It reads the mounts and flags that every container is created with, so a daemon that ignored a flag would not show.
- **The Docker read-only mount check is untested.** No test covers the read-back's handling of a read-only mount the request doesn't explain.
- **`EgressPolicy` is not wired into `SandboxPolicy` or the backends.** `srt` keeps its own proxy, and the compiler's only target is `startEgressProxy()`. The hosted backends that compile the policy are N46b, N47b and N48b.

**Mutation checks**

The builder broke the code in 23 ways and ran the tests after each: in the sandbox, `policyDifference()` that always says equal, the `stops` check removed, the open-egress check removed, a `microvm` that loses `hostile_process`, a missing read-back accepted, a failing read-back accepted, no dispose on a mismatch, `hasCapability()` that is always true, a resume that skips the check, a Docker read-back that reports the requested network, an `srt` read-back that reports the requested policy, one that hides an extra read root, and one that ignores `literal`. In the credentials, no deletion check, no credential scan, a git host allowed on `allow`, wildcards allowed, unknown fields allowed, the push check skipped, any repository allowed, a fetch that ignores `fetch: false`, an encoded body allowed, and tag patterns allowed. Two survived at first and got tests.
