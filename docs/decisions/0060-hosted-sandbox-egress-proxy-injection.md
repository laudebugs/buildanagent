# 0060. Let the E2B and Vercel sandbox backends inject credentials through the provider's TLS-intercepting egress proxy

- **Status:** Accepted (owner, 2026-11-25)
- **Date:** 2026-11-25
- **Plan:** [build-harness.md, HD15](../plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls), which this record extends to the hosted backends; the backends are todos N47b ([#421](https://github.com/laudebugs/buildanagent/pull/421)) and N48b ([#422](https://github.com/laudebugs/buildanagent/pull/422))

## Context

HD15 and [ADR 0020](0020-default-sandbox-backend.md) chose a local credential proxy that adds credentials on reverse-proxy routes and filters all other egress by name, with no TLS interception. ADR 0020 also says that no backend claims to stop a hostile process, and [ADR 0036](0036-loop-outside-sandbox-and-pr-approval.md) keeps the loop outside the sandbox and every credential out of it. The question is whether the hosted backends may rely on the injection their provider ships instead of a route we run. The [portable agents report](../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first) found that E2B and Vercel both inject outside the VM by intercepting TLS with a CA the provider issues, which HD15 chose to avoid locally; because the vendor owns that CA, we would not build one.

The two backends' pull requests checked what each provider does against its pinned package and its docs:

- **E2B.** A rule's header holds the placeholder that `Secret.fill()` returns, and E2B's egress proxy replaces it with the stored secret's value outside the sandbox, on HTTPS to the rule's host only ([E2B fact-check][e2b-fc], row N47b-18). For a host with a rule, E2B intercepts TLS with its own CA, which it adds to the sandbox's trust store (row N47b-24). It injects into every request to that host, whatever the method, path or process (row N47b-21), and it forwards a request whose secret fails to resolve with the header dropped (row N47b-19).
- **Vercel.** A firewall rule's `transform` sets a header on a matching request before it leaves the VM, and its `match` can name the method ([Vercel fact-check][vercel-fc], rows N48b-8 and N48b-13). The firewall terminates TLS only for a domain with a transformation, forwarding or direct-response rule, using a CA it adds to each sandbox (row N48b-14). The backend writes transformation rules and a 403 response rule, both on route hosts only. It reads each value through its `secret()` callback on the host when it provisions or resumes a sandbox, and hands it to Vercel's API ([harness README, Vercel section][vercel-readme]). Vercel reports the value back only as `<redacted>` (row N48b-12).

This record carves the hosted E2B and Vercel backends out of HD15's no-interception rule. That rule, as ADR 0020 records it, stays in force for every other backend, and this record changes nothing else in 0020.

## Decision

The E2B and Vercel sandbox backends add credentials through their provider's own egress proxy, not through a proxy we run. The sandbox's configuration and environment never hold a credential value. On E2B, the configuration holds only `Secret.fill()` placeholders, and a trusted process stores the value in the E2B project, so the harness never reads it. On Vercel, the firewall rule holds the value, which the harness reads on the host through `secret()` and sends to Vercel's API at each provision and resume.

We accept four costs that this injection brings:

- Each sandbox's trust store carries the provider's CA.
- The provider's proxy decrypts every request to a host that carries a credential rule, sees it in plaintext, and holds the secret.
- HD15's placeholder check is gone, so any process that sends a matching request gets the credential added. On E2B a match is any HTTPS request to the host, whatever its method or path, which is why the E2B backend refuses a route unless the caller sets `unscopedInjection: true`.
- A host that echoes request headers hands the credential back into the sandbox, so output from a credentialed host can carry it. The local proxy has the same gap, and its README says not to route to such a service.

Our local backends, `srt` and Docker, keep ADR 0020's rule: no TLS interception.

This record does not decide Cloudflare. N50's measurements, its own proposed ADR and the owner's ruling on it still gate [N46b](../todos/ready/N46b-cloudflare-sandbox-backend.md). Nor does it decide what a backend may claim about stopping a hostile process. Both hosted backends report the `stops` that N43's `stopsFor()` computes, which include `hostile_process` for a microVM, and whether that claim fits ADR 0020's sentence is a question this record leaves open.

## Consequences

- **The READMEs say the trade-off plainly.** The harness README's E2B and Vercel sections must name each of the four costs above and say that our own proxy never intercepts TLS. The E2B section must also explain the `unscopedInjection` opt-in, and say that an echoed credential reaches command output, the model and the session log unscrubbed, because the harness never knows the value and so cannot pass it to `scrubSecrets()`. The Vercel section must also say that the harness reads each value on the host and sends it to Vercel.
- **Each backend keeps three duties.** First, it compiles egress to deny-all and allows exactly the policy's hosts. Second, it reads the applied policy back from the provider and fails on any difference it can see; Vercel's read-back hides values, so it compares hosts, header names, methods and ranges. Third, it fails provisioning when a secret is unresolved. That check runs at provision and resume only, so on E2B a secret deleted later is again dropped silently.
- **The live runs check the injection end to end.** The owner runs each backend's opt-in live run on a real account, and neither run is part of CI. Each run injects a throwaway credential, checks that it reaches the host, and checks that the sandbox's environment lacks it. The Vercel run also checks the VM's files and that echoed output comes back scrubbed.
- **Reversing the decision means running our own routes.** If the owner withdraws it, those backends switch to reverse-proxy routes that we run outside the sandbox, as HD15 does locally. E2B's fail-closed SOCKS5 option is one way to reach such a proxy ([E2B fact-check][e2b-fc], row N47b-17). For Vercel no such path has been checked; a firewall `forwardURL` rule exists ([Vercel fact-check][vercel-fc], row N48b-10), but nobody has tried it as a route to our proxy.
- **Later measurements may revisit it.** N19's local and N49's hosted measurements may give reason to revisit this record; a change would be a new ADR that supersedes this one.

[e2b-fc]: https://github.com/laudebugs/buildanagent/blob/93e6e66eed88a507ee9203ba844f8bf55acfab2a/docs/plans/reviews/fact-check-e2b-backend.md
[vercel-fc]: https://github.com/laudebugs/buildanagent/blob/30254554678ced8ff46023bb161f842fb6aeb66f/docs/plans/reviews/fact-check-vercel-sandbox.md
[vercel-readme]: https://github.com/laudebugs/buildanagent/blob/30254554678ced8ff46023bb161f842fb6aeb66f/packages/harness/README.md#the-vercel-backend-runs-each-sandbox-in-a-microvm-whose-firewall-holds-the-credentials
