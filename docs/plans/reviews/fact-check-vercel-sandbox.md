# Fact-check: the Vercel Sandbox backend

This log checks the claims that `packages/harness/src/sandbox/vercel/`, the harness README's Vercel section, the changeset and todo N48b's outcome make on 2026-11-25. The primary source is the pinned `@vercel/sandbox` 3.9.1 package as installed in `packages/harness/node_modules/@vercel/sandbox/` (its `dist/*.d.ts` and `dist/*.js`), and the npm registry for versions and dates. vercel.com was unreachable from the build session, so a claim only Vercel's docs or a real sandbox could confirm is ⚠️, and the owner's live run (`scripts/vercel-live.ts`) is where it gets checked.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

## The package and its pin

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N48b-1 | `@vercel/sandbox` 3.9.1 was published on 2026-10-28, 4.0.0 on 2026-11-12 and 4.1.0 on 2026-11-20, so 3.9.1 is the newest release at least a week old on 2026-11-25 | ✅ | `npm view @vercel/sandbox time` on 2026-11-25 |
| N48b-2 | The package is Apache-2.0 | ✅ | `npm view @vercel/sandbox@3.9.1 license`; `LICENSE` in the installed package |
| N48b-3 | The package exports `Sandbox` and the types `NetworkPolicy`, `NetworkPolicyRule` and `NetworkTransformer` from its root entry | ✅ | `dist/index.d.ts` |
| N48b-4 | The real `Sandbox` class fits the backend's `VercelSandboxInstance` interface, so the default client and the fake are interchangeable | ✅ | `vercelSandboxSdk()` in `src/sandbox/vercel/sdk.ts` returns `Sandbox.create()` and `Sandbox.get()` as that interface, and `pnpm typecheck` passes; adding a member `Sandbox` lacks to the interface makes it fail (tried in the build session) |
| N48b-5 | A Vercel Sandbox is a Firecracker microVM | ⚠️ | vercel.com unreachable from the build session. The package's `dist/sandbox.d.ts` says "isolated Linux MicroVMs" without naming Firecracker; the [portable agents fact-check](../../research/deployment/fact-check-portable-agents.md), row 100 and the report's sandbox table cite Vercel's security page for Firecracker |

## The network policy

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N48b-6 | `Sandbox.create()` gives full internet access when `networkPolicy` is left out, so the backend always sends one | ✅ | `dist/sandbox.d.ts`, `networkPolicy`: "Defaults to full internet access if not specified" |
| N48b-7 | A policy is `"allow-all"`, `"deny-all"` or an object with `allow` (a list of domains, or a map from domain to rules) and `subnets.allow` and `subnets.deny` | ✅ | `dist/network-policy.d.ts`, `NetworkPolicy` |
| N48b-8 | A rule's `transform` sets headers on a matching request, and a rule may `match` on method, path, query string and headers | ✅ | `dist/network-policy.d.ts`, `NetworkTransformer` ("Headers to set on the outgoing request") and `NetworkPolicyMatch` |
| N48b-9 | Rules run in declaration order, a trailing `response` rule with no `match` answers whatever the earlier rules did not claim, and allowing a domain otherwise allows every request to it | ✅ | `dist/network-policy.d.ts`, `NetworkPolicyResponse` and the `response` member of `NetworkPolicyRule` |
| N48b-10 | A rule holds exactly one of `transform`, `forwardURL` and `response` | ✅ | `dist/api-client/validators.js`, `NetworkPolicyRuleValidator` refinements |
| N48b-11 | `subnets.allow` traffic bypasses the domain allowlist, and `subnets.deny` takes precedence over allowed domains and ranges | ✅ | `dist/network-policy.d.ts`: "Traffic to these addresses will bypass the domain allowlist" and "These take precedence over allowed domains and CIDRs" |
| N48b-12 | Vercel reports a sandbox's policy with each injected header's name and its value replaced by `<redacted>`, and the reported form carries no `response` rule | ✅ | `dist/utils/network-policy.js`, `fromAPINetworkPolicy()`, which builds headers from `headerNames` only; the response schema `LegacyCustomNetworkPolicyValidator` in `dist/api-client/validators.js` has `injectionRules` and `forwardRules` and no response rules |
| N48b-13 | A request that matches a `transform` rule leaves the VM with the rule's header, replacing one the process set | ⚠️ | vercel.com unreachable from the build session; the package documents only "Headers to set". The live run's echo check covers the injection, not the replacement |
| N48b-14 | The firewall matches names by TLS SNI and injects a header by intercepting TLS with a per-sandbox CA | ⚠️ | vercel.com unreachable from the build session; secondary: the [portable agents fact-check](../../research/deployment/fact-check-portable-agents.md), row 100 quotes Vercel's firewall page for both |
| N48b-15 | The firewall applies the first rule a request matches, so a second route on one host could not be told apart | ⚠️ | Our reading of "Rules run in declaration order" (row N48b-9); the backend refuses two routes on one host rather than rely on it |
| N48b-16 | The firewall ignores ports, so the backend refuses an allow entry with one | ⚠️ | Our inference: the policy's `allow` keys are domains with no port field anywhere in `dist/network-policy.d.ts`; vercel.com unreachable from the build session |
| N48b-17 | Denying the ranges in `VERCEL_DENIED_SUBNETS` doesn't stop an allowed name from resolving or being reached | ⚠️ | Our design; vercel.com unreachable from the build session. The live run's "an allowed host is reached" check runs with these ranges denied |

## Lifecycle, commands and files

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N48b-18 | `timeout` is the milliseconds before Vercel stops a sandbox on its own | ✅ | `dist/sandbox.d.ts`, `timeout`: "Timeout in milliseconds before the sandbox auto-terminates" |
| N48b-19 | `env` on `create()` sets variables every command inherits, and the backend never sets it | ✅ | `dist/sandbox.d.ts`, `env`; `createVm()` in `src/sandbox/vercel/index.ts` builds the parameters without it, and a test asserts the create call has no `env` |
| N48b-20 | `runCommand()` with `detached: true` returns a `Command` whose `wait()` resolves with the exit code, and whose `kill()` sends a signal, `SIGKILL` among them | ✅ | `dist/sandbox.d.ts` overloads, `dist/command.d.ts`, `dist/utils/resolveSignal.d.ts` |
| N48b-21 | A command's `timeoutMs` is enforced by the sandbox with `SIGKILL`, whether or not the command is awaited | ✅ | `dist/session.d.ts`, `RunCommandParamsBase.timeoutMs` |
| N48b-22 | `sudo` defaults to `false`, and the backend never sets it to `true` | ✅ | `dist/session.d.ts`, `sudo`; `VercelRunParams.sudo` is typed `false` |
| N48b-23 | `readFileToBuffer()` resolves with `null` for a missing file | ✅ | `dist/sandbox.d.ts`, `readFileToBuffer` |
| N48b-24 | `snapshot()` stops the sandbox it snapshots, and a new sandbox can start from the snapshot through `source: { type: "snapshot", snapshotId }` | ✅ | `dist/sandbox.d.ts`, `snapshot()` ("this sandbox will be stopped as part of the snapshot creation process") and `CreateSandboxParams` |
| N48b-25 | `persistent` turns on the file system's restore between sessions, and `stop()` ends the running session | ✅ | `dist/sandbox.d.ts`, `persistent` and `stop()` |
| N48b-26 | `delete()` removes the sandbox, after which the instance's calls throw | ✅ | `dist/sandbox.d.ts`, `delete()`: "After deletion the instance becomes inert" |
| N48b-27 | `update({ networkPolicy })` applies a policy to the running session | ✅ | `dist/sandbox.d.ts`, `update()`; `dist/sandbox.js` calls `session.update({ networkPolicy })` when a session is active |
| N48b-28 | Without explicit credentials, the package reads `VERCEL_OIDC_TOKEN`, which `vercel env pull` writes for a linked project | ✅ | `dist/utils/get-credentials.js`, `getCredentials()` and `LocalOidcContextError`'s message |
| N48b-29 | `Sandbox` serializes through `@workflow/serde`, so a handle that exposed it could carry its client into saved state; the backend's handle keeps it in a private field and serializes to `{ id }` | ✅ | `dist/sandbox.d.ts`, `WORKFLOW_SERIALIZE`; `toJSON()` in `src/sandbox/vercel/handle.ts` and its test |
| N48b-30 | A `SIGKILL` sent through `kill()` ends the command's children too | ⚠️ | vercel.com unreachable from the build session, and the fake can't fork; the README lists it as a limit |
| N48b-31 | The default image has `env` that takes `-i` and `--`, `realpath -m`, `mkdir -p` and `curl` | ⚠️ | vercel.com unreachable from the build session; the live run uses all four |
| N48b-32 | A sandbox name of lower-case letters, digits, `_` and `-` up to 63 characters is accepted | ⚠️ | Our own rule; the package's `validate-name.js` covers Linux user names, not sandbox names, and the API's rule is on vercel.com |

## Our code's claims

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N48b-33 | The backend passes the sandbox and egress seams of the portability suite offline, skipping only the process-tree case | ✅ | `test/sandbox/vercel.test.ts`, first test |
| N48b-34 | A policy with no host compiles to `"deny-all"`, and any other allows exactly its hosts and denies `VERCEL_DENIED_SUBNETS` | ✅ | `compileFirewall()` in `src/sandbox/vercel/firewall.ts` and the two tests under "egress is closed" |
| N48b-35 | The read-back throws on `allow-all`, `subnets.allow`, an extra or wildcard host, a dropped or extra credential rule, missing denied ranges and a missing policy, and the sandbox is deleted | ✅ | The eight tests under "the read-back catches a provider…" |
| N48b-36 | A provider that reports `"allow-all"` makes `provision()` throw with the field `network.allow` | ✏️ | The first draft of the test expected the field `stops`. `confirmPolicy()` compares the fields before it computes the stops, so `*` in the read-back differs from the request in `network.allow` first (`src/sandbox/policy.ts`); the test now expects `network.allow`, and the credential-failure test separately checks that a `VercelSecretError` has no `cause` |
| N48b-37 | Every mutation the builder tried on the security rules fails at least one test | ✅ | 16 mutations in the build session, listed in N48b's outcome; each failed between 1 and 13 tests |

**Totals:** 37 claims: 27 ✅, 1 ✏️, 9 ⚠️.
