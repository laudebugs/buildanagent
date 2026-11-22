---
title: "Durable and portable agents, and how work reaches them"
summary: An agent that sleeps and wakes needs its state and its schedule kept outside the process. This chapter shows an agent evicted and woken by its own alarm on Cloudflare, the seven seams plus one that let the same harness run on Cloudflare, AWS or Vercel, and why every trigger needs an id from its sender so a repeat starts one task.
opening: code
sources: [cloudflare-agents-state, cloudflare-durable-object-alarms, cloudflare-workflows-limits, github-webhook-best-practices, twelve-factor-trigger-from-anywhere]
glossary: [wake, seam]
switchTo: [N41, N42, N43, N44, N45, N46a, N46b, N47a, N47b, N48a, N48b]
---

:::listing[An agent that keeps a note, schedules its own wake and holds one field in memory]{#durable-agent file="verify/cloudflare-agents/examples/10-durable-wake.ts" region="durable-agent"}
::note[A field in the object's memory. It lives only as long as this instance of the agent.]{#memory}
::note[Every start of an instance writes a row. The count of rows tells you how many times the agent has been started.]{#start}
::note[The note goes into the agent's state, which Cloudflare saves to storage.]{#state}
::note[The schedule is saved too, and an alarm will call `wake` by name when it is due.]{#schedule}
:::

Four lines in that class decide what an agent keeps when its host takes it away. The field on the first line lasts for one instance and is gone when the object is evicted. The note, the schedule and the start rows are written to storage, so a new instance finds them. The alarm then calls `wake` on that new instance with nobody asking. Everything in this chapter follows from the split between what lives in the object and what lives in storage.

An agent that runs for minutes, waits for a person for hours and wakes on a timer cannot live in one process. This chapter shows the one target our `verify/` harnesses can run, Cloudflare, evicting an agent and waking it from its alarm. It then lists the seven seams plus one that our harness leaves open so the same code can run on Cloudflare, AWS or Vercel, and says which parts of that design are built and which are decided. It ends with the ingress rule that makes a repeated trigger harmless: an id from the sender, saved before any work starts.

## State and a schedule survive an eviction, and a field in memory does not

Picture :analogy[an alarm clock with a note on the bedside table]{#alarm-clock-note}. You set the alarm and write where you left off. You sleep, the alarm rings, and you wake with no memory of the evening except the note. An agent on a serverless host sleeps the same way. When the host evicts it, the process and everything in its memory vanish, the note and the alarm survive in storage, and the alarm starts a fresh instance that reads the note. An alarm can ring twice, so the note has to make a second waking harmless, and the note holds where the agent left off and not what it was thinking.

The example runs that story. It plans a callback in four seconds, evicts the object, waits with no request to the agent and then reads what the agent holds.

:::listing[Evict the agent, send it nothing, and read what it holds after the alarm]{#evict-and-wake file="verify/cloudflare-agents/examples/10-durable-wake.ts" region="evict-and-wake"}
:::

The checks that follow the listing say what survived. Cloudflare's documentation says state is "saved to SQLite" and "survives restarts and hibernation" [@cloudflare-agents-state], and the note came back from storage on the new instance. The in-memory field did not: it was 42 before the eviction and 0 after it. The callback ran on the new instance, the agent's second start, and it wrote a row naming that start count. It ran before any request reached the agent, so the alarm woke it. It ran once, and the one-shot schedule was removed after it ran.

Three other examples in the same harness show the neighbours of this one. `this.sql` is a template tag over the Durable Object's SQLite, and interpolated values become bound parameters. `scheduleEvery()` is idempotent on its callback, interval and payload, so registering the same repeating schedule twice leaves one. And a hibernated WebSocket stays open across an eviction, with its per-connection state, and the next message runs on the new instance. Each of these is a statement about what is in storage and what is in memory.

Cloudflare's alarm API guarantees "at-least-once execution" [@cloudflare-durable-object-alarms], which is why the note must carry enough to make a repeat harmless. A wake that arrives twice must find the work either not started or already done. The harness's rule for this is that every tool call carries an idempotency key, saved before the call runs, which is what the previous chapter built.
