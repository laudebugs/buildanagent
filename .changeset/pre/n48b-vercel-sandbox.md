---
"@buildanagent/harness": minor
---

Add `vercelSandbox()` in `@buildanagent/harness/sandbox/vercel`, a microVM backend on Vercel Sandbox. Its firewall allows exactly the policy's hosts and is `"deny-all"` when the policy names none. By default the sandbox holds no credential and none is injected; as a narrow opt-in, a header route's credential is added by the firewall's `transform` rule outside the VM, so no credential value enters the sandbox. `provision()` reads the firewall policy back from Vercel and throws on any difference, and a sandbox that fails or is disposed is deleted. `@vercel/sandbox` 3.9.1 is a new optional peer dependency, needed only by this subpath. The harness error codes gain `egress_secret_unresolved`.
