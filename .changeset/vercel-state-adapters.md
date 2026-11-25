---
"@buildanagent/harness": minor
---

Add `@buildanagent/harness/vercel` and `@buildanagent/harness/vercel/workflow`: `postgresStore()` and `postgresLock()` keep the session log and its writer lock in Postgres, `workflowScheduler()` turns each wake into a Vercel Workflow run that delivers in one step, and `envKeyStore()` reads the approval key ring from a secret environment variable. The entries take the Postgres client and the Workflow SDK's functions as arguments and import neither.
