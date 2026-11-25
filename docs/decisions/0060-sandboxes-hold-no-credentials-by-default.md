# 0060. A sandbox holds no credentials by default, and provider-side injection is a narrow opt-in on the hosted backends

- **Status:** Accepted (owner, 2026-11-25)
- **Date:** 2026-11-25
- **Plan:** [build-harness.md, HD15](../plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls), which this record extends to the hosted backends; the E2B and Vercel backends are todos N47b ([#421](https://github.com/laudebugs/buildanagent/pull/421)) and N48b ([#422](https://github.com/laudebugs/buildanagent/pull/422))

## Context

HD15 and [ADR 0020](0020-default-sandbox-backend.md) chose a local credential proxy that adds credentials on reverse-proxy routes and filters all other egress by name, with no TLS interception. [ADR 0036](0036-loop-outside-sandbox-and-pr-approval.md) keeps the loop outside the sandbox and decides that "The sandbox holds no credentials". The open question was whether the hosted backends may rely on the injection their provider ships instead of a route we run.

The two backends' pull requests checked what each provider does against its pinned package and docs:

- **E2B.** A rule's header holds the placeholder that `Secret.fill()` returns, and E2B's egress proxy swaps it for the stored secret outside the sandbox, on HTTPS to the rule's host only ([E2B fact-check][e2b-fc], row N47b-18). For that host, E2B intercepts TLS with its own CA in the sandbox's trust store (row N47b-24). It injects into every request to the host, whatever the method, path or process (row N47b-21).
- **Vercel.** A firewall `transform` rule sets a header on a matching request before it leaves the VM, and its `match` can name the method ([Vercel fact-check][vercel-fc], rows N48b-8 and N48b-13). The firewall terminates TLS, with a CA it adds to each sandbox, only for a domain with a transformation, forwarding or direct-response rule (row N48b-14). The backend reads each value on the host through `secret()` at each provision and resume, and sends it to Vercel's API ([harness README, Vercel section][vercel-readme]).

Both injectors are wider than our local routes, so the owner chose a default that needs no injection at all and kept the providers' injection as a narrow opt-in.

## Decision

**A sandbox holds no credentials and needs none.** Any authenticated action runs on the host, as a host-side tool behind the permission pipeline and its approvals. That covers a git push or a pull request with a per-task token minted outside the sandbox ([W3](../todos/ready/W3-github-app-identity.md)), an authenticated API call, a private registry and a cloud CLI. The host runs such a tool as a code-initiated call ([N40](../todos/done/N40-code-initiated-calls.md), `Harness.invokeTool()`) or as a model call, and every outward write carries an idempotency key, as ADR 0036 requires. A hosted backend compiles egress to deny-all plus exactly the policy's hosts, with no credential route unless the caller adds one.

**Provider-side injection is a narrow opt-in on E2B and Vercel.** It stays off unless the `EgressPolicy` holds a credential route. A credential route may carry only a narrow, scoped, revocable or short-lived, low-value credential, such as a repository-scoped token for one run, a read-only package-registry token or a model-API key with a spend limit. Anything that can spend money without a cap, push to a protected branch or reach production data stays host-side. Convention, documentation and review enforce this limit, not code, because a backend can't see how powerful a token is.

**The opt-in has five costs, and only the opt-in has them.**

- Each sandbox's trust store carries the provider's CA.
- The provider's proxy decrypts each request to a credentialed host, sees it in plaintext and holds the secret.
- Any matching request gets the credential, with no placeholder check. On E2B a match is any HTTPS request to the host, whatever its method or path, so the E2B backend refuses a route unless the caller sets `unscopedInjection: true`.
- A host that echoes request headers hands the credential back into the sandbox.
- On Vercel, the harness reads the secret on the host at each provision and resume and sends it to Vercel.

**Our local backends, `srt` and Docker, keep ADR 0020's rule: no TLS interception.**

This record does not decide Cloudflare, but it narrows the question. With no credentials as the default, N46b and [N50](../todos/ready/N50-cloudflare-sandbox-egress.md) need the owner's ruling on TLS interception only for the opt-in. N50 must still measure whether plain allowlisted HTTPS, such as `npm install`, works without interception on Sandbox SDK 1.0. If it doesn't, the default itself needs a ruling on Cloudflare.

Nor does this record decide what a backend may claim about stopping a hostile process. ADR 0020 says "No backend claims to stop a hostile process", yet both hosted backends report the `stops` that N43's `stopsFor()` computes, which include `hostile_process` for a microVM. This record leaves that tension open.

This record leaves ADR 0020, ADR 0034 and ADR 0036 unchanged. ADR 0034's git route keeps the token on the host. On a hosted backend, though, such a route would be a credential route, and E2B and Vercel both refuse git routes, so a push from those backends runs as a host-side tool.

## Consequences

- **Each backend README states the default and the opt-in.** The harness README's E2B and Vercel sections must say that egress is deny-all with no credential route by default. They must say that a credential route turns injection on, which credentials it may carry, and that convention, not code, enforces that limit. They must name each of the five costs as a cost of the opt-in, and say that our own proxy never intercepts TLS. The E2B section must also say that an echoed credential stays unscrubbed, because the harness never knows the value to pass to `scrubSecrets()`.
- **Each hosted backend keeps three duties.** First, it compiles egress to deny-all and allows exactly the policy's hosts. Second, it reads the applied policy back and fails on any difference it can see; Vercel's read-back hides values, so it compares hosts, header names, methods and ranges. Third, with a credential route, it fails provisioning when a secret is unresolved, at provision and resume.
- **The live runs check the opt-in end to end.** The owner runs each backend's opt-in live run on a real account, outside CI. Each run injects a throwaway credential, checks that it reaches the host and that the sandbox's environment lacks it.
- **Reversing the opt-in means running our own routes.** If the owner withdraws it, the opt-in's users switch to reverse-proxy routes that we run outside the sandbox, as HD15 does locally. E2B's fail-closed SOCKS5 option is one way to reach such a proxy ([E2B fact-check][e2b-fc], row N47b-17). Nobody has checked a way for Vercel; its firewall has a `forwardURL` rule ([Vercel fact-check][vercel-fc], row N48b-10) that nobody has tried as a route to our proxy.
- **Later measurements may revisit it.** N19's local and N49's hosted measurements may give reason to revisit this record; a change would be a new ADR that supersedes this one.
- **The harness README gains a section on credentials and sandboxes** that states the default, the host-side tool and the opt-in for package users.

[e2b-fc]: https://github.com/laudebugs/buildanagent/blob/93e6e66eed88a507ee9203ba844f8bf55acfab2a/docs/plans/reviews/fact-check-e2b-backend.md
[vercel-fc]: https://github.com/laudebugs/buildanagent/blob/30254554678ced8ff46023bb161f842fb6aeb66f/docs/plans/reviews/fact-check-vercel-sandbox.md
[vercel-readme]: https://github.com/laudebugs/buildanagent/blob/30254554678ced8ff46023bb161f842fb6aeb66f/packages/harness/README.md#the-vercel-backend-runs-each-sandbox-in-a-microvm-whose-firewall-holds-the-credentials
