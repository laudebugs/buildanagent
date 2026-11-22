---
title: "Durable and portable agents, and how work reaches them"
summary: An agent that sleeps and wakes needs its state and its schedule kept outside the process. This chapter shows an agent evicted and woken by its own alarm on Cloudflare, the seven seams plus one that are meant to let the same harness run on Cloudflare, AWS or Vercel, of which only the effect store is built on all three, and why every trigger needs an id from its sender so a repeat starts one task.
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

An agent that runs for minutes, waits for a person for hours and wakes on a timer cannot live in one process. Three rules follow: keep state and schedule in storage, put every host-specific part behind a seam, and drop a repeated trigger by the id its sender gave it.

## State and a schedule survive an eviction, and a field in memory does not

Picture :analogy[an alarm clock with a note on the bedside table]{#alarm-clock-note}. You set the alarm and write where you left off. You sleep, the alarm rings, and you wake with no memory of the evening except the note. An agent on a serverless host sleeps the same way. When the host evicts it, the process and everything in its memory vanish, the note and the alarm survive in storage, and the alarm starts a fresh instance that reads the note. An alarm can ring twice, so the note has to make a second waking harmless, and the note holds where the agent left off and not what it was thinking.

The example runs that story. It plans a callback in four seconds, evicts the object, waits with no request to the agent and then reads what the agent holds.

:::listing[Evict the agent, send it nothing, and read what it holds after the alarm]{#evict-and-wake file="verify/cloudflare-agents/examples/10-durable-wake.ts" region="evict-and-wake"}
:::

Cloudflare's documentation says state is "saved to SQLite" and "survives restarts and hibernation" [@cloudflare-agents-state], and the note came back from storage on the new instance. The in-memory field did not: it was 42 before the eviction and 0 after it. The callback ran on the new instance, the agent's second start, and wrote a row naming that start count. No request had reached the agent by then, so the alarm woke it. The callback ran once, and the one-shot schedule was gone afterwards.

Three more examples in the same harness test the same split between storage and memory. `this.sql` is a template tag over the Durable Object's SQLite, and interpolated values become bound parameters. `scheduleEvery()`{checked=row-8} is idempotent on its callback, interval and payload, so registering the same repeating schedule twice leaves one. And a hibernated WebSocket stays open across an eviction, with its per-connection state, and the next message runs on the new instance.

Cloudflare's alarm API guarantees "at-least-once execution" [@cloudflare-durable-object-alarms]. A wake that arrives twice must find the work either not started or already done. The harness's rule for this is that every tool call carries an idempotency key, saved before the call runs, which is what the previous chapter built.

## Seven seams plus one keep the harness portable, and only the effect store has a part on every target

A shipping line does not rebuild its cargo for each port. :analogy[Standard shipping containers]{#shipping-containers} fit any ship, crane and truck, and the cargo inside never changes. Our harness aims for the same split. The loop, the tools and the permission pipeline are the cargo. They run unchanged on every target because the parts that touch a host sit behind a small set of interfaces, which we call seams. A container still needs a crane in each port, and a seam still needs an adapter on each target. [[fig:containers]] shows the split.

:::figure[Standard shipping containers: the box is standard, and each port needs its own crane]{#containers analogy="shipping-containers"}
::svg{alt="A box labelled the same code, in the accent, with three arrows down to three boxes labelled Cloudflare, AWS and Vercel. Under each of the three, a note says its own crane. A line below says the box is standard, and each port needs its own crane."}
:::

ADR 0033 names the seven seams and the four targets: local Node for development, Cloudflare as the primary target, AWS and Vercel. The seams are `SessionStore`{checked=row-13}, `SessionLock`{checked=row-13}, `Scheduler`{checked=row-13}, `KeyStore`{checked=row-13}, `SandboxClient`{checked=row-13}, `EgressPolicy`{checked=row-13} and a transport. ADR 0043 adds an eighth, `EffectStore`{checked=row-14}, which holds the records of writes from the previous chapter. One conformance suite will run the same cases against every implementation. [[fig:seams]] puts the eight beside what each target is planned to supply.

:::figure[The eight seams and what each target is planned to put behind them: the cells are our inference, except the effect store row (built) and the sandbox row (decided, not built)]{#seams}
::svg{alt="A table with eight rows, one for each seam, and three columns, Cloudflare, AWS and Vercel. SessionStore: Durable Object SQLite, DynamoDB, Postgres. SessionLock: one object, lease row, lease row. Scheduler: Durable Object alarm, queue delay, workflow hook. KeyStore: Worker secret, Secrets Manager, secret environment variable. SandboxClient: Cloudflare Sandbox, E2B, Vercel Sandbox. EgressPolicy: per backend in every column. Transport: Web streams in every column. EffectStore, in the accent: Durable Object SQLite, DynamoDB, Postgres."}
:::

Each seam answers one need of a run that sleeps. A run needs storage that outlasts the process and a single writer that appends to it at a time. It needs a wake, because a process that has exited cannot set its own alarm. It needs the key that signs a pause, because a recycled isolate loses an ephemeral one and strands every pause. And it needs a sandbox, an egress rule and a transport that work off the host.

The `EffectStore`{checked=row-14} is the one seam built on all three targets. Our `agent-safety` package has a store for a Durable Object's SQLite, one for DynamoDB and one for Postgres, which stands in for Vercel. Each runs the same conformance cases against the nearest thing to the real engine. Its tests prove the request shapes against DynamoDB, not DynamoDB's own atomicity, so the first deploy needs a live check, as the README says.

As of November 2026, only the local parts of the seams are built: a memory store and a JSONL store, a file lock and a file key store. Everything else is decided and not built. Todos N41 to N48 cover the rest, and none has started: a scheduler that calls the run at a deadline, a read-only key store, a remote sandbox with an egress policy, a stream transport, the conformance suite and the three platform adapters. The cells in the figure other than the sandbox row and the effect store come from our reading of the platforms' documentation, and none has been run. Cloudflare is the only target our harnesses execute.

Three rules travel with the seams, because a wake from outside the process can repeat, replay or race. Wakes arrive at least once, so every tool call needs an idempotency key, and the key deduplicates only if the harness saves it before the call runs. A workflow engine such as Cloudflare Workflows should wrap each call that continues a run in one step, and never the inner loop. An engine that replays the loop's code would get a different model answer the second time. The steps carry entry ids and not transcripts, since Workflows caps an event payload and a step result at 1 MiB [@cloudflare-workflows-limits]. And only a lapsed lease marks a lock as stale off the host, because no process can check whether another machine's process is still running.

## Every trigger carries an id from its sender, and a repeat starts nothing

A mailroom stamps each letter's number in a book before it sends the letter upstairs, and :analogy[bins a second letter with a number already in the book]{#mailroom-stamp}. The agent needs the same clerk. Work reaches an agent from a timer, a command, a chat message or a webhook, and 12-factor agents says to enable that on purpose: users trigger agents "from slack, email, sms, or whatever other channel they want", and non-humans trigger them too, "events, crons, outages" [@twelve-factor-trigger-from-anywhere]. Each channel can deliver the same event more than once. The mailroom depends on the sender, and so does the design: it invents no numbers, so the id must come from the sender. A number the mailroom made up would differ on every arrival, so a repeat would get a fresh stamp and slip through.

GitHub's webhooks show why. A webhook receiver should use the `X-GitHub-Delivery` header to ensure each delivery is unique per event, and if you request a redelivery, the header is "the same as in the original delivery" [@github-webhook-best-practices]. A receiver that reads the sender's id sees the repeat. Cloudflare's alarms add a second source, because they run at least once [@cloudflare-durable-object-alarms].

Our agent plan had no design for this: our 12-factor report found no "webhook", "cron" or "idempot" in it on 2026-11-18. The coding agent plan closes the gap once. Every trigger becomes a task request with a stable id, and the control plane drops a second request with the same id. The first triggers are a command-line command and a GitHub issue label or comment, accepted only from the owner, with hidden HTML stripped. That control plane is a ready todo, not code, as of November 2026.

:::listing[Write the sender's id first, and start a task only when the id was new]{#accept file="verify/cloudflare-agents/examples/11-trigger-dedup.ts" region="accept"}
::note[The id goes into a table whose primary key is the id. `INSERT OR IGNORE` does nothing when the id is already there.]{#stamp}
::note[SQLite reports how many rows the last statement changed. One means the id was new.]{#first}
::note[Only a new id starts a task. Every repeat reaches this line and skips it.]{#start}
:::

The agent writes the stamp before it starts any work, which is the same order as the key in the previous chapter's tool: the record comes first, so a crash after it leaves a trace and not a gap. The same id sent twice starts one task.

:::listing[Two deliveries of one id start one task]{#twice file="verify/cloudflare-agents/examples/11-trigger-dedup.ts" region="twice"}
::note[The second call returns `started: false` and the task count stays at one.]{#once}
:::

The stamp lives in the agent's storage, so it outlasts the agent. The example evicts the object and sends the same delivery again. It is still dropped.

:::listing[A redelivery after an eviction is still dropped]{#evicted file="verify/cloudflare-agents/examples/11-trigger-dedup.ts" region="evicted"}
::note[The id is in storage, not in memory, so the new instance finds it.]{#storage}
:::

Two limits belong with the example. It compares the id and nothing else, so a second delivery of the same id with different content is dropped without a word, and the first content stands. A stricter design would reject a mismatch. And it is our own pattern, not an SDK feature: the Cloudflare Agents SDK has no ingress layer, and the ingress for the coding agent is a ready todo. Keep the rule and swap the table, with one condition. The stamp can live in DynamoDB with a conditional write or in Postgres with `ON CONFLICT DO NOTHING`, the way our effect stores do it.

But the stamp and the task must be written in one atomic step, such as a DynamoDB transaction or one Postgres transaction. The example gets that from the Durable Object, where `accept` runs both statements with no `await` between them. Without it, a crash between the two leaves a stamped id whose task never began, and GitHub's redelivery of that id is dropped for good.

## Exercises

1. **Add a field, evict the agent, and list what it must reload.** In `verify/cloudflare-agents/examples/10-durable-wake.ts`{checked=row-1}, add a second in-memory field to `Reminders`{checked=row-1} and a second key to its state, then run the example. Before you run it, write down which of the two survive the eviction and which checks you must add. Say what an agent on any host must reload on every start, and which of those things sit in the table of seams.
2. **Send the same trigger twice, with different goals.** In `verify/cloudflare-agents/examples/11-trigger-dedup.ts`{checked=row-36}, send `delivery-1` a second time with a different goal. Predict the task count and which goal the task holds, run `pnpm test` in `verify/cloudflare-agents`, and decide whether dropping the second delivery silently is what you want. What would you change to reject a mismatch?
3. **Pick the AWS parts on paper.** For each of the eight seams, name the AWS service you would put behind it, say which of them the figure's cells are inference for, and which one is already built in `agent-safety`.
