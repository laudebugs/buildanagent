# Fact-check: Durable and portable agents, and how work reaches them

The claims log for [`durable-and-portable-agents.md`](../src/content/chapters/durable-and-portable-agents.md), checked section by section as each was drafted (BK21). Each row names the claim, the section it sits in, the verdict and the primary source. Pages were read on 2026-11-22. Package claims are checked against the harness pin of that date, `agents@0.33.0`, run in workerd under Miniflare.

## The research question, answered before drafting

**Question.** What does it take for an agent to sleep, wake and run on Cloudflare, AWS or Vercel with one code base, and how do triggers reach it once?

**Answer, from the todo's sources only.** An agent that sleeps keeps its state and its schedule in storage, because eviction erases everything in the process. On Cloudflare the state and the schedule are in the Durable Object's SQLite and an alarm wakes a new instance, as our example shows. One code base runs on several targets when the harness depends on a few seams, a session store, a lock, a scheduler, a key store, a sandbox, an egress policy and a transport, plus an effect store, and each target supplies its own implementation behind one conformance suite ([ADR 0033](../../../docs/decisions/0033-three-deployment-targets.md), [ADR 0043](../../../docs/decisions/0043-standalone-safety-core.md)). The seams are decided and the AWS and Vercel mappings are our inference from platform documentation, untested ([portable agents report](../../../docs/research/deployment/portable-agents.md)). Triggers arrive at least once, so every trigger becomes a task request with a stable id from its sender and a second request with the same id is dropped ([coding agent plan CA7](../../../docs/plans/build-coding-agent.md)).

**Gaps.** Only Cloudflare runs in `verify/`. No source measures AWS or Vercel wake behaviour for our harness, so the chapter says those are decided and built by later todos, not shown.

## Opening and "State and a schedule survive an eviction, and a field in memory does not"

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 1 | The example agent keeps a note in its state, schedules a callback with `schedule`, holds an in-memory field and writes a start row on every start | Opening | ✅ | `verify/cloudflare-agents/examples/10-durable-wake.ts`, the `durable-agent` region |
| 2 | The field is gone after eviction, while the note and the schedule survive and the alarm calls `wake` on the new instance | Opening | ✅ | Same file, checks "the in-memory field did not survive eviction" and "the state was reloaded from storage on the new instance" |
| 3 | The example plans a callback in four seconds, evicts the object, sends nothing and reads what the agent holds | § State and a schedule | ✅ | Same file, the `evict-and-wake` region (`plan("call back at noon", 4)`, `h.evict`, `h.sleep(6500)`) |
| 4 | The in-memory field was 42 before the eviction and 0 after it | § State and a schedule | ✅ | Checks "before eviction: one start and the in-memory field is set" and "the in-memory field did not survive eviction" |
| 5 | The callback ran on the new instance (the agent's second start), wrote a row naming that start count, ran before any request reached the agent, ran once, and the one-shot schedule was removed | § State and a schedule | ✅ | Checks "the callback ran on the new instance, the agent's second start", "it ran before any request reached the agent, so the alarm woke it", "the callback ran once" and "the one-shot schedule was removed after it ran" |
| 6 | Cloudflare's documentation says state is "saved to SQLite" and "survives restarts and hibernation" | § State and a schedule | ✅ | [State management](https://github.com/cloudflare/agents/blob/agents@0.33.0/docs/agents/state.md): "Automatically saved to SQLite, survives restarts and hibernation" (the chapter quotes the two phrases) |
| 7 | `this.sql` is a template tag over the Durable Object's SQLite and interpolated values become bound parameters | § State and a schedule | ✅ | `verify/cloudflare-agents/examples/02-sql.ts`, header and check "a value containing SQL is bound as a parameter, not executed" |
| 8 | `scheduleEvery()` is idempotent on its callback, interval and payload | § State and a schedule | ✅ | `03-scheduling.ts`, header: "scheduleEvery() is idempotent on (callback, interval, payload)" |
| 9 | A hibernated WebSocket stays open across an eviction with its per-connection state, and the next message runs on the new instance | § State and a schedule | ✅ | `08-hibernation.ts`, header |
| 10 | Cloudflare's alarm API guarantees "at-least-once execution" | § State and a schedule | ✅ | [DO Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): "guaranteed at-least-once execution", [portable agents log row 13](../../../docs/research/deployment/fact-check-portable-agents.md) |
| 11 | The harness's rule is that every tool call carries an idempotency key saved before it runs | § State and a schedule | ✅ | [Storage-and-wake note](../../../docs/research/deployment/storage-and-wake.md), "Three rules come with the seams", rule 1 |
| 12 | An alarm can ring twice, so the note must make a second waking harmless | § State and a schedule | ✅ | Follows from row 10; the analogy's "where it breaks" entry states it |
