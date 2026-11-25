---
"@buildanagent/harness": minor
---

Add the E2B sandbox backend, `e2bSandbox()` in `@buildanagent/harness/sandbox/e2b`, with `e2b` 2.63.0 as an optional peer. Each sandbox reaches only its policy's hosts, an `EgressPolicy` compiles to E2B's `allowOut` and egress-proxy Secrets with `compileE2BEgress()`, and provisioning throws the new `SandboxSecretUnresolvedError` (code `sandbox_secret_unresolved`) when a secret the rules name doesn't exist.
