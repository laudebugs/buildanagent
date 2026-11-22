---
"@buildanagent/sdk": minor
---

Breaking Changes: a pause now binds the run's `app` into its signed request as `appHash`, a MAC that the run's signer makes over the tagged canonical JSON of `app`. `continueRun()` checks it right after the signature, before the call and input checks. An `app` that is missing or different ends the run with an `error` result of kind `app_mismatch`, and in a run that has `app`, a request that fails its signature or shape check ends it with kind `request_unverified`, instead of being asked again for whoever resumed. A resume whose `app` has no canonical form ends with `app_unhashable`. Each ends with `run_end` and runs no approved call. Pass the original caller's `app` back, not the approver's.

A run with a `beforeToolCall` gate now throws `invalid_run_options` at once for an `app` with no canonical JSON form, such as one holding a `Date`, because a pause could not bind it. `RejectionCause` and `RunError.kind` gain members, and `createPendingRequest()` accepts an `app`.

A pause saved before this release has no `appHash`, binds nothing and still resumes with any `app`. A request signed with an `appHash` uses a second signature layout, so an older SDK refuses it.
