---
"@buildanagent/sdk": minor
---

Breaking Changes: `run()` and `continueRun()` now require an `app` that has every app type the tools declare, so a typed tool beside an untyped one needs it, and `null` is refused. `AppRequired` is replaced by `AppFor`, which reads the type of the `tools` list. The second type parameter of both functions is now that list, not the app type, so drop it from a call such as `run<Triage, Session>()`.

Note: a resumed run takes its `app` from the process that resumes it, and a signed request does not bind it, so store the original caller's `app` and pass it back.
