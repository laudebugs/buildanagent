---
"@buildanagent/harness": minor
---

Add `@buildanagent/harness/cloudflare`: `doSqliteStore()` and `doSqliteIndex()` keep the session log and its pointers in a Durable Object's SQLite storage, `doLock()` makes the object a session's single writer with a lease, `doAlarmScheduler()` puts wakes on the object's alarm, `workerKeyStore()` reads the approval key ring from a Worker secret or a Secrets Store binding, and `webSocketHibernation()` serves the protocol over hibernatable WebSockets and replays a connection after the object is evicted. `HarnessError` gains the codes `invalid_store_options` and `invalid_scheduler_options`.
