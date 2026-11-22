---
"@buildanagent/sdk": minor
---

Breaking Changes: run() and continueRun() now require an app that has every app type the tools declare, so a typed tool beside an untyped one needs it too, and null is refused. The AppRequired type is replaced by AppFor, which reads the type of the tools list the call infers, so the second type parameter of run() and continueRun() is now that list and no longer the app type: drop it from a call such as run<Triage, Session>(), which now fails to compile. Document that a resumed run takes its app from the resuming process, so store the original caller's app and pass it back.
