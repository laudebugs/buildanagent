# Sessions and storage in mature agent harnesses

Research notes, 18 November 2026. Question: how do mature harnesses store sessions, and which formats support resume, branching, replay and multi-process access?

**Short answer.** Every mature harness keeps an append-only log of model-visible items as its source of truth, and the leaders have converged on a **tree** inside that log (each entry carries `id` +
`parentId`), with compaction and branch summaries stored as ordinary entries that the context builder interprets. Pi, OpenHands, Cloudflare Agents and the Claude Agent SDK all work this way. LangGraph
is the outlier: it stores **state snapshots** (checkpoints) plus per-task pending writes, which gives exact super-step resume and time travel but no message-level log. OpenAI's Agents SDK splits state
in two: a flat, mutable `Session` item list for history, and a versioned `RunState` blob for paused runs. Multi-process safety is where the formats differ most: Codex and OpenHands lock, Cloudflare
relies on the Durable Object's single writer, and Pi does not lock at all.

Versions read (as of November 2026): Pi `@earendil-works/pi-coding-agent` 1.5.2; Claude Agent SDK 0.3.327; OpenAI Agents SDK 0.21.0; `@langchain/langgraph` 1.6.0 with `@langchain/langgraph-checkpoint`
1.2.3; Codex `main` at `4389a52` (18 Nov 2026); OpenHands software-agent-sdk 1.62.0 at `7dd877e`; Cloudflare `agents` 0.33.0 / `@cloudflare/think` 0.23.0 at `1a450e7`. Paths abbreviated below:
`PI=verify/pi/node_modules/@earendil-works/pi-coding-agent/dist/core`, `CL=verify/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`,
`OA=verify/openai-agents-sdk/node_modules/@openai`, `LGC=node_modules/.pnpm/@langchain+langgraph@1.6.0_…/node_modules/@langchain/langgraph-checkpoint/dist`,
`LGD=docs/reference/langchain/source/src/oss/langgraph`, `CX`, `OH`, `CF` = the clones under the session scratchpad `clones/{codex,openhands-sdk,cf-agents}`.

## 1. Pi: one JSONL file per session, entries form a tree, the last line is HEAD

**Data model.** Line 1 is a `session` header (`version`, `id`, `cwd`, optional `parentSession` path); it is not part of the tree (`docs/reference/pi/source/coding-agent/session-format.md:64-76`).
Every other line extends `{type, id, parentId, timestamp}` with an 8-hex id that is collision-checked and falls back to a full UUID (`session-format.md:53-60`; `PI/session-manager.js:21-29`). Entry
types: `message` (an `AgentMessage`: user, assistant with provider/model/usage/stopReason, toolResult, system), `model_change`, `thinking_level_change`, `usage`, `compaction` (summary,
`firstKeptEntryId`, `tokensBefore`, a full system-prompt/tool checkpoint), `context_edit` (append-only replacement or omission of an earlier entry's content), `branch_summary` (`fromId` = abandoned
leaf), `custom` (extension state, not in context), `custom_message` (extension text, in context), `label`, `session_info` (`session-format.md:78-207`). The system prompt and tool loadout are
themselves logged as system messages that patch named sections, so "replaying them in order yields the current prompt and tools" (`session-format.md:80`).

**Append-only, with two rewrite paths.** Normal writes are one `appendFileSync` per entry (`PI/session-manager.js:795-815`). The file is not created until a user or assistant message exists, so
setup-only sessions leave nothing on disk (`:786-794`, `:799-811`, created with `wx`). If a write throws, the in-memory entry is popped so no later entry can point at a missing parent (`:816-831`).
The two full rewrites are version migration on load (`:718-731` calls `_rewriteFile`, `:755-767`) and initializing an empty file (`:676-683`). There is no fsync.

**Crash tolerance.** The loader skips blank and malformed lines and, if the file ends mid-line, appends a newline so the next append starts cleanly (`PI/session-manager.js:314-324`, `:361-369`). A
file whose first parsed line is not a `session` header loads as empty and is refused rather than overwritten (`:361-365`, `:670-676`).

**Resume.** `SessionManager.open(path)`, `continueRecent(cwd)` (most recent file for the cwd), `create`, `inMemory` and `findById`/`list` are the entry points (`PI/session-manager.js:1328-1390`; CLI
`--continue`, `--resume`, `--session`, `sessions.md:9-21`). On load `_buildIndex` sets the leaf to **the last entry in file order** (`:733-753`, leaf assigned at `:742`). `branch(id)` only moves the
in-memory leaf (`:1173-1178`), so a `/tree` jump with no subsequent append is not persisted; the next append becomes the last line and therefore the leaf on reload. HEAD is implicit, not stored.

**Branching.** Three granularities (`sessions.md:36-48`): `/tree` branches in place (new child of an earlier entry, optionally preceded by an LLM `branch_summary` of the abandoned path,
`PI/session-manager.js:1192-1215`); `/fork` creates a new file from an earlier user message; `/clone` copies the active branch. `createBranchedSession(leafId)` writes only the root-to-leaf path, drops
label entries and re-chains parents around them (`:1217-1260`); `forkFrom(source, targetCwd)` copies the full history into a new file whose header points back via `parentSession` (`:1386-1430`). The
runtime wraps these with `session_before_fork` extension events (`PI/agent-session-runtime.js:90-101`, `:174-250`).

**Context projection.** `buildContextEntries()` walks leaf to root, keeps the latest compaction on the path plus entries from `firstKeptEntryId`; `buildSessionProjection()` applies the latest
`context_edit` per target; `buildSessionContext()` maps entries to model messages (`session-format.md:224-248`). Compaction, context edits and branch moves therefore never delete data
(`sessions.md:56`).

**Concurrency.** None. `session-manager.js` imports no lock; Pi uses `proper-lockfile`-style locking only in `auth-storage.js`, `settings-manager.js` and `trust-manager.js` (grep of `PI/*.js`). Two Pi
processes appending to one file would interleave lines and both treat their own last entry as the leaf.

**Pluggability.** The only storage choices are the directory (`--session-dir`, `PI_CODING_AGENT_SESSION_DIR`, `sessionDir`) and `--no-session` (`sessions.md:64-68`). Cloudflare's repo ships a Pi
session store on Durable Object SQLite that imports `@earendil-works/pi-durable/storage/sqlite` (`CF/packages/agents/src/harness/pi/session-store.ts:1-15`), so a SQL backend for Pi exists upstream;
`pi-durable` is not in our pinned 1.5.2 install (checked `node_modules/.pnpm`), so its schema is unverified here.

**Migration.** `CURRENT_SESSION_VERSION = 3`; v1→v2 assigns ids and a linear parent chain and converts `firstKeptEntryIndex` to `firstKeptEntryId`; v2→v3 renames the `hookMessage` role
(`PI/session-manager.js:11`, `:31-85`). Migrations run on load and rewrite the file.

**Approvals.** Pi has no permission system (`docs/research/fact-check-2026-11-18.md:95`), so nothing about approvals is persisted; an extension can store gate state as `custom` entries
(`session-format.md:164-172`).

## 2. Claude Agent SDK: CLI-owned JSONL with a `parentUuid` chain, mirrored to a pluggable store

**Data model.** The CLI writes `~/.claude/projects/<sanitized cwd>/<sessionId>.jsonl` plus a `<sessionId>/` directory of subagent transcripts (`CL:1949-1955`, `:718-722`). The entry union is
"CLI-internal and not part of the SDK API surface"; the SDK exposes only `{type, uuid?, timestamp?, …opaque}` (`CL:7350-7365`). Entries form a chain via `parentUuid`, which `forkSession` "preserv[es]"
while remapping every UUID (`CL:892-905`). Titles, tags and mode markers are entries without a `uuid` (`CL:7276-7281`). `getSessionMessages()` returns `{type, uuid, session_id, message,
parent_tool_use_id, parent_agent_id}` (`CL:7182-7198`).

**Resume and branching.** `resume: sessionId` loads the whole chain; `continue` takes the most recent session; `forkSession: true` resumes into a new id; `resumeSessionAt: uuid` truncates the resumed
chain after any chain entry (`CL:1729-1731`, `:1843-1847`, `:2261-2278`). `resumeDropsTurn` makes that truncation validated: the CLI refuses with `Resume rejected by --resume-drops-turn:` if the
discarded range contains anything other than the named turn, and only the headless/SDK boot path honours the pair (`CL:2279-2328`). The standalone `forkSession(id, {upToMessageId})` copies a prefix
into a new file, with documented edge rules around compaction boundaries; forks start "without undo history (file-history snapshots are not copied)" (`CL:892-926`). File state is a separate mechanism:
`enableFileCheckpointing` backs up files before edits and `Query.rewindFiles(userMessageId)` restores them (`CL:1823-1831`, `:3473`). `SessionStart` hooks receive `source: 'resume' | 'fork'` plus
prompt-cache-expiry estimates (`CL:7219-7238`).

**Pluggable store is a mirror, not the primary.** `sessionStore` dual-writes: the subprocess still writes local JSONL, and the adapter is called "AFTER the subprocess's local write succeeds" in ~100
ms batches (`CL:1956-1967`, `:7266-7273`). It cannot be combined with `persistSession: false` (`CL:1961-1963`). `SessionKey = {projectKey, sessionId, subpath?}` with `subagents/agent-{id}` subpaths
(`CL:7160-7180`). Contract: `append` (treat `uuid` as an idempotency key), `load` (called once in the parent before spawn and materialized to a temp JSONL; entries must be deep-equal, not byte-equal),
optional `listSessions`, `listSessionSummaries` (maintained with the pure `foldSessionSummary`), `delete` (absent = no-op, "appropriate for WORM/append-only backends like S3"), `listSubkeys`
(`CL:7266-7348`, `:874-889`). `InMemorySessionStore` and `importSessionToStore` ship for tests and backfill (`CL:1074-1087`, `:1119-1143`). `sessionStoreFlush: 'batched' | 'eager'`, `loadTimeoutMs`
default 60 s (`CL:1968-1985`, `:7378`).

**Failure surfacing.** A failed mirror batch is retried 3 times (timeouts not retried, since the call may still land), then dropped with a `system/mirror_error` message (`CL:5940-5954`, `:7284-7288`).
Disk-full loss is reported once as `system/session_writes_lost` with `ENOSPC | EDQUOT` and the affected session ids (`CL:6510-6530`).

**Concurrency.** "Within a single process, persist entries in append-call order; across concurrent processes, order is by storage commit time" (`CL:7274-7275`). Stores that keep summaries must
serialize the read-fold-write themselves (`CL:7321-7326`). Nothing in the SDK prevents two `resume`s of one id.

**Retention.** Local transcripts are swept after `cleanupPeriodDays` (default 30) (`CL:7466-7470`); store retention is "the adapter's responsibility" (`CL:7255-7263`). `archiveSession`/`deleteSession`
exist; delete only touches local disk or the store (`CL:141-145`, `:710-727`).

**Approvals and pauses.** `canUseTool` is an in-process callback, so a pending approval dies with the process. The durable pause is the hook decision `'defer'` (`CL:1071`): the result message then
carries `deferred_tool_use: {id, name, input}` (`CL:6429`, `:5659-5663`). We infer, but did not verify by running, that the caller decides out of band and resumes the session. `session_state_changed`
reports `requires_action` (`CL:6501-6508`).

## 3. OpenAI Agents SDK: flat mutable item list for history, versioned snapshot for paused runs

**Session = list of `AgentInputItem`, not a log.** The interface is `getSessionId`, `getItems(limit?)`, `addItems`, `popItem`, `clearSession`, plus optional `replaceHistoryWithCompaction`
(`OA/agents-core/dist/memory/session.d.ts:22-80`). There are no ids or parents; `popItem` and `clearSession` make it mutable. Optional capabilities: `applyHistoryMutations` (replace a function call by
`callId`) and `applyHistoryTransaction` with a retry-stable `operationId` and `append_items | replace_suffix{expectedSuffix}` (`session.d.ts:8-18`, `:95-128`). The transaction contract (atomic,
idempotent, suffix compare-and-swap) is the SDK's answer to concurrent or retried writers. `MemorySession` is an array, "intended for demos or tests" (`memory/memorySession.d.ts:9-25`).
`OpenAIConversationsSession` stores items server-side in an OpenAI Conversation (`OA/agents-openai/dist/memory/openaiConversationsSession.d.ts:1-27`). `OpenAIResponsesCompactionSession` wraps another
session and replaces history after `responses.compact` (`session.d.ts:132-193`; `openaiResponsesCompactionSession.d.ts:100`). Python's SQLite/Redis/SQLAlchemy sessions are noted in
`docs/research/harness-architectures.md:13`; no DB session ships in these JS packages (grep for `implements Session` finds only Memory and Conversations).

**RunState = the pause/resume format.** `RunState.toString()` / `fromString(agent, str)` serialize the in-flight run: current turn and agent, original and pending input, model responses, generated
items, conversation/previous-response ids, tool-use tracker, pending nested agent-tool runs, completed-invocation evidence and the trace (`OA/agents-core/dist/runState.d.ts:20579-20800`,
`:20912-20952`). Approvals live here: `getInterruptions()`, `approve(item, {alwaysApprove})`, `reject(item, {alwaysReject, message})`, then run again with the same state (`:20864-20910`). Tracing API
keys are omitted unless `includeTracingApiKey: true` (`:20916-20936`).

**Versioning is explicit and strict.** `CURRENT_SCHEMA_VERSION = "1.23"` with 24 supported versions and a changelog in the type file (`runState.d.ts:20-80`). Loading a newer version throws `Run state
schema version … is not supported`, and older versions throw for features they cannot express ("Please reserialize…") (`runState.mjs:2498-2501`, `:2549-2617`). Since 1.18, approvals bind to "canonical
invocation fingerprints", and since 1.21 pending calls without recipient provenance "cannot execute" (`runState.d.ts:56-75`, `:20940-20947`). Since 1.20 RunState also checkpoints "unacknowledged
ordinary Session appends completed during approval resume" (`:63-67`), because history and run state live in two stores that can diverge.

**Branching and replay.** No fork or time-travel API exists; branching means copying items into a new session. Resume does not re-call the model for completed steps, because model responses are in the
snapshot.

## 4. LangGraph: snapshots per super-step plus per-task pending writes, keyed by `thread_id`

**Data model.** `Checkpoint {v: 4, id (uuid6), ts, channel_values, channel_versions, versions_seen}` (`LGC/base.d.ts:9-34`). A `CheckpointTuple` adds `metadata {source: "input"|"loop"|"update"|"fork",
step, parents}`, `parentConfig` and `pendingWrites [taskId, channel, value]` (`base.d.ts:45-51`; `types.d.ts:4-31`). Every checkpoint is addressed by `(thread_id, checkpoint_ns, checkpoint_id)` with a
parent pointer, so history is a tree of snapshots. The recommended SQL schema is two tables, `checkpoints` and `writes` (`LGD/checkpointers.mdx:1025-1057`). Special writes use negative indices: `ERROR
-1, SCHEDULED -2, INTERRUPT -3, RESUME -4` (`LGC/base.js:207-211`). Messages are just one channel value.

**Append-only by contract.** `put` adds a checkpoint; `updateState` "creates a new checkpoint… it does not modify the original" (`LGD/checkpointers.mdx:622-630`). The saver interface is `getTuple`,
`list`, `put`, `putWrites(…, taskId, taskPath)`, `deleteThread` (`LGC/base.d.ts:84-113`). `put` takes no expected-parent precondition, so the interface has no compare-and-swap.

**Resume.** The input decides behaviour, not the thread id: "Reusing a thread ID alone does not mean that execution resumes" (`LGD/checkpointers.mdx:57-87`). `Command({resume})` answers an
`interrupt()`, and "the interrupted node starts again from its beginning" (`:70`, `:81`). Pending writes mean nodes that succeeded in a failed super-step are not re-run (`:29`, `:97-99`). Resume
points are super-step boundaries only (`:95`).

**Time travel is replay, not playback.** Invoking with an old `checkpoint_id` re-executes later nodes, and "LLM calls, API requests, and interrupts fire again and may return different results"
(`LGD/use-time-travel.mdx:14-22`). Fork = `updateState(oldConfig, values, asNode?)` and then `invoke(null, forkConfig)` (`use-time-travel.mdx:123-210`). Interrupts are always re-triggered on time
travel (`:214-262`).

**Durability modes are a real trade-off.** `exit`, `async` and `sync`; in JS, `sync` still lets steps proceed before writes land, "so a process crash mid-run can still lose recent checkpoints"
(`LGD/checkpointers.mdx:638-670`). A crash before the first durable checkpoint is indistinguishable from never-invoked, so the docs advise recording admission in your own outbox (`:690-696`).

**Backends and size.** `MemorySaver` is nested records of serialized bytes (`LGC/memory.d.ts:7-9`); SQLite, Postgres, MongoDB and Redis savers are separate packages (`LGD/checkpointers.mdx:724-733`).
Full channel values are written every super-step, so threads grow O(N²) for message lists; the beta `DeltaChannel` stores a sentinel and reconstructs by replaying ancestor writes (`:700-710`,
`:1090`), which complicates pruning and `copy_thread` (`:1212-1224`). The docs leave retention to a user cron job (`LGD/persistence.mdx:100-113`). Optional saver capabilities (`adelete_for_runs`,
`acopy_thread`, `aprune`) are detected by Agent Server at startup (`LGD/checkpointers.mdx:1071-1082`). An `EncryptedSerializer` covers at-rest encryption (`:787-810`).

## 5. Codex: JSONL rollouts as truth, a SQLite projection for paging, a cross-process writer lock

**Data model.** Each line is a `RolloutLine {timestamp, ordinal?, …RolloutItem}` (`CX/codex-rs/history/src/lib.rs:606-612`). `RolloutItem` is `SessionMeta | DynamicToolsUpdated | ResponseItem |
InterAgentCommunication | Compacted | TurnContext | TokenUsageRecord | WorldState | SecurityRiskScore | RetainedContext | EventMsg | RealtimeItem` (`lib.rs:405-428`). `SessionMeta` carries the thread
id, `forked_from_id`, `forked_from_ordinal_exclusive`, `parent_thread_id`, cwd, CLI version, base instructions, dynamic tools, `history_mode: Legacy | Paginated` and `history_base:
HistoryPosition{rollout id, end_ordinal_exclusive, end_byte_offset}` (`CX/codex-rs/protocol/src/protocol.rs:3500-3600`, `:983-987`). Files are `rollout-<timestamp>-<uuid>.jsonl`
(`CX/codex-rs/rollout/src/compression.rs:1396`; `rollout_file_name.rs:10-14`).

**What is persisted is a policy.** `persisted_rollout_item` decides per item (`CX/codex-rs/rollout/src/policy.rs:21-30`). Command and MCP outputs are truncated to 64 KiB for persistence
(`policy.rs:16-19`). Approval requests (`ExecApprovalRequest`, `ApplyPatchApprovalRequest`, `RequestPermissions`, `ElicitationRequest`) are listed as "Transient, non-durable events"
(`policy.rs:161-205`), so a pending approval does not survive a restart; the durable record is the resulting tool call and output.

**Immutable files, one mutable pointer.** Revert does not truncate: it "creat[es] a new immutable rollout file. Old rollouts stay intact. The new file references the retained prefix, and the only
mutable cutover is the existing SQLite rollout-path pointer" (`CX/codex-rs/thread-store/src/local/revert_thread.rs:1-4`). Forks reference a parent prefix by ordinal (`protocol.rs:3534-3545`) and the
store can `prepare_fork` from frozen history (`CX/codex-rs/thread-store/src/store.rs:333-357`). The app-server exposes `thread/resume`, `thread/fork` (with `lastTurnId` / `beforeTurnId`) and
`thread/revert` (`CX/codex-rs/app-server-protocol/src/protocol/common.rs:581-592`, `:809-813`; `v2/thread.rs:558-587`). Resume returns `InitialHistory::Resumed{history, revision}`, and fork returns
`Forked(items)` (`history/src/lib.rs:614-630`).

**SQLite is an index, not the log.** `state/migrations` (64 files, from `0001_threads.sql`) holds thread metadata (rollout path, cwd, sandbox policy, approval mode, git info, archived)
(`CX/codex-rs/state/migrations/0001_threads.sql:1-25`). `thread_history_migrations` projects turns and items with `rollout_ordinal` for pagination (`0001_thread_history.sql:1-30`). Legacy-to-paginated
migration stages a canonical JSONL, projects it into SQLite, verifies, then publishes atomically, with a `.pending` journal for recovery (`thread-store/src/local/rollout_migration.rs:1-10`).

**Concurrency.** `WriterLockCoordinator` gives "shared cross-process ownership for local thread writers"; `acquire` returns `WouldBlock` when another writer is active
(`CX/codex-rs/rollout/src/writer_lock.rs:1-3`, `:20-46`). `resume_thread` must include writes committed before lock acquisition (`thread-store/src/store.rs:209-216`), and revert requires the live
writer to be closed (`:344-349`).

**Size and retention.** Rollouts can be zstd-compressed in the background (`.zst`, `compression.rs:26-30`). The `ThreadStore` trait abstracts local and in-memory stores and supports archive and delete
(`thread-store/src/store.rs:158-760`; `CX/codex-rs/core/src/thread_store_builder.rs:1-80`).

## 6. OpenHands SDK: one JSON file per event, a parent-id tree, a mutable `base_state.json`

**Data model.** The conversation directory holds `base_state.json` and `events/event-{idx:05d}-{event_id}.json` (`OH/openhands-sdk/openhands/sdk/conversation/persistence_const.py:4-10`). Every event
has `id`, `timestamp`, `source` and `parent_id`; "events sharing a parent_id are sibling branches" (`OH/…/sdk/event/base.py:25-41`), and `__root__` marks extra roots (`event/types.py:20-24`).
`ConversationState` is the mutable part. It holds the agent config, the workspace, `execution_status` (`idle | running | paused | waiting_for_confirmation | finished | error | stuck | deleting`) and a
persisted `leaf_event_id` HEAD (`conversation/state.py:50-62`, `:136-150`, `:249-262`). It autosaves on field assignment (`:767-780`), and secrets are encrypted with a cipher or else redacted
(`:590-611`).

**Append and concurrency.** `EventLog.append` takes a file lock (30 s timeout), resyncs from disk if another writer advanced, rejects duplicate ids and unknown parents, and never reuses an on-disk
index (`OH/…/conversation/event_store.py:30-31`, `:315-378`). The docstring warns that `flock()` "does NOT work reliably on NFS" (`:45-56`). Lost or unreadable event files become stand-in events and
are bridged in the parent walk (`:136-156`, `:270-300`).

**Approvals.** A confirmation pause is `execution_status = waiting_for_confirmation` plus `ActionEvent`s with no matching observation, which `get_unmatched_actions` recovers on resume
(`state.py:880-886`). This is the pattern of the main report's "HITL pauses are just persisted waiting events" (`docs/research/agent-sdks-and-harness-design.md:94`).

## 7. Cloudflare Agents / Think: the session tree in Durable Object SQLite

**Data model.** `cf_agents_session_messages(session_id, id, seq, parent_id, type, role, content, content_chunks, token_estimate, created_at, content_hash)`, chunk overflow rows,
`cf_agents_session_compactions(summary, from_message_id, to_message_id)`, per-session config, content-addressed attachments, and optional FTS (`CF/packages/agents/src/sessions/core.ts:144-199`;
`attachment-store.ts:60-89`). Compactions are overlays over a path range, not deletions (`sessions/overlays.ts:1-7`; `core.ts:1331-1361`).

**Writes.** Append defaults the parent to the session's tail leaf and commits message, chunk, attachment and FTS rows in one synchronous SQLite transaction (`core.ts:1056-1100`). The only in-memory
state is each session's tail (leaf id, next seq) (`core.ts:1-11`). Rows are mutable: `update`, `deleteMessages` and `clearMessages` exist (`core.ts:1149`, `:1237`, `:1302`). The design is cost-driven:
"rows written cost ~1000× rows read on DO SQLite", so tables are `WITHOUT ROWID` with no secondary index (`core.ts:6-9`). Paths are capped at `MAX_PATH_DEPTH` (`core.ts:56-59`), and the object has a
10 GB budget (`core.ts:270-276`).

**Concurrency** comes from the actor model: one Durable Object instance owns the database, which is why a cached tail is safe (Cloudflare Durable Objects docs,
https://developers.cloudflare.com/durable-objects/; not fetched in this session). **Approvals** persist as UI-message parts in state `approval-requested`, which "a reconnecting client can replay"
after a restart (`CF/packages/think/src/think.ts:16954-16960`; `agents/src/chat/message-builder.ts:115`). **Migration**: `migrateLegacy()` lifts old tables, verifies row by row, drops the source, and
leaves the schema version unstamped on failure so a later start retries (`core.ts:270-283`).

## 8. Comparison

| Harness | Unit of storage | Ids / parent | Append-only | Branch in place | Fork to new session | Resume point | Multi-process | Pluggable backend | Format version |
|---|---|---|---|---|---|---|---|---|---|
| Pi | JSONL line | 8-hex id + `parentId` | yes (rewrite on migrate) | yes (`/tree`) | yes (path copy or full copy) | any entry; leaf = last line | no lock | dir only (DO store upstream) | header `version` 3 |
| Claude SDK | JSONL line | `uuid` + `parentUuid` | yes | no (truncating resume) | `forkSession`, `upToMessageId` | any chain uuid (`resumeSessionAt`) | none; store orders by commit | mirror adapter (`SessionStore`) | CLI-internal |
| OpenAI | item list + RunState blob | none / call ids | no (`popItem`, clear) | no | manual copy | paused run (RunState) | optional txn with CAS suffix | `Session` interface | RunState `1.23` |
| LangGraph | checkpoint + writes | `checkpoint_id` + parent | yes | `updateState` fork | `copy_thread` (server) | super-step boundary | none in interface | `BaseCheckpointSaver` | checkpoint `v: 4` |
| Codex | rollout JSONL + SQLite index | ordinals; fork by prefix ref | yes (immutable files) | no | `thread/fork` by turn | turn; revert by new file | cross-process writer lock | `ThreadStore` trait | `history_mode`, 64+ SQL migrations |
| OpenHands | file per event + state JSON | `id` + `parent_id`, persisted leaf | events yes, state mutable | yes (`navigate_to`) | not checked | event; unmatched actions | flock (not NFS) | `FileStore` | legacy-parent fallback |
| Cloudflare | SQLite rows | `id` + `parent_id`, `seq` | no (update/delete) | yes (explicit parent) | not checked | latest leaf | DO single writer | DO SQLite only | `migrateLegacy` |

## Design implications for our harness

1. **Make the log a tree of typed entries with stable ids and parent ids, and treat everything else as a projection.** Pi, OpenHands, Cloudflare and Claude converged on this independently (§1, §2, §6,
   §7), and the fact-check log already recommends it (`docs/research/fact-check-2026-11-18.md:101`). Store compaction summaries, branch summaries, context edits, model/tool-loadout changes and usage
   as entries, as Pi does (§1), so compaction and branching never delete data.
2. **Persist HEAD explicitly.** Pi's "last line is the leaf" loses a `/tree` jump that has no append (§1). OpenHands persists `leaf_event_id` (§6). Append a small `head` (or `checkout`) entry, or keep
   HEAD in a sidecar, so that resume is exact.
3. **Write a session header with a format version, and migrate by rewriting into a new file, never in place.** Pi rewrites the original on load (§1). Codex stages, verifies and publishes atomically
   (§5). OpenAI refuses newer versions outright (§3). Reject unknown future versions, and keep the original file until the migrated one is verified.
4. **Keep files immutable and move a pointer for revert and fork.** Codex's "new immutable rollout referencing the retained prefix, one mutable pointer" (§5) gives cheap forks and safe reverts without
   copying history. In a tree log, an in-place branch needs no copy at all; reserve file-level forks for "separate work" (Pi's `/fork`).
5. **Take a per-session writer lock from day one.** Pi has none (§1), Claude leaves ordering to the store (§2), while Codex (`WouldBlock`) and OpenHands (flock with a resync-on-append check) both
   guard writers (§5, §6). Use an exclusive lock file per session and fail fast on a second writer. Readers stay lock-free because JSONL appends are line-atomic in practice; tolerate a torn last line
   as Pi does (§1). Document that flock is unsafe on NFS (§6).
6. **Put the store behind a small interface modelled on Claude's `SessionStore`:** `append(key, entries)` idempotent by entry id, `load(key)`, optional `list`, `delete` and `listSubkeys` (§2). Add
   OpenAI's `operationId` plus expected-suffix compare-and-swap for remote backends (§3). Ship JSONL-on-disk and in-memory first; SQLite (Codex's index, Cloudflare's rows) can come later as a
   projection for listing, search and paging, not as the source of truth (§5, §7).
7. **Persist pauses as entries, not as callbacks.** In Codex and in Claude's `canUseTool`, a pending approval lives only in memory (§2, §5). OpenHands (`waiting_for_confirmation` plus unmatched
   action), Cloudflare (`approval-requested` part) and Claude's `defer` survive a restart (§2, §6, §7). Write an `approval_requested{callId, tool, input fingerprint}` entry and a later
   `approval_resolved{callId, decision, by}` entry. Bind decisions to an invocation fingerprint, as OpenAI RunState 1.18+ does (§3), so a resumed run cannot execute a call nobody approved.
8. **Keep one source of truth for history and run state.** OpenAI had to add RunState 1.20 bookkeeping because session appends and the paused-run snapshot live in two stores (§3). If the loop is
   stateless and rebuilds from the log, as the Managed Agents design describes (`docs/research/agent-sdks-and-harness-design.md:88`, citing https://www.anthropic.com/engineering/managed-agents), no
   separate run-state blob is needed.
9. **Define replay honestly.** LangGraph's time travel re-executes LLM and tool calls (§4). A recorded log lets us offer two modes: *playback*, which rebuilds context from stored assistant and tool
   entries with no calls (deterministic), and *re-run from entry X*, which branches. Store model id, provider, thinking level and the system/tool checkpoint per entry, as Pi does (§1), so playback
   reconstructs the exact prompt.
10. **Bound size at write time and set retention explicitly.** Truncate persisted tool output (Codex: 64 KiB, §5), store large attachments by content hash (Cloudflare, §7), compress cold files (Codex
    zstd, §5), and give retention a default (Claude: 30 days locally, §2). Surface write loss as an event, as Claude's `mirror_error` and `session_writes_lost` do (§2), instead of failing silently.
11. **Record admission before the first model call.** Pi flushes on the first user message (§1), while LangGraph cannot tell "never accepted" from "lost" (§4). Write the user entry durably before
    calling the model.

## Unresolved gaps

- Claude's on-disk entry union is CLI-internal (`CL:7350-7365`), and we did not inspect a real transcript, so field names beyond `uuid`/`parentUuid`/`type` are unverified, as is the exact `defer`
  resume flow.
- `@earendil-works/pi-durable`'s SQLite schema, Codex's exact JSONL append and fsync behaviour (`recorder.rs` not read in full), and OpenHands' `navigate_to`/fork API surface were not read.
- No harness offers concurrent multi-writer appends to one session. All of them assume a single writer, so multi-process access to one session means a lock or an actor, never merge.
- The Cloudflare Durable Object single-writer guarantee and the Managed Agents post are cited from earlier reports or docs URLs, not re-fetched in this session.

## Addendum: a real Claude Code transcript confirms a tree log with an explicit leaf and kept history (observed 2026-11-18)

The note above described Claude's on-disk format from `sdk.d.ts` only. I then inspected the structure of this research session's own transcript, written by the Claude Code CLI 2.1.327 under `~/.claude/projects/<project>/<session-id>.jsonl`. I recorded field names, entry types and link counts only, never message content. The format is internal and undocumented, so treat these observations as one sample from one version.
- **Entry types.** The file held 3,862 JSONL lines of nine types: `assistant` (1,754), `user` (837), `attachment` (769), `atis-latch`, `last-prompt` and `mode` (127–128 each), `queue-operation` (88), `system` (30) and `tools-used` (2). Only `user`, `assistant`, `attachment` and `system` entries carry a `uuid` and `parentUuid`. The others are session-level bookkeeping keyed by `sessionId`.
- **A tree, not a list.** All 3,390 linked entries form a tree with two roots. The 52 entries that have two children are all the same pattern: an assistant `tool_use` block whose children are the next `tool_use` block and its own `tool_result`. One API response is split into one entry per content block. The branching interleaves parallel tool calls; it doesn't fork the conversation.
- **An explicit current position.** `last-prompt` entries carry a `leafUuid` that names a known entry, which serves as the HEAD pointer the recommendations above call for.
- **Compaction starts a new root and keeps the old entries.** The single `system` entry with subtype `compact_boundary` has `parentUuid: null` and a `logicalParentUuid` that links back across the cut. Its `compactMetadata` records `trigger`, `preTokens`, `postTokens`, `cumulativeDroppedTokens`, `durationMs`, `preservedSegment`, `preservedMessages` and the pre-compaction task list. All 2,153 entries written before the boundary remain in the file, so compaction is non-destructive on disk.
- **Subagents get their own files.** Each subagent writes `subagents/agent-<id>.jsonl`, with every entry marked `isSidechain: true` and an `agentId`, plus a `.meta.json` (`agentType`, `description`, `model`, `spawnDepth`, `toolUseId`, `finished`, …) and a `.prefix.json`. The main file has no sidechain entries.
- **Large tool results spill to files.** A `tool-results/` folder beside the transcript held 10 `.txt` files, which matches the spill-to-file behavior that `notes/tools.md` attributes to Claude's 25K-token output cap.
- **Entries carry their environment.** Entries record `cwd`, `gitBranch`, `version`, `permissionMode` and `sandboxed`, and user entries record approval outcomes (`permissionDecision`, `toolDenialKind`). A resumed session can therefore rebuild where and under which permissions each turn ran.

For our harness, the sample backs three of the recommendations above: a typed tree log, an explicit HEAD entry, and compaction as an appended entry. It adds two details worth copying. Store one entry per content block, so parallel tool results interleave without ambiguity. Give each subagent its own log file, linked to the parent by the spawning tool-use id.
