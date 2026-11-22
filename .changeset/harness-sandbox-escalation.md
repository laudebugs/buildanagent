---
"@buildanagent/harness": minor
---

Add `escalation()` to `@buildanagent/harness/sandbox`: the host's state machine for a denied command. Under `never` a denial goes back to the model; under `on-request` and `granular` it becomes a signed approval request, and an approval reruns the command once with the policy widened by exactly the denied target. The machine's states and legal edges are exported as data (`ESCALATION_STATES`, `ESCALATION_TRANSITIONS`), a classifier's allow never approves a rerun, and the host alone widens the policy.
