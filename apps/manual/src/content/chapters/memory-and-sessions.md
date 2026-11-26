---
title: "Memory within a task: sessions, threads and resuming"
summary: A model keeps nothing between calls, so an agent's memory is a session that your SDK or your code stores and sends back. This chapter shows how sessions and threads carry a conversation between runs, what a resume in a fresh process brings back and what it drops, who may use a session id, and where each of eight SDKs keeps its state.
opening: analogy
sources: [openai-agents-sessions, langgraph-checkpointers, langgraph-persistence, claude-agent-sdk-hosting, claude-agent-sdk-sessions, claude-code-sessions, openai-agents-human-in-the-loop, cloudflare-agents-routing, cloudflare-agents-state, adk-session-state, buildanagent-harness-readme]
glossary: [session, checkpointer, trusted-context, prompt-injection, approval]
switchTo: [N3, N6]
---

At seven in the evening a nurse starts her shift on a ward she left twelve hours earlier. The man in bed 12 arrived after she went home. She never saw his fever peak at noon, the antibiotic the day nurse gave at two, or the note that he is allergic to penicillin. Within a minute of reaching his bed she knows all three, because :analogy[the patient's chart]{#patients-chart} travels with him from shift to shift, and everyone who treated him wrote in it. Nobody on the ward expects her to remember the day. They expect her to read.

:::figure[A patient's chart that travels with them between shifts: each nurse reads what the last one wrote]{#patients-chart analogy="patients-chart"}
::svg{alt="A hospital chart for bed 12 on a clipboard, with three entries: 12:00 fever 38.9, 14:00 antibiotic, and allergy: penicillin, which is highlighted. On the left, the day shift writes in the chart; on the right, the night shift reads it. A note under the chart says the night nurse remembers nothing of the day; she reads the chart."}
:::

A model meets every request the way that nurse meets bed 12. [[ch:talking-to-a-model]] showed that the model keeps nothing between calls, so a conversation lasts only because your code sends it again. Within one run, the agent loop does that resending for you. Between runs, the job falls to whatever keeps the chart: the user comes back tomorrow, the server restarts overnight, or an approval waits an hour for a person to click. This chapter follows the chart through six SDKs' examples, with our own harness beside three of them, and then all eight SDKs. It shows how a session carries a conversation from one run to the next, how a run is saved and resumed in a fresh process, and where each SDK keeps its state. By the end you can choose where your agent's sessions live, say what a resume brings back and what it drops, and make sure that a resumed session belongs to the user who asked for it.

## A session keeps the conversation between runs, and a thread id names it

A run is one call of the SDK's run function: a new user message goes in, the loop takes as many turns as it needs, and one answer comes out. A session is the stored history that outlives the run: every message, tool call and tool result so far. Before a run, the SDK reads the session and puts its items in front of the new message; after the run, it appends what the run added. The OpenAI Agents SDK's guide names both duties: before each run the runner "retrieves the session history, merges it with the new turn's input", and after a non-streaming run "one call to `session.addItems()`{checked=row-6} persists both the original user input and the model outputs from the latest turn" [@openai-agents-sessions]. The chapter's first three listings come in two tabs. The first tab runs on our own harness, `@buildanagent/harness`, which keeps a session as a log of entries on top of our SDK and gateway; the second runs the same step on an established SDK, so you can see what changes between them and what stays. As of November 2026 `@buildanagent/harness`{checked=row-142} is published on npm as an alpha release, so its names may still change. [[lst:session-ours]] and [[lst:session-openai]] each make two runs against one session.

::::tabs
:::listing[Our harness]{#session-ours file="packages/harness/examples/01-session-two-runs.ts" region="session" replay}
::note[`scripted` puts our SDK's test model behind the gateway's `createModel()`{checked=row-109}, so the turns need no key and send nothing over the network. A real run passes a model from `createModel()`{checked=row-109} and nothing else changes.]{#scripted}
::note[A session's key is its user and its id together. No call to the store finds a session by its id alone.]{#key}
::note[`memoryStore()` keeps the log inside this process, as `MemorySession` does. `jsonlStore()`{checked=row-117} keeps the same entries in a file.]{#store}
::note[A writable session needs a lock. `memoryLock()`{checked=row-134} comes from this example's folder, not from the package, which exports only `fileLock`{checked=row-134}, so a reader with an in-memory store needs a lock of their own.]{#lock}
::note[`runTurn()` writes the question into the log before the first model call, then the answer. For this second turn it rebuilds the conversation from the log and puts it in front of the new question.]{#second}
::note[The first turn starts from an empty log, so its request holds one message.]{#first-run}
:::
:::listing[OpenAI Agents SDK]{#session-openai file="verify/openai-agents-sdk/examples/06-session.ts" region="session" replay}
::note[`MemorySession` keeps the items in an array inside this process. It generates a random id for itself unless you pass a `sessionId`{checked=row-7}, and its own documentation calls it "intended for demos or tests".]{#memory-session}
::note[The first run starts from an empty session and leaves two items in it: the user's message and the model's answer.]{#first-run}
::note[The second run passes the same session, so the SDK puts the first run's two items in front of the new question.]{#second-run}
:::

::::

Read each replay as the night nurse reads the chart. In the OpenAI tab, the first request carries one message, "Remember the codeword PELICAN.", and the scripted model answers "Noted: PELICAN." The second request appears in the replay with only its new question, because a replay shows each request's new messages; the transcript itself records that the request sent two earlier messages again. The checks on lines 19 and 20, outside the listing, name those two: the first run's user message and its answer. After both runs the session holds at least four items, and the model, with the first exchange in front of it, answers "The codeword was PELICAN."

The same script runs through a log in our tab. Its first request carries the system prompt "You keep notes." and one user message. Its second request again shows only the new question in the replay, and the transcript records that it repeated three messages: the system prompt, the first question and the first answer. The tab's checks confirm three things: the second request holds three messages besides the system prompt, its first two match the first turn's question and answer word for word, and the log holds both turns. Nothing in the second `runTurn()` call hands the first exchange over. The call leaves out `history`{checked=row-110}, so the runner rebuilds the conversation from the entries the first turn wrote [@buildanagent-harness-readme]. In our harness the log is the session, and the `Session` object is only a handle on it.

LangChain calls the same idea a thread and stores it in a checkpointer. The `thread_id` in a call's config names the thread. The checkpointer "saves a snapshot of graph state at each super-step, organized into **threads**", a super-step being one tick of the agent's graph, such as one model call [@langgraph-checkpointers]. The next call with the same `thread_id` starts from the last snapshot. Our harness names a session with two ids, a user and a session id, so its listing can ask a question that a bare `thread_id` cannot. [[lst:thread-ours]] makes two turns on Ada's session `"a"`, then a turn on her session `"b"` and one from Bob under the id `"a"`. [[lst:thread-langchain]] makes two calls on thread `"a"`, and its replay runs on past the listing to a call on a new thread and one with no thread at all.

::::tabs
:::listing[Our harness]{#thread-ours file="packages/harness/examples/02-session-key.ts" region="sessions" replay}
::note[Every turn is scripted, so the example runs offline. The harness holds one model for all four turns, and each turn picks its session by the key it passes.]{#scripted}
::note[`memoryLock()`{checked=row-134} is an in-memory lock from this example's folder, because the package exports only `fileLock`{checked=row-134}.]{#lock}
::note[The second turn names the same user and the same session id, so the model receives the first exchange before "Who am I?".]{#same-key}
::note[A new session id under the same user starts empty.]{#new-id}
::note[Bob passes Ada's session id with his own user id. The store treats the pair as another session, which has no entries yet.]{#other-user}
::note[Bob's request holds only his question. His turn writes nothing to Ada's log, and his own log holds none of her words.]{#isolation}
:::
:::listing[LangChain]{#thread-langchain file="verify/langchain/examples/05-thread-memory.ts" region="thread" replay}
::note[`MemorySaver` keeps every thread's snapshots inside this process. LangChain's persistence guide warns that it "does not persist between restarts" and points production code at a database-backed checkpointer such as `PostgresSaver`{checked=row-12} [@langgraph-persistence].]{#checkpointer}
::note[The thread's name is any non-empty string your code chooses. `MemorySaver` files each snapshot under it, and nothing ties the name to a user.]{#thread-id}
::note[The second call names the same thread, so the model receives the first exchange before "Who am I?".]{#same-thread}
:::

::::

The LangChain replay follows the thread through four calls. The first sends "I am Ada."; the second, on the same thread, sends "Who am I?", and the check on line 21 confirms that the model saw three messages: the introduction, its answer and the new question. The call on line 22 names thread `"b"`, which starts empty. Its request carries "Who am I?" alone, and the scripted model answers "I don't know your name." A script wrote that reply, but a real model on thread `"b"` would have nothing more to go on. The last call names no thread. Its request still reaches the model, which answers "Hello.", and only after that answer does the call throw an error that names the missing `thread_id`, raised by the checkpointer when it tries to save. So a forgotten `thread_id` costs a model call before it fails.

Our replay also follows four turns. The first sends "I am Ada." with the system prompt. The second repeats the system prompt and the first exchange, which the replay folds, before its new question. The check counts the model's messages apart from the system prompt and finds three: the introduction, the answer and the new question. Ada's session `"b"` and Bob's session `"a"` each send only their question, the system prompt aside, so each starts empty. Our listing has no forgotten-thread case, because a key needs both ids: `append`{checked=row-115}, `load`{checked=row-115} and `delete`{checked=row-115} take the whole key and `list`{checked=row-115} takes the user, so a call with a session id alone does not compile [@buildanagent-harness-readme]. A wrong user is the mistake it can still show. Bob's lookup finds nothing under Ada's id and starts a session of his own, without an error, and Ada's log is untouched.

The chart and the session part ways on cost. A nurse skims the chart for what matters tonight, but your code sends the model the whole session on every call, and the provider bills you for every token of it. A session that runs for weeks therefore becomes a long and expensive request, and [[ch:the-session-log-and-context]] shows how to shorten one without losing what it holds. Before any of that, a session has a plainer job: it has to last until the next run asks for it, and that run may start in another process entirely.

## Saving and resuming a run: the saved state comes back, and your code supplies the rest

You close a novel on page 212 and leave :analogy[a bookmark]{#bookmark} in it. A week later you open the book at the bookmark and read on, with no need to remember where you stopped. A resume works the same way. Your code keeps an id that marks where a session stopped, and a later run, often in a new process on another day, opens the session at that place and goes on.

Saving comes first, and each SDK saves at its own moments. The OpenAI Agents SDK writes a session once a non-streaming run completes; for a streaming run "it writes the user input first and appends streamed outputs once the turn completes" [@openai-agents-sessions]. LangChain's checkpointer saves after every super-step, as the last section showed. The Claude Agent SDK hands the whole job to its command-line program, Claude Code, which the SDK starts for each `query()` call. That process "owns the shell, the working directory, and the JSONL session transcripts on local disk" [@claude-agent-sdk-hosting]. Each turn therefore lands in a file as one JSON object per line, and your own program holds the session only if it keeps the messages the query streams. [[lst:resume-log-ours]] resumes a session from our harness's log, and [[lst:resume-claude]] resumes a Claude Code session from its transcript file.

::::tabs
:::listing[Our harness]{#resume-log-ours file="packages/harness/examples/03-resume-from-log.ts" region="resume" replay}
::note[The store, its index and its lock are what both turns share. They live in memory because our examples write no file, and the lock comes from this example's folder, since the package exports only `fileLock`{checked=row-134}. `jsonlStore()`{checked=row-117} and `fileIndex()`{checked=row-133} keep the same entries and pointers under one folder.]{#store}
::note[Each turn uses a scripted model, so the example runs offline.]{#scripted}
::note[Each turn builds a new harness, a new model and a new `Session`, as a new process would, and opens the session under the same key.]{#fresh}
::note[The resumed turn's first entry in the log follows the first turn's last entry, so the two turns form one chain.]{#linked}
::note[The resumed request holds the codeword from the first turn, which the runner read back from the log.]{#rebuilt}
:::
:::listing[Claude Agent SDK]{#resume-claude file="verify/claude-agent-sdk/examples/06-resume-session.ts" region="resume" replay}
::note[Every result message carries a `session_id`. Claude Code generates it, a UUID, unless you pass your own through the `sessionId`{checked=row-23} option.]{#session-id}
::note[`resume` "Loads the conversation history from the specified session". This second `query()` starts a new Claude Code process, which reads the first run's transcript from disk.]{#resume}
:::

::::

The two calls in the Claude tab never share memory. The first `query()` ends, and its process with it, leaving a transcript file and an id. The second starts a fresh process with `resume: sessionId`, and the example's checks confirm three things: the resumed run succeeds, it keeps the same `session_id`, and the request it sends the model contains PELICAN from the earlier turn. The recorded run shows the third in its second request, which opens with the first prompt and the model's first answer, then adds "What was the codeword?". The example's last check reads the mock server's request log for PELICAN. On a real host, Anthropic's sessions guide adds a limit: "Session files are local to the machine that created them", so resuming on another host needs a `SessionStore`{checked=row-26} that mirrors transcripts to storage you choose [@claude-agent-sdk-sessions].

The same resume in our tab has one limit: it stays in one process, because a book example writes no file. Each of its two turns builds its own harness, model and `Session`, so the store, with its index and its lock, is all that crosses from the first turn to the second, and the second request still carries the first exchange. The checks confirm that both turns finish, that the second turn's first entry follows the first turn's last entry in the log, and that its request holds three messages with PELICAN among them. With `jsonlStore()`{checked=row-117} the entries would sit in a file, one per line, and a process started later could open that file under the same key, through `fileIndex()`{checked=row-133} for the pointer [@buildanagent-harness-readme]. Our tab differs from Claude's in what the resume reads. Claude Code reads a transcript it wrote, and our runner reads the log back into the SDK's context, which the README says "deep-equals the `context` of the run that wrote the log" [@buildanagent-harness-readme].

"Resume" names two different acts, and the next chapter depends on telling them apart:

- **Continuing a conversation.** A new run starts with a new message and the saved history in front of it. Every listing so far does this: our harness's second turn, OpenAI's second run, LangChain's second call, Claude's resumed query.
- **Continuing a paused run.** A run stopped partway, typically because a tool call waits for a person's approval, and the saved snapshot holds the run in mid-turn: the pending call, its arguments and the decisions made so far. The OpenAI Agents SDK saves that snapshot as a `RunState`, which your code turns into a string and later restores with `RunState.fromString()`{checked=row-28} [@openai-agents-human-in-the-loop]. LangChain keeps the pause inside the thread's own checkpoint, and a later call with a `Command` on the same `thread_id` resumes it [@langgraph-persistence].

[[ch:approvals-guardrails-and-injection]] builds approvals on the second act. Everything below applies to both.

### What a resume brings back, and what it leaves behind

A bookmark has the easier job. It only has to keep your place, because the story is printed in the book. A resumed run has to restore whatever was in flight as well, such as a tool call waiting for approval or the tools it is allowed to call, and some SDKs bring back the conversation alone. [[tbl:resume-keeps]] lists what comes back in five SDKs, as of November 2026.

:::table[What a resume brings back, and what your code must supply again]{#resume-keeps}
| SDK | Comes back | Your code supplies again |
| --- | --- | --- |
| OpenAI Agents SDK | A session's stored items; from a paused `RunState`, also the pending calls, approval decisions, usage and your app's context object | The agent, its tools and its model, rebuilt as the same agent graph |
| Claude Agent SDK | The conversation in the transcript | The new call's options, such as its tools and permissions, and every file the agent changed: "Sessions persist the conversation, not the filesystem" |
| LangChain | The thread's state, including a pending interrupt, from whichever checkpointer holds it | The agent and its tools; with `MemorySaver`, everything after a restart |
| GitHub Copilot SDK | The session's history, from the runtime's disk | The custom tools, which a resume without them leaves out |
| Cloudflare Agents | The agent's state and SQL rows, reloaded from its database | Whatever the agent kept in ordinary class fields, which hibernation resets |
:::

The Copilot row comes from `verify/copilot-sdk/examples/06-resume-session.ts`: after a new client resumes the session without passing `tools`, the model's next request offers none of the session's custom tools, though it still carries the earlier turn. The OpenAI row holds the most, because of the `RunState`: its snapshot "includes your app context plus SDK-managed runtime metadata such as approvals, usage, nested `toolInput`{checked=row-33}, and pending nested agent-tool resumptions" [@openai-agents-human-in-the-loop]. So much state in one string makes a snapshot dangerous in the wrong hands, as the last part of this section shows.

### A session id finds a session; your server decides whose it is

Picture Ada's support chat, stored as session `5b3f2c1a-8d4e-4f6b-9a7c-2e1d0f9b8a6c` and reached at a URL that holds that id. Bob, signed in as himself, copies the id from a shared screenshot and sends it with his own message. What happens next depends on where the session lives:

- **LangChain's `MemorySaver`** files snapshots by `thread_id` alone, so Bob's call loads Ada's thread.
- **Our harness's store** keys a session by user and session id together, so Bob's turn under Ada's id finds no session and starts an empty one of his own, as [[lst:thread-ours]] shows.
- **The Claude Agent SDK** looks for the id in every project under one config directory, `~/.claude` unless `CLAUDE_CONFIG_DIR`{checked=row-97} names another. When the current project lacks it, Claude Code "searches beyond the current project directory to find the ID" [@claude-agent-sdk-sessions] and resumes the transcript if exactly one other project holds it [@claude-code-sessions]. So if Ada and Bob share that directory, Bob's call loads Ada's session.
- **Cloudflare Agents** routes a request for `/agents/<class>/<name>` to the agent of that name, so the name in the URL picks the agent unless your Worker checks it first [@cloudflare-agents-routing].
- **ADK's in-memory session service** files each session under its app, its user id and its own id, so a lookup with Bob's user id finds no session with Ada's id, provided your code takes the user id from Bob's sign-in and never from the request.

None of these SDKs is wrong. A session id finds a session and proves nothing about who may open it, as OpenAI's approval guide warns: "A run ID or decision ID is not proof of authorization" [@openai-agents-human-in-the-loop]. The check belongs to your server, and the trusted context of [[ch:tools]] supplies the fact it needs, the signed-in user. We recommend four rules:

1. Generate each session id on the server, randomly, and never accept a new id the client invents. [[lst:thread-owner-langchain]] does so with `crypto.randomUUID()`.
2. Record the owner when you create the session, and look sessions up by owner and id together. ADK and our harness's store do this, and Cloudflare's routing guide does it by refusing any agent name other than `user-${user.id}`{checked=row-41}. [[lst:thread-owner-langchain]] adds the same check to LangChain with a map of owners.
3. Answer a missing session and someone else's session with the same "not found", so the response does not confirm that Ada's id exists. The LangChain listing returns one `NOT_FOUND` for both.
4. Keep transcripts and snapshots where only the server can read them, in a separate store for each user where the SDK allows it.

:::listing[A LangChain server that refuses Bob's call with the same "not found" as an unknown id]{#thread-owner-langchain file="verify/langchain/examples/12-thread-owner.ts" region="server" replay}
::note[The owner map sits beside the checkpointer and, like `MemorySaver`, lives only as long as the process. A real server keeps each thread's owner in its database, next to the thread's id.]{#owners}
::note[A new thread gets a random id from `crypto.randomUUID()`, and the server records its owner in the same step. The caller never invents the id of a new thread.]{#server-id}
::note[Both a thread id with no owner and a thread id owned by another user fail the comparison `owners.get(threadId) !== user`, because a missing id yields `undefined`. Each returns the same `NOT_FOUND` before `agent.invoke` runs.]{#not-found}
::note[Bob sends Ada's thread id. Here `user` stands for the signed-in user, which the server takes from the sign-in and never from the request.]{#bob-adas}
::note[An id that nobody created gets the identical `NOT_FOUND`, so Bob cannot tell whether Ada's id exists.]{#bob-unknown}
::note[Ada's name matches the owner, so her call reaches the model with her first exchange in front of the new question.]{#ada-again}
:::

In the LangChain replay, Bob never reaches the model. Ada's first call starts a thread and sends the model one message, "I am Ada.", and the scripted model answers "Nice to meet you, Ada." Bob's two calls, one with Ada's thread id and one with `"no-such-thread"`, leave no request in the replay, because `chat()` returns before `agent.invoke` runs. The checks outside the listing confirm it: the two refusals serialize to the same JSON, and the model received only two requests. Ada's last call sends "Who am I?" with her first exchange folded in front of it, three messages in all, and the model answers "You are Ada." Her thread ends with four messages, none of them Bob's question. LangChain did nothing wrong here: `MemorySaver` files snapshots by thread id, and the server decides who may ask for one.

Anthropic's hosting guide shows the second rule in its own example: the session id to resume is "looked up from your database by user" [@claude-agent-sdk-hosting]. The same guide shows the fourth. When one container serves several users, which the guide calls tenants, it says to point `CLAUDE_CONFIG_DIR`{checked=row-99} "at a per-tenant directory" and to build each path so "each tenant gets a path no other tenant can read". Claude Code keeps transcripts in that directory's `projects/` folder, so a process started with Bob's directory has no copy of Ada's transcript to find. We keep the ownership check as well, because the separate directory protects Ada only if your server picks it from the signed-in user, never from the request.

### A resumed run trusts whatever was saved

A resumed run treats the saved state as fact, because nothing in the state says who wrote it. The history goes back to the model as earlier turns, so whatever the session holds keeps shaping every later call. In our reading, that includes a tool result that once carried instructions planted for the model, the prompt injection that [[ch:tools]] described. Once such a result is in the session, it rides along on every resume, long after the run that fetched it. A paused run trusts more. A `RunState` restores the approvals already given and your app's context, where [[ch:tools]] keeps the user's id as trusted context. OpenAI's guide draws the consequence: `RunState.fromString()`{checked=row-28} "restores that state; the method does not authenticate the snapshot or the person submitting it" [@openai-agents-human-in-the-loop]. A snapshot that a browser stored and sent back could therefore carry another user's id, or an approval nobody gave.

The guide's remedy is the one we follow: keep the snapshot in storage that only the server reads, send the person approving a call only the details they need and an opaque id, and "Do not accept replacement tool calls, arguments, approval records, or serialized state from the client." Cloudflare's agents need the same care in another place. An agent's state syncs to every connected client, and the state guide warns that "Any client can call setState() to push updates" [@cloudflare-agents-state], unless the agent rejects the change in `validateStateChange`{checked=row-49} or marks the connection read-only. A chart is trusted because only staff write in it. The same has to hold for a session before an agent acts on what it reads there, and an approval, the subject of the next chapter, is the first thing it will act on.

## State lives in eight places, one per SDK

Suppose you ship a new version of your agent at three in the morning, and every process restarts. Which conversations are still there at 3:01? The answer depends on the SDK, because each of the eight SDKs this book verifies keeps its state in a different place by default. [[fig:state-places]] sorts them into three groups.

:::figure[Where each SDK keeps a session by default, as of November 2026]{#state-places}
::svg{alt="Eight boxes in three bands. In memory, lost when the process restarts: OpenAI Agents SDK, MemorySession; LangChain, MemorySaver; Google ADK, InMemorySessionService. On the host's disk, lost with the machine: Claude Agent SDK, ~/.claude/projects; Pi, ~/.pi/agent/sessions; Copilot SDK, ~/.copilot. Elsewhere, as durable as that store: Cloudflare Agents, the agent's own SQLite; Vercel AI SDK, the messages you keep."}
:::

The top band empties at 3:01. Its three defaults hold every session in your process's memory, and each SDK says so: OpenAI calls `MemorySession` "intended for demos or tests", LangChain says `MemorySaver` "does not persist between restarts", and ADK's state guide says its `user:` and `app:` keys are "Stored by `InMemory`{checked=row-55} but lost on restart" [@adk-session-state]. The middle band survives a process restart and dies with the machine: Claude's hosting guide warns that its transcripts do not survive "a container restart, a scale-down, or a move to a different node" [@claude-agent-sdk-hosting]. The bottom band survives both, for opposite reasons. Cloudflare keeps each agent's state in a database the platform gives that agent. The Vercel AI SDK keeps nothing: the `messages` array your code passes back is the whole state, so it lasts as long as the database you put it in. [[tbl:state-table]] adds three columns: the durable option for each default, who makes the session's id, and whether a lookup is scoped by user, the question from the previous section.

:::table[Where each SDK keeps a session, who names it, and whether a lookup checks the user, as of November 2026]{#state-table}
| SDK | Default store | A store that survives a restart | Who makes the id | Lookup scoped by user |
| --- | --- | --- | --- | --- |
| OpenAI Agents SDK | `MemorySession`, in process memory | OpenAI's Conversations API, or your own `Session` | The SDK, a random UUID, unless you pass one | No; your own `Session` decides |
| Claude Agent SDK | JSONL files under `~/.claude/projects/` | A `SessionStore` that mirrors them | Claude Code, a UUID, unless you pass one | No; any id under the same config directory resumes |
| LangChain | `MemorySaver`, in process memory | A database checkpointer, such as Postgres | Your code: the `thread_id` | No |
| Google ADK | `InMemorySessionService` | Database and Vertex AI session services | The SDK, a random UUID, unless you pass one | Yes for `getSession`{checked=row-103}: app, user and session id together; `listSessions` needs the user passed |
| Cloudflare Agents | The agent's own SQLite database | The same; it is already durable | Your code or the URL: the agent's name | No; your Worker checks the name |
| Pi | A JSONL tree under `~/.pi/agent/sessions/` | The same files, or a folder you choose | The SDK, a time-ordered UUID, unless you pass one | No; a session opens by its file path |
| GitHub Copilot SDK | The runtime's disk under `~/.copilot` | The same, under the `baseDirectory`{checked=row-64} you set | The runtime, unless you pass one | No user parameter in `resumeSession`{checked=row-64} |
| Vercel AI SDK | Nothing; you keep `messages` | Whatever store you write them to | Your code | Your code |
:::

Two of the eight keep more than a conversation. ADK and Cloudflare also hold *state*, named values that tools and your code read and write beside the messages, and both scope or store it in ways worth seeing. Switch tabs to compare them.

::::tabs
:::listing[Google ADK]{#state-adk file="verify/google-adk/examples/04-sessions-state.ts" region="state-prefixes"}
::note[A key with no prefix belongs to this session alone.]{#session-key}
::note[A `user:` key is shared by every session of the same user in the same app. The example's checks find Alice's second session reading the note from her first, and Bob's session reading none.]{#user-key}
::note[An `app:` key is shared by every user of the app, so one user's data must never go here. Bob's new session reads a total of 2, both of them Alice's notes.]{#app-key}
::note[A `temp:` key lasts one invocation, the work from one user message to the final answer, and is dropped after it.]{#temp-key}
:::
:::listing[Cloudflare Agents]{#state-cloudflare file="verify/cloudflare-agents/examples/01-state.ts" region="counter-agent"}
::note[An agent's first read of `this.state` saves `initialState` to its database, and that first save fires `onStateChanged`, a surprise the example's checks record.]{#initial-state}
::note[`setState` saves the new state to the agent's SQLite database and sends it to every connected client.]{#set-state}
::note[The hook runs after each change, with the source `"server"` when your code made it. A change pushed by a client arrives here with that client's connection as the source.]{#on-change}
:::
::::

The ADK listing turns the scoping question into keys, and its four prefixes come from ADK's state guide [@adk-session-state]. The prefix decides who else can read a value, so a tool that writes a customer's address under `app:` hands it to every other user of the app. Cloudflare's agent is the 3:01 survivor. Each agent instance is a Durable Object, a small stateful server that Cloudflare runs once per name, with its own SQLite database. Its `setState` "Saves to SQLite (persistent)" and "Broadcasts to all connected clients" [@cloudflare-agents-state]. The state comes back after Cloudflare evicts the agent from memory, because it never lived only there, while the same instance's ordinary class fields, such as the listing's `changes` array, start empty again.

Read the table by its last column before you choose. Of the eight SDKs, only ADK scopes a session lookup by user (our harness's store does too, as the ownership section showed): `getSession`{checked=row-104} asks for the user id, though `listSessions` returns every user's sessions unless your code passes one. Every other SDK leaves the check to you, which the previous section's four rules supply. For the rest, we match the store to where the agent runs: memory for a test, a database for a server that restarts, and the platform's own storage where the platform gives each agent one.

## Long-term memory needs a different store, and a later chapter

A session remembers one conversation, however many runs it spans. Ada's ticket about a double charge can stay open for a week and a dozen runs, and every run sees the whole thread. Now suppose she writes again in March about something else, and you want the agent to know that she prefers replies in Portuguese. That fact belongs to Ada, not to November's ticket, so it needs a store that outlives any one session. LangChain's documentation draws the same line: a checkpointer keeps "short-term, thread-scoped memory", while a store keeps "long-term, cross-thread memory, including user preferences, facts, and shared knowledge" [@langgraph-persistence]. ADK's `user:` keys from the last section sit on that line, shared by every session of one user.

Long-term memory raises questions that a session never does. Which facts are worth keeping? When should the agent recall one, and when forget it? And how does it check a recalled fact against its source before acting on it? [[ch:retrieval-and-long-term-memory]] answers them. Before it, [[ch:the-session-log-and-context]] returns to the session itself, as a tree of entries that can branch and be compacted without losing what it holds.

Until then, treat the session as the chart for the task in hand. Your server keeps it where it survives the restarts you expect, looks it up by the user who owns it, and expects a resume to bring back only what was saved. The next chapter writes a pause into that chart: a tool call that waits, inside a saved session, until a person approves it.

## Exercises

1. **Resume from a saved copy, as a fresh process would.** In `verify/openai-agents-sdk/examples/06-session.ts`, keep the first run as it is. Before the second run, save the session's items as a string with `const saved = JSON.stringify(await session.getItems());`{checked=row-81}, then give the second run a new session built from that string, `{ session: new MemorySession({ initialItems: JSON.parse(saved) }) }`{checked=row-81}. A new process that read `saved` from your database would start with exactly that and nothing else. Before you run anything, predict which of the file's four checks pass and which fails first; `check()` throws at its first failure, so the checks after it never run. Run `pnpm test` in `verify/openai-agents-sdk` and read the example's entry in `results/run-examples.json`. Then point the failing check at the session the second run used, run the tests again, and list what came back with the saved items and what your code had to build again. When you are done, run `git checkout -- examples results` in that folder to restore the file, its transcript and the results.
2. **Resume a session that was never saved.** In `verify/claude-agent-sdk/examples/06-resume-session.ts`, add `persistSession: false`{checked=row-83} to the first query's options. The second query still starts a fresh Claude Code process and still asks for the first run's `session_id`. Predict whether the first run still returns an id, and which check fails first. Run `pnpm test` in `verify/claude-agent-sdk` to find out. Then replace every line after `// #endregion` with `console.log(JSON.stringify(second.result));`, run the tests again, and read the resumed run's result in the example's entry in `results/run-examples.json`. What does it say, and what would your server see if it resumed an id whose transcript a container restart had deleted? Restore the folder with `git checkout -- examples results` when you are done.
3. **Check whose session it is.** In `verify/google-adk/examples/04-sessions-state.ts`, after the three checks on Alice's first session, add two checks: that fetching her session's id with Bob's user id returns `undefined`, and that fetching it with Alice's returns the session. Predict both, then run `pnpm test` in `verify/google-adk` and restore the folder with `git checkout -- examples results`. Then, on paper, write the function a server would call before LangChain's `agent.invoke`, given the signed-in user and the thread id a request names. Apply this chapter's four rules, remembering that `MemorySaver` checks no user. What does your function return when Bob names Ada's thread, and when he names a thread that does not exist?
