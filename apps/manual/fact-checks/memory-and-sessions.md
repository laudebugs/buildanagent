# Fact-check: Memory within a task: sessions, threads and resuming

The claims log for [`memory-and-sessions.md`](../src/content/chapters/memory-and-sessions.md), checked section by section as each was drafted (BK21). Each row names the claim, the section it sits in, the verdict and the primary source. Pages were read on 2026-11-19. Package claims are checked against the harness pins of that date: `@openai/agents@0.21.0` (with `@openai/agents-core@0.21.0`), `@anthropic-ai/claude-agent-sdk@0.3.327` (bundling Claude Code 2.1.327), `langchain@1.6.1` (with `@langchain/langgraph@1.6.0` and `@langchain/langgraph-checkpoint@1.2.3`), `@google/adk@2.5.0`, `agents@0.33.0` (Cloudflare), `@earendil-works/pi-coding-agent@1.5.2`, `@github/copilot-sdk@1.0.31` and `ai@7.0.162`. A file named as `dist/…` or `sdk.d.ts` sits inside that package as installed.

## The research question, answered before drafting

**Question.** Where does an agent's memory live between turns and between runs, and what does each SDK keep for you?

**Answer, from the todo's sources only.** Between turns, nowhere but the request: a model keeps nothing, so whatever it should remember goes back to it in the next request ([Using the Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages): the API "is stateless"). Between runs, the memory is a *session*: a stored list of the conversation's items that the SDK, or your code, loads before a run and appends to after it. The [deep comparison](../../../docs/comparison/deep-comparison.md#state-lives-in-eight-places) finds that each of the eight SDKs keeps that list somewhere different, and the pinned packages confirm it:

- the OpenAI Agents SDK keeps it behind a `Session` interface, in process memory with `MemorySession` or on OpenAI's servers with `OpenAIConversationsSession`, and keeps a paused run separately, as a serialized `RunState` ([Sessions](https://github.com/openai/openai-agents-js/blob/v0.21.0/docs/src/content/docs/guides/sessions.mdx), [Human-in-the-loop](https://github.com/openai/openai-agents-js/blob/v0.21.0/docs/src/content/docs/guides/human-in-the-loop.mdx));
- the Claude Agent SDK's CLI writes a JSONL transcript per session under `~/.claude/projects/`, which a `SessionStore` can mirror ([Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting));
- LangChain saves each thread's state in a LangGraph checkpointer under the `thread_id` you pass, in memory with `MemorySaver` or in a database ([Persistence](https://github.com/langchain-ai/docs/blob/9d9747d0cf241e086c616a16d5ce230ad8f8f31d/src/oss/langgraph/persistence.mdx));
- ADK files sessions under app, user and session id in a session service, and scopes state keys by prefix ([State](https://github.com/google/adk-docs/blob/ff7a5f56469a81f3e43a8fc54668d8dc84300192/docs/sessions/state.md));
- Cloudflare Agents keeps state in each agent's own SQLite database inside a Durable Object ([State](https://github.com/cloudflare/agents/blob/agents@0.33.0/docs/agents/state.md));
- Pi writes a JSONL tree under `~/.pi/agent/sessions/`, Copilot's runtime writes under `baseDirectory`, and the Vercel AI SDK keeps nothing: the `messages` you pass back are the state.

What an SDK keeps is the conversation, and sometimes a paused run; what it does not keep is everything else a run depends on: the tools, the options and permissions of the new call, the files the agent touched, and the process's own memory. Resuming is therefore two different acts: a new run over a saved history, or the continuation of a paused run from a saved snapshot. The second is what approvals need ([harness guide §2](../../../docs/guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): "Pauses must be entries, because a callback dies with its process").

**The security finding that shapes the chapter.** A session id finds a session, and in most SDKs nothing more. LangChain's `MemorySaver` keys storage by `thread_id` alone, the Claude CLI looks for a resumed id beyond the current project directory, and Cloudflare routes `/agents/<class>/<name>` to whatever name the URL holds. Only ADK files sessions under a user id, so a lookup with the signed-in user's id cannot reach another user's session. OpenAI's own guide warns that `RunState.fromString()` "does not authenticate the snapshot or the person submitting it". The chapter therefore teaches: generate the id on the server, record its owner, look it up together with the signed-in user, keep saved state on the server, and treat everything a resumed run loads as something your code wrote and must still trust.

**The one-line rule the chapter teaches.** Keep the chart where your server owns it, look it up by the signed-in user, and expect a resume to bring back the conversation and nothing else.

**Gap.** No source measures how often agents fail because a resume dropped tools or options; the chapter states the behaviour each SDK documents or our examples show, and claims no rate.

## Outline and opening

The planned opening type is `analogy` (Chapter 4 opens with a question). Sections, each with its one-line head:

1. **Opening.** The patient's chart that travels between shifts: the next nurse reads, she does not remember. What the chapter builds.
2. **A session keeps the conversation between runs, and a thread id names it.** A run against a session: the SDK loads the stored items, the model rereads them, and the run appends its own. OpenAI's `MemorySession` and LangChain's thread, with replays.
3. **Saving and resuming a run: the id comes back with the history, and nothing else.** The bookmark; what is saved and when; resuming a conversation versus resuming a paused run; the Claude Agent SDK's resume in a fresh process; what comes back and what does not; who makes the id and who may use it; what a resumed run trusts. Chapter 6 builds on this section.
4. **State lives in eight places, one per SDK.** The figure; where each SDK keeps state by default, what survives a restart, who generates the id and whether lookups are scoped by user; ADK's prefixes and Cloudflare's per-agent database as listings.
5. **Long-term memory is a later chapter.** What a session is not, and where the book takes it next.
6. **Exercises.**

## Analogy vetting

| Analogy | What it explains | Could it mislead? | Verdict |
| --- | --- | --- | --- |
| A patient's chart that travels with them between shifts (session) | The model, like the next nurse, keeps nothing; the session is the written record each turn reads | A nurse skims a chart and reads only what matters; a model is sent the whole stored history on every call and is billed for it, which the break note says. A chart also outlives the patient's stay in one bed, which fits a session that outlives a process. The analogy says nothing about who may open the chart, so the chapter does not lean on it for access control | Use, with the todo's break note; illustrated (flat) |
| A bookmark (resume) | A resume finds the place where the run stopped and goes on from there | A bookmark restores only the place; a resumed run must also restore pending approvals and tool state, and in most SDKs it brings back the conversation only. The break note says so, and the section turns on that difference | Use, with the todo's break note; no illustration |

Neither analogy is in `analogies.json` (which holds Chapters 1–3's ten), and neither is near any of them: the ticket rail is about the loop's order, the tour guide's card about the system prompt, passport control about identity.

## Opening and § A session keeps the conversation

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
