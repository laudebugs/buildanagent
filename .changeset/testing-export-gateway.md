---
"@buildanagent/gateway": minor
---

New in `@buildanagent/gateway/testing`: `startMockServer({ api, script, log })` serves a `mockTransport()` script over HTTP on 127.0.0.1, refuses to bind to a non-loopback address, and appends each request to a JSON Lines log with its credential headers redacted. Its `transport` lets an in-process adapter reach it while real model requests are off. `CREDENTIAL_HEADERS`, `isCredentialName()`, `redactHeaders()` and `stripCredentials()` are the credential strippers every recorder uses.
