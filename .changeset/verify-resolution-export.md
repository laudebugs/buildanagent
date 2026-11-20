---
"@buildanagent/sdk": minor
---

New: the SDK re-exports the safety package's `verifyResolution()`, with its `ResolutionCheck`, `VerifyResolutionOptions` and `PendingCall` types, so code that signs a request with `createPendingRequest()` can check a person's answer against it before the call runs, under any key its signer's ring holds, as `continueRun()` does.
