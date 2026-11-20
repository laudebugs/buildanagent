---
"@buildanagent/sdk": minor
---

New: the SDK re-exports the safety package's `verifyResolution()`, with its `ResolutionCheck`, `VerifyResolutionOptions` and `PendingCall` types, so code that signs a request with `createPendingRequest()` can check a person's answer before the call runs, as `continueRun()` does. The check accepts any key the signer's ring holds.
