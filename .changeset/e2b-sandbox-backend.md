---
"@buildanagent/harness": minor
---

Add the E2B sandbox backend, `e2bSandbox()` in `@buildanagent/harness/sandbox/e2b`, with `e2b` 2.63.0 as an optional peer. Each sandbox reaches only its policy's hosts and holds no credentials by default. An `EgressPolicy` with a credential route opts in to E2B's egress-proxy Secrets, which `compileE2BEgress()` compiles. When a secret the rules name doesn't exist, provisioning throws the new `SandboxSecretUnresolvedError` (code `sandbox_secret_unresolved`).
