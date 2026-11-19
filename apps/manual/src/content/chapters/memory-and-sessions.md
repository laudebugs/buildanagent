---
title: "Memory within a task: sessions, threads and resuming"
summary: A model keeps nothing between calls, so an agent's memory is a session that your SDK or your code stores and sends back. This chapter shows how sessions and threads carry a conversation between runs, what a resume in a fresh process brings back and what it drops, who may use a session id, and where each of eight SDKs keeps its state.
opening: analogy
sources: [openai-agents-sessions, langgraph-checkpointers, langgraph-persistence]
glossary: [session, checkpointer]
switchTo: [N3, N6]
---

At seven in the evening a nurse starts her shift on a ward she left twelve hours earlier. The man in bed 12 arrived after she went home. She never saw his fever peak at noon, the antibiotic the day nurse gave at two, or the note that he is allergic to penicillin. Within a minute of reaching his bed she knows all three, because :analogy[the patient's chart]{#patients-chart} travels with him from shift to shift, and everyone who treated him wrote in it. Nobody on the ward expects her to remember the day. They expect her to read.

:::figure[A patient's chart that travels with them between shifts: each nurse reads what the last one wrote]{#patients-chart analogy="patients-chart"}
::svg{alt="A hospital chart for bed 12 on a clipboard, with three entries: 12:00 fever 38.9, 14:00 antibiotic, and allergy: penicillin, which is highlighted. On the left, the day shift writes in the chart; on the right, the night shift reads it. A note under the chart says the night nurse remembers nothing of the day; she reads the chart."}
:::

A model meets every request the way that nurse meets bed 12. [[ch:talking-to-a-model]] showed that the model keeps nothing between calls, so a conversation lasts only because your code sends it again. Within one run, the agent loop does that resending for you. Between runs, the job falls to whatever keeps the chart: the user comes back tomorrow, the server restarts overnight, or an approval waits an hour for a person to click. This chapter follows the chart through five SDKs' examples and then all eight SDKs: how a session carries a conversation from one run to the next, how a run is saved and resumed in a fresh process, and where each SDK keeps its state. By the end you can choose where your agent's sessions live, say what a resume brings back and what it drops, and make sure the session a request resumes belongs to the user who sent it.

## A session keeps the conversation between runs, and a thread id names it

A run is one call of the SDK's run function: a new user message goes in, the loop takes as many turns as it needs, and one answer comes out. A session is the stored history that outlives the run, every message, tool call and tool result so far. Before a run, the SDK reads the session and puts its items in front of the new message; after the run, it appends what the run added. The OpenAI Agents SDK's guide names both duties: before each run the runner "retrieves the session history, merges it with the new turn's input", and after a non-streaming run "one call to `session.addItems()`{checked=row-6} persists both the original user input and the model outputs from the latest turn" [@openai-agents-sessions]. [[lst:session-openai]] makes two runs against one session.

:::listing[Two runs share one session, so the second run's request carries the first]{#session-openai file="verify/openai-agents-sdk/examples/06-session.ts" region="session" replay}
::note[`MemorySession` keeps the items in an array inside this process. It generates a random id for itself unless you pass a `sessionId`{checked=row-7}, and its own documentation calls it "intended for demos or tests".]{#memory-session}
::note[The first run starts from an empty session and leaves two items in it: the user's message and the model's answer.]{#first-run}
::note[The second run passes the same session, so the SDK puts the first run's two items in front of the new question.]{#second-run}
:::

The replay shows the chart being read. The first request carries one message, "Remember the codeword PELICAN.", and the scripted model answers "Noted: PELICAN." The second request appears in the replay with only its new question, because a replay shows each request's new messages; the transcript itself records that the request sent two earlier messages again. The checks on lines 19 and 20, outside the listing, name those two: the first run's user message and its answer. After both runs the session holds at least four items, and the model, with the first exchange in front of it, answers "The codeword was PELICAN."

LangChain calls the same idea a thread and stores it in a checkpointer. The `thread_id` in a call's config names the thread. The checkpointer "saves a snapshot of graph state at each super-step, organized into **threads**", a super-step being one tick of the agent's graph, such as one model call [@langgraph-checkpointers]. The next call with the same `thread_id` starts from the last snapshot. [[lst:thread-langchain]] makes two calls on thread `"a"`, and its replay runs on past the listing to a call on a new thread and one with no thread at all.

:::listing[Two calls on one thread: the checkpointer carries the first into the second]{#thread-langchain file="verify/langchain/examples/05-thread-memory.ts" region="thread" replay}
::note[`MemorySaver` keeps every thread's snapshots inside this process. LangChain's persistence guide warns that it "does not persist between restarts" and points production code at a database-backed checkpointer such as `PostgresSaver`{checked=row-12} [@langgraph-persistence].]{#checkpointer}
::note[The thread's name is any non-empty string your code chooses. `MemorySaver` files each snapshot under it, and nothing ties the name to a user.]{#thread-id}
::note[The second call names the same thread, so the model receives the first exchange before "Who am I?".]{#same-thread}
:::

The replay follows the thread through four calls. The first sends "I am Ada."; the second, on the same thread, sends "Who am I?", and the check on line 21 confirms that the model saw three messages: the introduction, its answer and the new question. The call on line 22 names thread `"b"`, which starts empty. Its request carries "Who am I?" alone, and the scripted model answers "I don't know your name." A script wrote that reply, but a real model on thread `"b"` would have nothing more to go on. The last call names no thread. Its request still reaches the model, which answers "Hello.", and only after that answer does the call throw an error that names the missing `thread_id`, raised by the checkpointer when it tries to save. So a forgotten `thread_id` costs a model call before it fails.

The chart and the session part ways on cost. A nurse skims the chart for what matters tonight, but the model is sent the whole session on every call and bills every token of it. A session that runs for weeks therefore becomes a long and expensive request, and [[ch:the-session-log-and-context]] shows how to shorten one without losing what it holds. Within a single run, though, the session's job is simpler: it has to survive until the next run asks for it, which may be in another process entirely.

## Exercises

1. Placeholder until the exercises are written.
