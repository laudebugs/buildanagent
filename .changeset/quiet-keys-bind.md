---
"@buildanagent/sdk": minor
---

Breaking Changes: a pause now binds the run's `app` into its signed request as `appHash`, the `canonicalInputHash()` of `app`. `continueRun()` stops with an `SdkError` coded `app_mismatch`, before any approved call runs, when the `app` it receives is missing or has another canonical JSON, so pass the original caller's `app` back and not the approver's. `RejectionCause` and `ResolutionRejectionCause` gain `app_mismatch`, and `createPendingRequest()` accepts an `appHash`.

A request signed with an `appHash` uses a second signature layout, so an older SDK refuses it, while a pause saved before this release has no `appHash`, binds none and still resumes.
