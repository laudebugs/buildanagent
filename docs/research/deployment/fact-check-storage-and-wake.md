# Fact-check: storage and wake

This log checks every factual claim in [storage-and-wake.md](storage-and-wake.md) against its source, on 2026-11-18. Claims about our plans were read from `main` at `aea10fb`. The three seams and their rules are our design, so the log checks only the facts they rest on.

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 1 | A server is a non-goal of the harness plan, and HD2 calls an actor per session server-shaped | ✅ | [harness plan HD2](../../plans/build-harness.md#hd2-a-lock-file-with-a-renewed-lease-on-local-disk-only-provisional): "An actor per session suits a server, which is a non-goal (§1)" |
| 2 | The session log is a JSONL file on local disk, cited to HD1 | ✏️ | HD1 covers entry granularity, not the file format. The typed JSONL tree comes from the §1 goal table ("typed JSONL tree, persisted HEAD, one writer lock"), so the citation now points to [harness plan §1](../../plans/build-harness.md#1-goal-and-non-goals) |
| 3 | HD2 creates `<session>.lock` with `open(path, "wx")` and writes `{ pid, host, token, leaseUntil }` | ✅ | [HD2](../../plans/build-harness.md#hd2-a-lock-file-with-a-renewed-lease-on-local-disk-only-provisional), verbatim |
| 4 | HD2's lock is stale only when the lease has lapsed and, on the same host, the pid is gone | ✅ | HD2, verbatim |
| 5 | The holder renews a 30-second lease every 10 seconds | ✅ | HD2: "renews the lease every 10 seconds for a 30-second lease" |
| 6 | HD5's key ring defaults to `$XDG_STATE_HOME/agent-speak/keys.json` | ✅ | [HD5](../../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5), "Harness side: the key" |
| 7 | The SDK defaults to `ephemeralSigner()` | ✅ | [SDK D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5) title and HD5 |
| 8 | HD5 says "An ephemeral key would strand every pause across a restart" | ✅ | HD5, verbatim |
| 9 | The harness writes the signed pause as an `approval_requested` entry before it asks any client, and never uses `blockingApprovals()` | ✅ | HD5, "Harness side: the pause path" |
| 10 | Off-host lock options: a Durable Object per session, DynamoDB conditional write, Postgres lease, Cosmos DB lease; Durable Object alarms or delayed queue messages back a wake | ✅ | [portable agents report](portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places), adapter table rows for HD2 and timers |
| 11 | A tool call id deduplicates only once persisted before execution and scoped to `(tenant, session, branch, tool_call_id)` | ✅ | [server rollback report](../reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped), heading and body |
| 12 | Cloudflare Workflows caps event payloads and step results at 1 MiB | ✅ | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/), page dated 2026-11-10: "Maximum event payload size 1MiB" and "Maximum non-stream step result per step 1MiB" on both plans |
| 13 | Cloudflare's and Vercel's third-party harness adapters, and the Workflow SDK's Worlds, reduce to a transcript store, a wake and a remote sandbox | ✅ | [portable agents report](portable-agents.md#conclusion). This claim is the report's own synthesis; its sources are checked in [fact-check-portable-agents.md](fact-check-portable-agents.md) |
| 14 | The portable agents report lists the seams as plan changes 5 and 6 | ✅ | [portable agents report](portable-agents.md#fifteen-plan-changes-follow), rows 5 and 6 |
| 15 | HD2 is still provisional, recorded in ADR 0014 | ✅ | [decisions index](../../decisions/README.md): "Proposed (provisional until todo N4)"; HD2's title says "(provisional)" |
| 16 | Todo N4 runs a settling test that kills a writer mid-append | ✅ | HD2, "Evidence": "N4 runs the guide's settling test: it kills a writer with `SIGKILL` mid-append" |
| 17 | `SessionStore` and `SessionLock` are new seams this note proposes, with a conditional append keyed by `seq` | ✏️ | Found by the U11 review. [Harness plan §3.2](../../plans/build-harness.md#32-session-log-api) already defines `SessionStore.append(key, entries, { expectedLastId })`, idempotent by id with a compare-and-swap on the last id, and `SessionLock { acquire(key) }` with `fileLock()` as its only implementation. The note now says two seams exist and need off-host implementations, and only `Scheduler.wake` is new |
| 18 | The plan already defines `KeyStore` with `load()`, `rotate()` and `prune()` | ✅ | [Harness plan §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis), `interface KeyStore`; the optional `rotate()`/`prune()` proposal is U11 change 4 |
| 19 | `fileLock()` takes `leaseMs` and `renewMs`, so it renews on an in-process timer | ✅ | Harness plan §3.2, `fileLock` signature, read with HD2's renewal rule |
| 20 | The default key ring path in HD5 and this note: `$XDG_STATE_HOME/agent-speak/keys.json` (row 6) | ✏️ | Renamed 2026-11-19 by [ADR 0044](../../decisions/0044-rename-to-buildanagent.md): the path is now `$XDG_STATE_HOME/buildanagent/keys.json` in HD5 and in storage-and-wake.md. Row 6 keeps the text it confirmed at the time |

**Totals:** 17 ✅, 3 ✏️, 0 ⚠️.
