# Deploying anywhere is a storage-and-wake problem

An agent run outlives the process that starts it. The run calls a model, calls tools, may wait hours for an approval, and then resumes. On a serverless host, the Worker request, Lambda invocation or Vercel function can end between any two of those steps, and the next step can land on another machine with an empty disk. Any runtime can call `fetch`, so the model step travels. The hard part is keeping the run's state and its timers alive between processes. This note expands one finding of the [portable agents report](portable-agents.md#conclusion), and its seams are our own design, unbuilt and untested as of November 2026. It defines that storage-and-wake problem, shows where our harness plan assumes one long-lived host, and names the three seams that fix it without touching the loop: two the plan already defines, and one it lacks.

## A run needs storage and a wake that the host process cannot give it

A portable harness needs two things from outside the process. First, **storage**: the session log must live somewhere that outlasts the process, and only one writer may append to it at a time. Second, a **wake**: something outside the process must restart the run later, at a deadline, when a lease needs renewing, or when an approval arrives. A process that has exited cannot set its own alarm. Every other part of a run, including model calls, tool calls and the permission pipeline, already works inside one short request.

## Our harness plan meets both needs with a single long-lived host

The harness plan ties storage and wake to one host on purpose, because a server is a non-goal ([harness plan §1](../../plans/build-harness.md#1-goal-and-non-goals)). Four parts carry that assumption:

| Need | The plan today | Why it fails off-host |
|---|---|---|
| Session log | A typed JSONL tree on local disk ([harness plan §1](../../plans/build-harness.md#1-goal-and-non-goals)) | `/tmp` is per-request or absent, and no disk is shared |
| One writer | `<session>.lock`, created with `open(path, "wx")`, holding `{ pid, host, token, leaseUntil }`; stale only when the lease has lapsed and the pid is gone on the same host ([HD2](../../plans/build-harness.md#hd2-a-lock-file-with-a-renewed-lease-on-local-disk-only-provisional)) | No stable pid, host or file outlives the request |
| Lease renewal and deadlines | The holder renews a 30-second lease every 10 seconds ([HD2](../../plans/build-harness.md#hd2-a-lock-file-with-a-renewed-lease-on-local-disk-only-provisional)), so a timer runs in the process | The timer dies when the request ends |
| The key that signs a pause | A key ring at `$XDG_STATE_HOME/buildanagent/keys.json` ([HD5](../../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5)); the SDK defaults to `ephemeralSigner()` ([SDK D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5)) | A recycled isolate loses the key, so no process can resume the pause |

HD5 already names the failure: "An ephemeral key would strand every pause across a restart". On serverless, every pause crosses a restart.

## Two seams exist, one is new, and an approval becomes one more wake

The harness plan already defines two of the three seams as interfaces, but each has only a local implementation ([harness plan §3.2](../../plans/build-harness.md#32-session-log-api)). The third seam is new. Together they replace the host assumptions without changing the loop.

1. **`SessionStore`** exists. Its `append(key, entries, { expectedLastId })` is idempotent by entry id and compares the expected last id before it writes, so the store itself rejects a second writer. Its backends are `memoryStore()` and `jsonlStore()`. Off-host, it needs a backend in a Durable Object's SQLite, DynamoDB, Firestore, Postgres or Cosmos DB ([portable agents report](portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places)).
2. **`SessionLock`** exists. Its `acquire(key)` returns a `LockHandle` or `"would_block"`, and `fileLock()` is its only implementation. Off-host, it needs a lease without a pid or a file: one Durable Object per session as the single writer, a DynamoDB conditional write, a Postgres lease row, or a Cosmos DB lease ([portable agents report](portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places)).
3. **`Scheduler.wake(at, sessionId)`** is new. It promises to call `continueRun` for the session at time `at`, and it takes over the lease renewal that `fileLock()` runs on an in-process timer. Durable Object alarms or a queue's delayed message can back it.

An arriving approval needs no fourth seam. The harness already writes the signed pause as an `approval_requested` entry before it asks any client, and it never uses `blockingApprovals()` ([HD5](../../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5)). So the approver's HTTP request finds the session by id and calls `continueRun`, as a scheduled wake would. The key must then come from the plan's existing `KeyStore`, backed by a cloud secret store, never from the SDK's ephemeral default. A read-only secret cannot rotate keys, which is why the portable agents report proposes making `KeyStore`'s `rotate()` and `prune()` optional.

## Three rules come with the seams

Wakes from outside the process can repeat, replay or race, so the seams carry three rules.

1. **Wakes arrive at least once.** Alarms can fire twice and workflow engines replay steps, so every tool call needs an idempotency key. Our server-rollback research sets the condition: a tool call id deduplicates only after the harness persists it before execution, scoped to `(tenant, session, branch, tool_call_id)` ([server rollback report](../reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped)).
2. **An engine holds one step per `continueRun`, never the inner loop.** Model output varies between calls, so a replaying engine such as Cloudflare Workflows must hold only the wait and the wake. Steps should pass entry ids rather than transcripts, because Workflows caps event payloads and step results at 1 MiB ([Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)).
3. **Only a lapsed lease marks a lock as stale.** Off-host, no process can check whether another host's pid still runs, so off-host `SessionLock` implementations skip HD2's pid test.

## Other vendors' adapters reduce to the same three parts

Cloudflare's and Vercel's adapters for third-party harnesses, and the Workflow SDK's pluggable "Worlds", each reduce to a transcript store, a wake mechanism and a remote sandbox ([portable agents report](portable-agents.md#conclusion)). Two vendors arrived independently at the seams this note describes, which is the best evidence we have that the seams sit in the right place. The sandbox is the third part, and the [portable agents report](portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first) covers it.

## Decide plan changes 5 and 6 to make the harness portable

"Deploy anywhere" therefore costs about three adapters per cloud, a `SessionStore` backend, a `SessionLock` implementation and a `Scheduler`, rather than a port of the agent. The portable agents report lists them as plan changes 5 and 6 ([fifteen plan changes](portable-agents.md#fifteen-plan-changes-follow)). Change 5 adds lease implementations of the existing `SessionLock` and applies HD2's dead-pid rule only on the same host. HD2 is still provisional ([ADR 0014](../../decisions/0014-session-writer-lock.md)), so that change supersedes no accepted decision. Change 6 adds `Scheduler.wake`. The owner decides those two changes next. Todo N4's settling test should then run against every `SessionLock` implementation, not just the file lock.
