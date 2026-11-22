# What our repository already says about retrieval and long-term memory (as of November 2026)

Research notes, gathered 2026-11-19 from this repository on branch `todo/U18-retrieval-and-long-term-memory`, at `main` commit `138527e`. Every claim below cites a file in the repo; nothing was fetched from outside.

## The main report and the harness guide

### Takeaway
The repo's position is "files first, services later". Retrieval appears as one clause of layer 5 ("just-in-time retrieval by reference"), and memory as layer 6 ("Progress files, JSON task lists and git history before vector or graph memory; skills as procedural memory"). Neither document says how memory that outlives a task is written, recalled or forgotten, and neither discusses keyword or vector search.

### Cited Findings
- Layer 5 row: "Tool-result clearing first, then summarizing compaction; keep the raw log so compaction stays recoverable; just-in-time retrieval by reference; subagents return condensed summaries" — [main report, line 96](../../agent-sdks-and-harness-design.md)
- Layer 6 row: "Build files first; buy services later" and "Progress files, JSON task lists and git history before vector or graph memory; skills as procedural memory" — [main report, line 97](../../agent-sdks-and-harness-design.md)
- Memory paragraph: Anthropic's long-running harness writes `init.sh`, a progress log and a JSON feature list of more than 200 entries; JSON because the model is less likely to overwrite it than Markdown. Zep disputed Mem0's LOCOMO comparison. "Buy a memory service only when you need cross-user personalization." — [main report, "Planning should start as ReAct"](../../agent-sdks-and-harness-design.md#planning-should-start-as-react-and-earn-every-extra-agent)
- AGENTS.md's planned architecture, item 6: "File-based memory first." — [AGENTS.md](../../../../AGENTS.md#planned-architecture-when-code-starts)
- Harness guide §3: five context layers; layer 1 caps tool output at 64 KiB and "spill[s] the full text to a file the agent can re-read by path", which is retrieval by reference applied to the agent's own tool output. Long tasks "keep state in files, not summaries", and the harness ships "a plan and progress file convention with a hook that re-reads it on resume" — [harness guide §3](../../../guides/agent-harness.md#3-context-policy-should-run-five-removable-layers-cheapest-first-and-keep-every-compaction-visible-and-reversible)
- Harness guide, reference architecture: "memory as files is layer 6" — [harness guide](../../../guides/agent-harness.md)
- Harness guide's staged path adds "long-term memory" only "when a specific failure" calls for it — [harness guide, line 255](../../../guides/agent-harness.md)

## The harness plan

### Takeaway
The harness plan builds the seams retrieval needs (deferred tools, tool search, `transformContext`, a file read tool) and the plan-file convention, but no long-term memory component, no memory tool, no search tool and no forgetting rule beyond session retention.

### Cited Findings
- Built-in tools: `src/tools/ ToolRegistry, tool search, built-ins (read, write, edit, bash, fetch)`. No `grep` or `glob` built-in; code search runs through `bash` — [build-harness.md §3](../../../plans/build-harness.md#3-package-and-module-layout)
- Tool exposure `"direct" | "deferred" | "hidden"`, MCP defaulting to `"deferred"`: tool search is retrieval over tool definitions — [build-harness.md §3.3](../../../plans/build-harness.md#33-context-policy-and-tool-registry-apis)
- N23 (skills, context files and the plan-file convention): skills advertised by name, description and path with the body loaded through `read`; `AGENTS.md` and `CLAUDE.md` re-injected after compaction; `.agents/plan.md` and `progress.json` with a resume hook that re-reads them — [N23](../../../todos/ready/N23-skills-context-files.md)
- HD11: transcripts kept with "No automatic deletion by default"; a `retention` setting `{ days, action: "archive" | "purge" }`; `archive` gzips expired sessions "and keeps them searchable" — [HD11](../../../plans/build-harness.md#hd11-keep-transcripts-until-the-owner-sets-a-retention-period-and-keep-the-entry-base-stable-accepted)
- Implication (our inference): a fact deleted from a future memory store would survive in the session log, an archive and any summary entry unless retention or a purge reaches them too. The plan has no per-fact deletion.

## The agent guide

### Takeaway
The agent guide already treats retrieval as the cheapest shape ("one well-prompted call with retrieval") and makes grounding in tool-retrieved text a safety rule.

### Cited Findings
- Question 1 of four: "Does one well-prompted call with retrieval do the job? Ship that call; Anthropic says this is enough 'for many applications'." — [agent guide §2](../../../guides/agent.md#2-choose-the-least-autonomy-the-task-allows-a-workflow-in-code-with-one-bounded-loop-for-the-ambiguous-middle)
- Incident table, Air Canada: "grounding: policy claims come only from tool-retrieved text, graded by the grounding slice" — [agent guide §7](../../../guides/agent.md#7-ship-in-four-stages-behind-a-graded-kill-switch-hand-off-to-people-by-design-and-turn-each-incident-into-a-regression-task)

## The book plan and its todos

### Takeaway
Chapter T36 has four planned sections and two existing examples; T41 is to add one retrieval example in `verify/vercel-ai-sdk/` with keyword search or a deterministic vector index and no new dependency. Neither existing example shows recall across runs or forgetting, which T36's exercise asks for.

### Cited Findings
- T36's sections: "Just-in-time retrieval through tools versus pre-loaded context; Vector and keyword search, and their failure modes (OWASP LLM08); Long-term memory across runs: what to store, when to recall, when to forget; When to buy a memory service (main report) and when a file is enough" — [book plan §4.2, row 12](../../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders)
- T36's exercise: "Store a fact in one run, recall it in the next, then expire it and show it is gone." — [T36](../../../todos/ready/T36-chapter-retrieval-and-long-term-memory.md)
- T36's analogies: reference librarian (retrieval), card file (long-term memory), office shredding schedule (forgetting), with the break for forgetting: "deleting a fact from memory does not delete it from logs or caches unless the harness does" — [T36](../../../todos/ready/T36-chapter-retrieval-and-long-term-memory.md)
- T41: "keyword search or a vector index with deterministic embeddings"; "use no embedding API and no new dependency unless the owner approves one"; a scripted turn where "the top result is wrong" — [T41](../../../todos/done/T41-example-retrieval.md)
- T41 notes that the `search` tools in `claude-agent-sdk/04-max-turns.ts` and `openai-agents-sdk/08-max-turns.ts` "return a fixed '3 hits' to test a turn cap" — [T41](../../../todos/done/T41-example-retrieval.md)
- T36's switch todo is N23 — [book plan §4.2, row 12](../../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders)
- T15 covers memory within a task and says "long-term memory is a later chapter" — [book plan §4.1, row 5](../../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents)

## The existing examples

### Takeaway
`langchain/09-long-term-store.ts` writes and reads a fact in one run against one `InMemoryStore`; `cloudflare-agents/02-sql.ts` stores notes in the agent's SQLite and finds them with `LIKE`. Both are building blocks; neither recalls in a second run or expires anything.

### Cited Findings
- `09-long-term-store.ts`: a `remember` tool calls `runtime.store.put(["users", "ada"], "fact", { fact })` and `get`; one `createAgent(...).invoke(...)`; header notes that core's `ToolRuntime` declares a key-value `BaseStore` (`mget`/`mset`) so typed code must cast — [verify/langchain/examples/09-long-term-store.ts](../../../../verify/langchain/examples/09-long-term-store.ts)
- `02-sql.ts`: `NotesAgent` with `this.sql` template tag, `find(term)` uses `WHERE body LIKE ${`%${term}%`}`; checks that interpolated values are bound parameters and that the SDK's `cf_agents_*` tables share the database — [verify/cloudflare-agents/examples/02-sql.ts](../../../../verify/cloudflare-agents/examples/02-sql.ts)
- Feature table, Memory row: Claude "Memory files and auto memory", Pi "`AGENTS.md` context files", OpenAI "—", Vercel "Provider memory tools, memory providers or a custom tool", LangChain "A store reached as `runtime.store`", Cloudflare "`this.state` and `this.sql`", ADK "`user:` and `app:` state keys span sessions", Copilot "Not covered in our reference" — [feature table](../../../comparison/feature-table.md)

## Gaps
- No plan names a memory record format, a write rule, a recall rule or a forgetting rule.
- No plan says where a retrieval index would live on each of the four targets (local Node, Cloudflare, AWS, Vercel).
- The feature table's Memory row mixes cross-session state (ADK `user:` keys, Cloudflare `this.state`) with long-term memory; the SDK notes in this folder separate them.
