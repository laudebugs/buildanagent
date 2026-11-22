# Fact-check: the Cloudflare Agents durable-wake example

This log checks the claims that `verify/cloudflare-agents/examples/10-durable-wake.ts` and its README section make on 2026-11-22 (todo T33), against the pinned `agents` 0.33.0 docs and the run itself.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| T33-1 | Scheduling uses Durable Object alarms to wake the agent, and stores tasks in a SQLite table | ✅ | `docs/reference/cloudflare-agents/source/agents/docs/agents/scheduling.md` line 16; the run's callback fires after the eviction with no request |
| T33-2 | An evicted agent starts a new instance, so `onStart` runs again and in-memory fields reset | ✅ | `lifecycle.md` lists `onStart` in the start sequence; the example's rows show a start count of 2 and an in-memory field of 0 |
| T33-3 | `this.state` and `this.sql` rows are reloaded from SQLite on the new instance | ✅ | The example's checks: the note comes back after the eviction and the `woke` row is readable; `08-hibernation.ts` checks the same for state |
| T33-4 | A one-shot schedule is removed after it runs | ✅ | The example's last check, and `03-scheduling.ts` checks the same |
| T33-5 | The callback ran before any request reached the agent | ✅ | The example's `woke.at` is earlier than the `Date.now()` taken before its first read; both clocks are in workerd, which coarsens them, and the 3.5 second wait against a 2 second schedule leaves a margin |

**Totals:** 5 claims: 5 ✅, 0 ✏️, 0 ⚠️.
