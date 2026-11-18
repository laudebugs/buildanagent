# Agent rewind mechanisms and their boundary with external systems (as of November 2026)

> **Working material** for [Rewind moves the agent, never the data](../rewind-vs-rollback.md) (U7). The report and [its fact-check](../fact-check-rewind.md) supersede this note where they disagree; its findings are left as first written.

Scope: what each framework's "go back" feature captures, what restoring does, and where it stops. Collected 2026-11-18. Local paths are in this repo (`/home/user/agent-speak`, commit `13b28a93`); upstream URLs and commits/tags come from each mirror's `_manifest.json`.

Versions pinned (as of November 2026):

| Framework | Version checked | Source |
|---|---|---|
| LangGraph JS | `@langchain/langgraph` 1.6.0 (`langchain` 1.6.1) | `verify/langchain/package.json` |
| LangGraph Python | `langgraph` 1.2.22, uploaded 2026-11-14 (PyPI; latest as of 2026-11-18) | [PyPI JSON](https://pypi.org/pypi/langgraph/json) |
| LangChain docs mirror | `langchain-ai/docs` commit `9d9747d0cf24`, 2026-11-17; manifest notes "No docs tag matches the pinned npm versions; pages may describe newer releases" | `docs/reference/langchain/source/_manifest.json` |
| Pi | `@earendil-works/pi-coding-agent` / `pi-agent-core` 1.5.2; docs from tag `v1.5.2`, commit `b4afdddf44e0` | `docs/reference/pi/source/_manifest.json` |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` 0.3.327; docs fetched 2026-11-18 from code.claude.com | `verify/claude-agent-sdk/package.json`, `docs/reference/claude-agent-sdk/source/_manifest.json` |
| Google ADK TS | `@google/adk` 2.5.0 (npm `latest`, published 2026-11-12) | [npm registry](https://registry.npmjs.org/@google/adk) |
| Google ADK Python | `google-adk` 2.14.1, uploaded 2026-11-12 (PyPI latest) | [PyPI JSON](https://pypi.org/pypi/google-adk/json) |
| ADK docs mirror | `google/adk-docs` commit `ff7a5f56469a`, 2026-11-17 (site renders `main`) | `docs/reference/google-adk/source/_manifest.json` |
| Copilot SDK | `@github/copilot-sdk` 1.0.31 | `verify/copilot-sdk/package.json` |
| OpenAI Agents JS | `@openai/agents` 0.21.0; docs tag `v0.21.0` | `docs/reference/openai-agents-sdk/source/_manifest.json` |
| Vercel AI SDK | `ai` 7.0.162; docs tag `ai@7.0.162` | `docs/reference/vercel-ai-sdk/source/_manifest.json` |
| Cloudflare | `agents` 0.33.0, `@cloudflare/think` 0.23.0 | `docs/reference/cloudflare-agents/source/_manifest.json` |

## LangGraph: checkpoints, time travel, interrupts and durability

### Takeaway
LangGraph's "time travel" restores *graph state* (a `StateSnapshot` saved at each super-step) and then **re-executes** every node after the chosen checkpoint, so LLM calls and API requests fire again; "fork" via `update_state` appends a new branch rather than rolling anything back. The docs say outright that payments, emails and external writes sit outside the checkpoint boundary and must be made idempotent by application code.

### Cited Findings
- Checkpointers enable human-in-the-loop, memory, time travel ("replay prior graph executions ... fork the graph state at arbitrary checkpoints"), fault tolerance and pending writes. — [checkpointers.mdx L22-29](https://github.com/langchain-ai/docs/blob/9d9747d0cf241e086c616a16d5ce230ad8f8f31d/src/oss/langgraph/checkpointers.mdx) (local: `docs/reference/langchain/source/src/oss/langgraph/checkpointers.mdx`)
- A checkpoint is "a snapshot of the graph state saved at each super-step", represented by `StateSnapshot`; checkpoints are created at each super-step boundary and "you can only resume execution from a checkpoint (i.e., a super-step boundary)". Per-node writes go to `checkpoint_writes` as task entries for pending-writes recovery, but "are not full `StateSnapshot` checkpoints, so time travel resumes from full checkpoints at super-step boundaries." — checkpointers.mdx L91-99
- Addressing: `thread_id` identifies saved state; passing `checkpoint_id` in `configurable` selects a specific snapshot, e.g. `{"configurable": {"thread_id": "1", "checkpoint_id": "1ef663ba-..."}}` with `graph.get_state(config)` / `graph.getState(config)`. — checkpointers.mdx L61, L234-259
- Invocation table: `invoke(None, config)` "Loads the latest checkpoint and retries unfinished work"; `Command(resume=...)` — "The interrupted node starts again from its beginning"; "Replay history: `graph.invoke(None, snapshot.config)` ... re-executes nodes after that checkpoint". Same table for JS (`getStateHistory()`, `new Command({ resume })`). — checkpointers.mdx L63-83
- Time travel = Replay and Fork. "Nodes before the checkpoint are not re-executed (results are already saved). Nodes after the checkpoint re-execute, including any LLM calls, API requests, and interrupts (which may produce different results)." — [use-time-travel.mdx L14](https://github.com/langchain-ai/docs/blob/9d9747d0cf241e086c616a16d5ce230ad8f8f31d/src/oss/langgraph/use-time-travel.mdx)
- Replay warning: "Replay re-executes nodes—it doesn't just read from cache. LLM calls, API requests, and interrupts fire again and may return different results." — use-time-travel.mdx L22
- Fork warning: "`update_state` does **not** roll back a thread. It creates a new checkpoint that branches from the specified point. The original execution history remains intact." — use-time-travel.mdx L131. `update_state` applies values through the node's writers/reducers; `as_node` controls which node is recorded as the writer and therefore where execution resumes. — use-time-travel.mdx "From a specific node" section
- Interrupts: "the runtime restarts the entire node from the beginning—it does not resume from the exact line where `interrupt` was called. This means any code that ran before the `interrupt` will execute again." — [interrupts.mdx L1023](https://github.com/langchain-ai/docs/blob/9d9747d0cf241e086c616a16d5ce230ad8f8f31d/src/oss/langgraph/interrupts.mdx)
- "Side effects called before `interrupt` must be idempotent": an API call that updates a record before `interrupt` "will be re-run multiple times when the node is resumed, potentially overwriting the initial update or creating duplicate records." Recommended: idempotent ops (upsert), side effects after `interrupt`, or in separate nodes; "If a node fails after committing a side effect but before completing, retrying the node can repeat the effect. Use idempotent operations or deduplicate writes in the external system." — interrupts.mdx L1365-1375, L1483
- Retry semantics: a retry "gives **at-least-once** semantics for node execution ... It does not make external side effects happen exactly once." — [fault-tolerance.mdx L279](https://github.com/langchain-ai/docs/blob/9d9747d0cf241e086c616a16d5ce230ad8f8f31d/src/oss/langgraph/fault-tolerance.mdx)
- Boundary statement (≤25 words): "Graph writes from a failed attempt are discarded. Side effects during the node (payments, emails, external writes) are outside that boundary." — fault-tolerance.mdx L286
- Idempotency key guidance: the key "must already be durable **before** the side effect runs"; derive it from durable state (e.g. `charge:{order_id}`) or persist it in a prior node under `sync` durability. If the provider commits and the ack is lost, "Treat missing local state as unknown, not as proof the effect did not happen. Query the provider for the operation's status before compensating or continuing." Non-idempotent effects should move out of retryable nodes. — fault-tolerance.mdx L290-377
- Same re-execution model "after an interrupt or a crash resume"; wrap units in a `task` so resume can skip completed units. — fault-tolerance.mdx L288; [graph-api.mdx L334-342](https://github.com/langchain-ai/docs/blob/9d9747d0cf241e086c616a16d5ce230ad8f8f31d/src/oss/langgraph/graph-api.mdx) ("Side effects before the pause run again"; completed task results are restored from the checkpointer)
- Durability modes `"exit"`, `"async"`, `"sync"` passed per execution (`graph.stream(..., durability="sync")`). `exit` persists only when execution exits (cannot recover from mid-run crashes); `async` writes while the next step runs (small risk of lost checkpoints on crash). Python `sync` persists before the next step starts; **JS `sync` differs**: it "persists checkpoint writes throughout the run and awaits outstanding checkpointer promises when the run finishes ... a process crash mid-run can still lose recent checkpoints". — checkpointers.mdx L638-671
- `MemorySaver` does not persist between restarts. — [persistence.mdx L91](https://github.com/langchain-ai/docs/blob/9d9747d0cf241e086c616a16d5ce230ad8f8f31d/src/oss/langgraph/persistence.mdx)

### Inferences
- In LangGraph, "rewind" is really *re-run from a saved state*: the log of checkpoints is append-only, and going back means producing new external effects, not undoing old ones. A replay of a node that charged a card charges again unless the call carries an idempotency key.
- Durability mode governs how much *local* state survives a crash; none of the modes affects what already happened in external systems.

### Gaps
- Docs mirror is `main`-branch content with no tag matching JS 1.6.0 / Python 1.2.22, so the JS-specific `sync` semantics could postdate 1.6.0; not verified against `@langchain/langgraph` source in this pass.
- No LangGraph-native mechanism for compensating external effects was found; the docs point to idempotency, deduplication and querying the provider.

## Pi: the session tree, `/tree`, `/fork`, `/clone`

### Takeaway
Pi's rewind is purely a conversation-log operation: sessions are JSONL trees, and `/tree`, `/fork` and `/clone` move or copy the active leaf without erasing other branches. Pi core does not restore files; the only file restore in the docs is an *example extension* (`git-checkpoint.ts`) that snapshots with `git stash create` and offers to apply it on `/fork`.

### Cited Findings
- "Pi stores entries as a tree, so returning to an earlier point does not erase the branch you leave." `/tree` "Moves within the current session file"; `/fork` "Creates a new session from an earlier user message"; `/clone` "Copies the active branch into a new session". — [sessions.md L38-44](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/sessions.md) (local: `docs/reference/pi/source/coding-agent/sessions.md`)
- In `/tree`, selecting a user message puts its text back in the editor; submitting creates another branch. When leaving a branch, "Pi can summarize it and attach that summary to the branch you enter." The model receives "the active branch, not every branch in the session file." — sessions.md L46-54
- Each session records its working directory and "never changes it". — sessions.md L16
- Entries carry `id` and `parentId`; `sessionManager.branch(id)` moved the leaf back and both paths stayed in `getEntries()` while `getBranch()` returned the active one (verified by this repo's example 05). `AgentSessionRuntime` adds `newSession()`, `switchSession()`, `fork()`, `importFromJsonl()`. — `docs/reference/pi/guide.md` L122-124
- Extension hooks: `session_before_tree` (can cancel or customize the branch summary) then `session_tree` (`newLeafId`, `oldLeafId`, `summaryEntry`); `session_before_fork` fires for `/fork` and `/clone` and can return `{ cancel: true }` or `{ skipConversationRestore: true }` ("Reserved for future conversation restore control"). — [extensions.md L400, L515-600](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/extensions.md)
- Extensions holding in-memory state are told to reconstruct it from `ctx.sessionManager.getBranch()` on `session_start` and `session_tree` ("/tree changes the branch") — i.e. tool state is restored only if it was stored in tool-result `details` in the log. — extensions.md ~L2145-2160
- `git-checkpoint.ts` example: "Creates git stash checkpoints at each turn so /fork can restore code state." It runs `git stash create` on `turn_start`, maps the ref to the leaf entry id, and on `session_before_fork` asks "Restore code state?" then runs `git stash apply <ref>`; it does nothing in non-interactive mode and clears checkpoints on `agent_settled`. Listed in the examples table as "Git stash on turns". — [examples/extensions/git-checkpoint.ts](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/examples/extensions/git-checkpoint.ts); extensions.md L3317
- RPC `fork` "Create a new fork from a previous user message on the active branch ... Returns the text of the message being forked from"; `clone` duplicates the active branch. — rpc-commands.md L612, L640

### Inferences
- Navigating the tree changes what the model sees next, but leaves the working directory (and anything bash or a tool touched) exactly as it is. This is an inference from the docs describing only session-file operations and from the existence of a separate git-checkpoint extension; no Pi doc sentence says "files are not restored" in those words.
- The example extension only covers git-tracked working-tree changes at turn granularity, only on `/fork` (not `/tree`), and only interactively.

### Gaps
- Did not inspect Pi 1.5.2 source to confirm `/tree` performs no file operations; the claim rests on docs plus the extension's stated purpose.

## Claude Code `/rewind` and Claude Agent SDK `rewindFiles`

### Takeaway
Claude Code checkpoints snapshot files *before* its own file-editing tools (Write, Edit, NotebookEdit) change them, one checkpoint per user prompt that starts a turn; `/rewind` can restore code, conversation, or both. Bash-only changes, most subagent edits, directory operations, remote files and anything outside the machine are not tracked, and the docs send users to Git for the rest.

### Cited Findings
- "Claude Code automatically tracks Claude's file edits"; `/rewind` (alias `/undo`, or `Esc` twice) opens the menu. "Every prompt you send that starts a turn creates a new checkpoint." — [code.claude.com/docs/en/checkpointing](https://code.claude.com/docs/en/checkpointing.md) (fetched 2026-11-18)
- Retention: snapshots kept for "the 100 most recent checkpoints in a session"; checkpoints are saved with the conversation so `/rewind` works after resume; snapshots are deleted by the retention sweep "by default about 30 days after the session last saved one" (`cleanupPeriodDays`), after which rewind can fail with `No files were restored`. — checkpointing page
- Menu actions: **Restore code and conversation**, **Restore conversation** ("rewind to that message while keeping current code"), **Restore code** ("revert file changes while keeping the conversation"), **Summarize from here**, **Summarize up to here**, **Never mind**. Code options appear only when the checkpoint has tracked file changes. — checkpointing page
- Branching instead of rewinding: `/branch` or `claude --continue --fork-session`. — checkpointing page
- Limitations: "A file that only Bash commands changed isn't tracked and stays as it is. To revert it, use version control, such as Git." Once Claude has edited a file with its tools, later Bash changes *to that file* are undone. Subagent edits are usually not captured (except a foreground `context: fork` skill). Manual edits and other concurrent sessions are "normally not captured". Symlinked/hard-linked paths are skipped. "Checkpoints are designed for quick, session-level recovery ... continue using version control." — checkpointing page, "Limitations"
- Agent SDK: "File checkpointing tracks file modifications made through the Write, Edit, and NotebookEdit tools"; "Each prompt that starts a turn is a checkpoint, and its user message's UUID is the restore point." Rewind "deletes the files it created and restores the files it modified". — [agent-sdk/file-checkpointing](https://code.claude.com/docs/en/agent-sdk/file-checkpointing.md) L11-27 (local mirror `docs/reference/claude-agent-sdk/source/file-checkpointing.md`)
- "File rewinding restores files on disk to a previous state. It does not rewind the conversation itself." — file-checkpointing L23
- SDK limitations table: Bash command changes not undone (except files already edited by Write/Edit); subagent edits not tracked; "Same session: Checkpoints are tied to the session that created them"; "File content only: Creating, moving, or deleting directories is not undone"; "Local files: Remote or network files are not tracked". — file-checkpointing L618-624
- API surface (SDK 0.3.327): `Options.enableFileCheckpointing?: boolean` ("creates backups of files before they are modified") — `verify/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1823-1831`; `Query.rewindFiles(userMessageId, { dryRun? }): Promise<RewindFilesResult>` — sdk.d.ts:3466-3475; `RewindFilesResult { canRewind, error?, filesChanged?, insertions?, deletions?, skippedLinks? }` — sdk.d.ts:3734-3743; setting `fileCheckpointingEnabled` "Snapshot files before edits so /rewind can restore them" — sdk.d.ts:10097-10098.
- Conversation-side rewind in the SDK: `Options.resumeSessionAt` ("only resume messages up to and including the message with this UUID"), `resumeDropsTurn` (validates the discarded range), both "PRINT/HEADLESS LANE ONLY" — sdk.d.ts:2274-2327; `forkSession(sessionId, { upToMessageId })` copies the transcript with fresh UUIDs and "Forked sessions start without undo history (file-history snapshots are not copied)" — sdk.d.ts:890-905.

### Inferences
- Claude Code's checkpoint boundary is "files the agent's own edit tools touched on this machine". A `curl` POST, a `git push`, a migration run against a database, or an MCP tool call that sends an email are side effects of Bash/MCP tools and are outside that boundary. The checkpointing page does not mention external services explicitly; the SDK page's "Remote or network files are not tracked" is the closest vendor wording.
- Conversation rewind and file rewind are independent, so a user can roll back the transcript while external effects (and even local Bash effects) remain, leaving the model unaware of changes that still exist.

### Gaps
- The Claude Code CLI version that the 2026-11-18 docs describe is not stated on the page (docs mention behavior changes "v2.1.216 or later" for link skipping).

## Google ADK: `Runner.rewind_async` (Python), absent in TypeScript 2.5.0

### Takeaway
ADK Python (since v1.17.0) and Kotlin (since v0.3.0) let you rewind a session to *before* a given invocation: ADK appends a special rewind event that carries reversing deltas for session-scoped state and artifacts, and prompt-building skips the rewound events. App-level and user-level state/artifacts are not restored, external systems are explicitly the developer's job, and the operation is not atomic. `@google/adk` 2.5.0 for TypeScript has no rewind.

### Cited Findings
- Availability tag: "Python v1.17.0", "Kotlin v0.3.0" (no TypeScript, Go or Java tag). — [sessions/session/rewind.md L4](https://github.com/google/adk-docs/blob/ff7a5f56469a81f3e43a8fc54668d8dc84300192/docs/sessions/session/rewind.md) (local: `docs/reference/google-adk/source/adk-docs/docs/sessions/session/rewind.md`)
- Semantics: "you specify a user request, or invocation, that you want to undo, and the system undoes that request and the requests after it" (rewind to state at A by specifying B). Call: `await runner.rewind_async(user_id=..., session_id=..., rewind_before_invocation_id=...)`. — rewind.md
- "all ADK managed session-level resources are restored ... However, global resources, such as app-level or user-level state and artifacts, are not restored." — rewind.md
- How it works: a special rewind request restores session state and artifacts; "all requests, including rewound requests, are preserved in the log"; the model "effectively forgets" the rewound interactions. — rewind.md "How it works"
- Limitations (quote ≤25 words): "The rewind feature does not manage external dependencies. If a tool in your agent interacts with external systems, it is your responsibility to handle the restoration". Also "State updates, artifact updates, and event persistence are not performed in a single atomic transaction" — avoid rewinding active sessions. — rewind.md L86-96
- Source, `google-adk` v2.14.1: `Runner.rewind_async(*, user_id, session_id, rewind_before_invocation_id, run_config=None)`; raises `InvocationNotFoundError`; ignores `run_config.get_session_config` "because rewinds must replay state and artifact deltas from the start of the session history". — [runners.py L1389-1432 @ v2.14.1](https://github.com/google/adk-python/blob/v2.14.1/src/google/adk/runners.py)
- `sessions/_rewind_utils.py` @ v2.14.1: state delta replays `state_delta` of events before the rewind point, keeps only session-scoped keys (`_is_session_scoped_key` excludes the `app:`, `user:` and `temp:` prefixes), sets changed keys back and sets keys first written after the point to `None`. Artifact delta: skips `user:` artifacts ("User artifacts are not restored on rewind"); an artifact that did not exist at the rewind point gets a "rewind tombstone"; a changed one is restored by loading the old version from the artifact service and **saving it as a new version**. Then appends an Event with `author="user"` and `actions` carrying `rewind_before_invocation_id`, `state_delta`, `artifact_delta`. — [_rewind_utils.py @ v2.14.1](https://github.com/google/adk-python/blob/v2.14.1/src/google/adk/sessions/_rewind_utils.py) (L44-50, L103-173, L176-230)
- `events/_rewind_events.py` `_apply_rewinds` walks events backward and drops each rewind event plus everything back to the first event of the target invocation; it is "the single source of truth for 'which events are live'", shared by prompt building and compaction "otherwise rewound content can leak back into prompts through a compaction summary." — [_rewind_events.py @ v2.14.1](https://github.com/google/adk-python/blob/v2.14.1/src/google/adk/events/_rewind_events.py)
- BigQuery Agent Analytics logs a `rewind_before_invocation_id` column "(Python)". — `docs/reference/google-adk/source/adk-docs/docs/integrations/bigquery-agent-analytics.md` L2333
- TypeScript: zero matches for "rewind" in `verify/google-adk/node_modules/@google/adk/dist/types` and `dist/esm` (version.d.ts = "2.5.0"); `runner.d.ts` exposes no rewind method. adk-js `main` `core/src/runner/runner.ts` (fetched 2026-11-18) also has no "rewind". This repo already records session rewind as one of 14 Python features the TS port lacks. — `docs/comparison/typescript-gaps.md` L27; [adk-js runner.ts @ main](https://github.com/google/adk-js/blob/main/core/src/runner/runner.ts)

### Inferences
- ADK's rewind is event-sourced compensation *inside the session store*: it never deletes history, it appends inverse deltas. That is the same pattern a saga uses externally, but ADK applies it only to resources it owns.
- Because `app:`/`user:` state and `user:` artifacts survive, a rewind can leave cross-session state reflecting work the session "forgot".

### Gaps
- Kotlin implementation not inspected. The docs link to a `rewind_session` sample on `main`; not fetched.

## Others: OpenAI Agents SDK, Vercel AI SDK, Cloudflare Think, Copilot SDK

### Takeaway
Elsewhere, "going back" is mostly history editing: OpenAI's `popItem()`, Vercel's `regenerate`/`sendMessage({ messageId })`, Cloudflare Think's `regenerate()` as a new branch. GitHub's Copilot SDK 1.0.31 is the one other SDK with a Claude-Code-style experimental conversation-and-files rewind; it too stops at captured local files.

### Cited Findings
- OpenAI Agents JS 0.21.0: `Session.popItem()` "Remove and return the most recent item from the conversation history"; `clearSession()` resets it. — `verify/openai-agents-sdk/node_modules/@openai/agents-core/dist/memory/session.d.ts:72-79`. Docs: "Call `popItem()` to remove the last entry—useful for user corrections before you rerun the agent." — [guides/sessions.mdx L101 @ v0.21.0](https://github.com/openai/openai-agents-js/blob/v0.21.0/docs/src/content/docs/guides/sessions.mdx); example `examples/docs/sessions/manageHistory.ts:22` (`const undone = await session.popItem();`)
- OpenAI `RunState` resumes a *paused* run (approvals), not a past one — this repo's feature table: "`RunState` resumes a paused run (V); `previousResponseId` (D)". — `docs/comparison/feature-table.md` L52
- Vercel AI SDK 7.0.162 `AbstractChat`: `sendMessage({ ..., messageId })` — "If a messageId is provided, the message will be replaced"; `regenerate({ messageId? })` — "Regenerate the assistant message with the provided message id"; settable `messages`. Request trigger is `'submit-message' | 'regenerate-message'`. — `verify/vercel-ai-sdk/node_modules/ai/dist/index.d.ts:6446-6475, 6225`
- Cloudflare Think 0.23.0: `regenerate(messageId?)` — "Answer a user message again, as a new branch. `Session.getBranches()` still reads the earlier answers." — [harnesses/think.md L94 @ agents@0.33.0](https://github.com/cloudflare/agents/blob/agents%400.33.0/docs/agents/harnesses/think.md); Session API has `getBranches(messageId)`, `deleteMessages(ids)`, `clearMessages()` — `verify/cloudflare-agents/node_modules/@cloudflare/think/dist/index-DDnny6kt.d.ts:306-337`
- Copilot SDK 1.0.31: `SessionConfig.enableFileChangeTracking` — "Opt in to capturing file changes for session rewind and cumulative session diff ... it cannot reconstruct changes from earlier untracked turns." — `verify/copilot-sdk/node_modules/@github/copilot-sdk/dist/types.d.ts:2522-2528`
- Copilot RPC `session.rpc.history`: `truncate` ("this event and all later events are removed"), `listRewindPoints`, `previewRewind`, `rewind({ eventId, mode })` with `HistoryRewindMode` `"conversation"` ("leaving files unchanged") or `"conversation-and-files"` ("restore captured files changed by those turns"). `rewind` is "Not crash-atomic: file restore and conversation truncation are separate stores, applied in that order"; re-running is the recovery path. All marked `@experimental`. — `.../copilot-sdk/dist/generated/rpc.d.ts:45600-45638, 3212-3222, 17384-17392`
- Copilot outcomes include `files-rolled-back`, `rollback-incomplete`, `truncation-failed` ("conversation history cannot be un-truncated"); `unsupported-remote-session`; per-file skip reasons include "The file changed after Copilot's last captured write" and `skipped-capture` ("A faithful preimage was not captured"). — rpc.d.ts:3172-3182, 3230-3248

### Inferences
- History-editing APIs (popItem, regenerate, branch) change only what the next model call sees; nothing in them reaches tool targets.
- Copilot's typed outcome union is the most explicit vendor admission that even *local* file rewind can partially fail.

### Gaps
- Did not check which Copilot tools feed the file-change capture (shell vs edit tools); the `.d.ts` only says "captured files". OpenAI Python `pop_item` not separately checked.

## The common boundary: why rewind cannot reverse external writes

### Takeaway
Every mechanism above restores state the framework itself stored (a checkpoint, a session log, session-scoped state/artifacts, or pre-edit copies of local files its own tools wrote). A payment, email or database write lives in another system's state, which the framework never snapshotted and cannot write back; vendors say so and point to idempotency, version control, or developer-owned restoration.

### Cited Findings
- LangGraph: "Side effects during the node (payments, emails, external writes) are outside that boundary. Application code must make those effects idempotent." — fault-tolerance.mdx L286
- LangGraph: replay means "API requests ... fire again" — use-time-travel.mdx L22; "`update_state` does **not** roll back a thread." — L131
- Google ADK: "The rewind feature does not manage external dependencies ... it is your responsibility to handle the restoration of those systems to their prior state." — rewind.md L89-92
- Claude Code: "Remote or network files are not tracked" (SDK) and "A file that only Bash commands changed isn't tracked ... use version control" — file-checkpointing L624; checkpointing page
- Copilot: conversation truncation "cannot be un-truncated" and rewind is "Not crash-atomic" — rpc.d.ts:3243, 45631
- LangGraph on lost acks: "Treat missing local state as unknown, not as proof the effect did not happen. Query the provider for the operation's status before compensating" — fault-tolerance.mdx L375

### Inferences
- Three structural reasons (synthesis, not a vendor claim): (1) the framework only snapshots state it owns; external state was never captured, so there is nothing to restore from; (2) many external effects are irreversible by nature (a sent email, a disbursed payment) and can only be *compensated* by a new forward action the remote system supports (refund, follow-up email, inverse SQL), which is application logic; (3) rewind/replay tends to *add* effects, because re-executed nodes or regenerated turns call the tools again.
- A rewind that hides past tool calls from the model makes it more likely to repeat them, because the model no longer "remembers" the effect (inferred from ADK's "the AI model ... effectively forgets" and LangGraph's replay semantics).
- Design implication for this repo's harness: keep the session log append-only (as ADK and Pi do), record external effects as first-class events with idempotency keys and compensation handles, and treat rewind as "change what the model sees" plus optional local-file restore, never as data rollback.

### Gaps
- No framework surveyed offers built-in compensation/saga support tied to rewind; I found no vendor documentation describing one (as of November 2026).
