# 0060. Let the E2B and Vercel sandbox backends inject credentials through the provider's TLS-intercepting egress proxy

- **Status:** Accepted (owner, 2026-11-25)
- **Date:** 2026-11-25
- **Plan:** [build-harness.md, HD15](../plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls), which this record extends to the hosted backends; todos [N47b](../todos/ready/N47b-e2b-sandbox-backend.md) and [N48b](../todos/ready/N48b-vercel-sandbox-backend.md)

## Context

HD15 and [ADR 0020](0020-default-sandbox-backend.md) chose a local credential proxy that adds credentials on reverse-proxy routes and filters all other egress by name, with no TLS interception. ADR 0020 also says that no backend claims to stop a hostile process, and [ADR 0036](0036-loop-outside-sandbox-and-pr-approval.md) keeps the loop outside the sandbox and every credential out of it. The question is whether the hosted backends may rely on the injection their provider ships instead of a route we run. The [portable agents report](../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first) found that E2B and Vercel both inject outside the VM by intercepting TLS with a CA the provider issues, which HD15 chose to avoid locally; because the vendor owns that CA, we would not build one.

The two backends' pull requests, [#421 (N47b, E2B)](https://github.com/laudebugs/buildanagent/pull/421) and [#422 (N48b, Vercel)](https://github.com/laudebugs/buildanagent/pull/422), checked what each provider does against its pinned package and its docs:

- **E2B.** A rule's header holds the placeholder that `Secret.fill()` returns, and E2B's egress proxy replaces it with the stored secret's value outside the sandbox, on HTTPS to the rule's host only (`fact-check-e2b-backend.md`, row N47b-18). For a host with a rule, E2B intercepts TLS with its own CA, which it adds to the sandbox's trust store (row N47b-24). It injects into every request to that host, whatever the method or process (row N47b-21), and it forwards a request whose secret fails to resolve with the header dropped (row N47b-19).
- **Vercel.** A firewall rule's `transform` sets a header on a matching request before it leaves the VM, and its `match` can name the method (`fact-check-vercel-sandbox.md`, rows N48b-8 and N48b-13). The firewall terminates TLS only for a domain with such a rule, using a CA it adds to each sandbox (row N48b-14). Our backend reads each value through its `secret()` callback on the host when it provisions or resumes a sandbox and hands it to Vercel's API (the harness README's Vercel section on #422). Vercel reports the value back only as `<redacted>` (row N48b-12).

This record carves the hosted E2B and Vercel backends out of HD15's rule. ADR 0020 stays in force, unchanged, for every other backend.

## Decision

The E2B and Vercel sandbox backends add credentials through their provider's own egress proxy, not through a proxy we run. No credential value ever enters the sandbox VM. On E2B, the sandbox's configuration holds only `Secret.fill()` placeholders, and the value lives in the E2B project, stored there by a trusted process, so the harness never reads it. On Vercel, the firewall rule holds the value, which the harness reads on the host through `secret()` and sends to Vercel's API at each provision and resume.

We accept the trade-off this injection brings. Each sandbox's trust store carries the provider's CA. The provider's proxy decrypts every request to a host that carries a credential rule, so it sees that request in plaintext, and it holds the secret.

Our local backends, `srt` and Docker, keep ADR 0020's rule: no TLS interception.

This record does not decide Cloudflare. N50's measurements, its own proposed ADR and the owner's ruling on it still gate [N46b](../todos/ready/N46b-cloudflare-sandbox-backend.md). Nor does it widen what any backend may claim about stopping a hostile process.

## Consequences

- **The READMEs say the trade-off plainly.** The harness README's E2B and Vercel sections must state that the provider intercepts TLS with a CA in the sandbox's trust store, that its proxy sees each credentialed request in plaintext and holds the secret, and that our own proxy never intercepts TLS. The Vercel section must also say that the harness reads each value on the host and sends it to Vercel.
- **Each backend keeps the same four duties.** It compiles egress to deny-all and allows exactly the policy's hosts. It reads the applied policy back from the provider and fails on any difference. It fails provisioning when a secret is unresolved, which on E2B means checking every secret before creating the sandbox, because E2B would otherwise send the request without the header.
- **The live runs check the injection end to end.** The owner runs each backend's opt-in live run on a real account, and each run checks that a throwaway credential reaches the host and appears nowhere inside the VM. Neither run is part of CI.
- **Reversing the decision means running our own routes.** If the owner withdraws it, those backends switch to reverse-proxy routes that we run outside the sandbox, as HD15 does locally. E2B's fail-closed SOCKS5 option is one way to reach such a proxy (row N47b-17).
- **Later measurements may revisit it.** N19's local and N49's hosted measurements may give reason to revisit this record; a change would be a new ADR that supersedes this one.
