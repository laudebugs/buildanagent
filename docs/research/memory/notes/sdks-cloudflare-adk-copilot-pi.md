# Retrieval and long-term memory in four more SDKs (as of November 2026)

Research notes, gathered 2026-11-19 from the worktree on branch `todo/U18-retrieval-and-long-term-memory` (commit `138527e`), at the versions pinned in `verify/<sdk>/package.json`: `agents` 0.33.0, `@cloudflare/think` 0.23.0, `@cloudflare/ai-chat` 0.12.2 and `@cloudflare/workers-types` 5.20261103.1; `@google/adk` 2.5.0; `@github/copilot-sdk` 1.0.31, which bundles Copilot runtime 1.0.109; and `@earendil-works/pi-coding-agent` and `pi-agent-core` 1.5.2. Every installed file was read as text, and no package code ran.

The tags mean:
- **[d.ts]**: checked in the installed typings. The path is relative to the worktree. Each `verify/<sdk>/node_modules/...` path is a pnpm symlink into `node_modules/.pnpm/`.
- **[docs]**: from the SDK's official docs, either the mirrored copy under `docs/reference/<sdk>/source/` (pinned in its `_manifest.json`) or a page fetched on 2026-11-19 (URL given).
- **[guide]**: from our own `docs/reference/<sdk>/guide.md` or `fact-check.md`.
- **[runtime strings]**: text found with `strings` in a shipped native binary. It shows what the binary contains, but it is not a documented API. Treat it as secondary.
- **[secondary]**: anything else not checked against a primary source.

Downloads are saved under `/private/tmp/claude-501/-Users-laudebugs-git-agent-speak-git/13349893-3ab5-443b-8939-e45188938409/scratchpad/u18-e/`. Python ADK sources were read at tag `v2.14.1` of `google/adk-python`, the Python version that `docs/reference/google-adk/guide.md` compares against.

## Cloudflare Agents (agents 0.33.0, Think 0.23.0, workers-types 5.20261103.1)

### Takeaway
Cloudflare has the richest offering of the four, and it comes in three layers:
- **In-package memory (offline).** `agents/context` provides prompt "context blocks". `AgentContextProvider` is a writable block in Durable Object SQLite. `AgentSearchProvider` is a searchable block backed by SQLite FTS5. The model gets auto-generated `set_context` and `search_context` tools. `agents/sessions` adds FTS5 search over the conversation itself. Think wires both through `configureContext()`. All of this lives in the Durable Object's own SQLite, so it runs in workerd/Miniflare with no account.
- **Platform bindings (need an account).** Vectorize (`query`/`upsert`/`deleteByIds`, namespaces, metadata filters), Workers AI embedding models, AI Search (formerly AutoRAG) and a new Agent Memory binding (private beta: `remember`/`ingest`/`recall`/`list`/`delete`/`deleteSession`) are typed in workers-types. Cloudflare documents no local simulation for Workers AI or Vectorize, and AI Search runs locally only by proxying to a deployed instance.
- **Scope and forgetting.** Context blocks are per Durable Object. Think's docs say they are "stored per chat" and that there is no cross-DO context provider. Forgetting exists only as overwrite or delete: no TTL anywhere in the agents package, Vectorize or Agent Memory.

### Cited Findings
- **`this.sql` declaration.** `sql<T = Record<string, string | number | boolean | null>>(strings: TemplateStringsArray, ...values: (string | number | boolean | null)[]): T[];` — [d.ts] `verify/cloudflare-agents/node_modules/agents/dist/agent-routing-vVMA7m8Y.d.ts:4250`. Example `verify/cloudflare-agents/examples/02-sql.ts` verifies parameter binding, typed rows and the shared database with `cf_agents_*` tables, and uses `LIKE` for search, not FTS5 [guide] (guide.md §4, "[verified: 02]").
- **FTS5 in Durable Object SQLite.** "Durable Objects support a subset of SQLite extensions … FTS5 module for full-text search (including `fts5vocab`)" — [docs] https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ (line 167–169 of the fetched markdown).
- **`agents/context` (experimental) declarations** — [d.ts] `verify/cloudflare-agents/node_modules/agents/dist/context/index.d.ts`:
  - `declare class AgentContextProvider implements WritableContextProvider { constructor(agent: SqlProvider, label?: string); get(): Promise<string | null>; set(content: string): Promise<void>; }` (line 12)
  - `interface SearchProvider extends ContextProvider { search(query: string): Promise<string | null>; set?(key: string, content: string): Promise<void>; }` (line 31)
  - `declare class AgentSearchProvider implements SearchProvider` ("SearchProvider backed by Durable Object SQLite with FTS5", `get()` returns a count of indexed entries, `set(key, content)` "indexes or replaces content under a key") (line 52)
  - `declare class ContextBlocks` (line 131), with `addBlock`, `removeBlock(label): boolean` (177), `setBlock`, `appendToBlock`, `freezeSystemPrompt()`, `refreshSystemPrompt()`, `reminder()`, and `tools(): Promise<ToolSet>` (231), which auto-wires "`set_context` — when any block is writable; `search_context` — when any block is a search provider".
  - `ContextConfig` has `label`, `description`, `maxTokens` ("Enforced on set"), `provider` and `whenChanged: "wait" | "remind"`.
- **Missing in `agents/context`.** There is no per-entry delete for a search block, and no TTL or expiry field on any provider [d.ts] (same file: `SearchProvider` has only `get`, `search` and optional `set`). `removeBlock` unregisters a block. It does not purge stored rows (the doc comment says it is "Used during extension unload cleanup").
- **What the docs say about these blocks.** `AgentSearchProvider` "returns up to 10 ranked matches through the `search_context` tool". Entries live in `cf_agents_search_fts`, namespaced by label. `AgentContextProvider` stores one block per row in `cf_agents_context_blocks`. The page carries the banner "Experimental. Everything exported from `agents/context` may change between releases" — [docs] `docs/reference/cloudflare-agents/source/agents/docs/agents/context.md` (lines 3, 51–77).
- **Conversation search.** `Session.search(query: string, options?: { limit?: number }): Promise<SearchResult[]>` ("Full-text search over this session's text parts. The index is built on the first call and maintained from then on"). The handle also has `deleteMessages(messageIds: string[]): Promise<void>` and `clearMessages(): Promise<void>` — [d.ts] `verify/cloudflare-agents/node_modules/agents/dist/handle-zAzh0UW2.d.ts:352, 428–429`. `SearchResult { id; role; content; createdAt?; sessionId? }` — [d.ts] `.../agents/dist/types-B7LojTe4.d.ts:41`. The docs say the FTS5 index is `cf_agents_session_fts`, created by the first `search()`, and that it indexes "text parts only", not file contents, reasoning or tool payloads — [docs] `.../agents/docs/agents/sessions.md:309–331`.
- **Think wiring.** `configureContext(): ContextConfig[] | Promise<ContextConfig[]>`. Its doc comment says "A block declared without a provider is auto-wired to durable per-agent SQLite storage", with the example `{ label: "memory", description: "Learned facts", maxTokens: 2000 }`. Think also exposes `protected get context(): ContextBlocks`, and `ThinkSession.search(...)` mirrors `Session.search` — [d.ts] `verify/cloudflare-agents/node_modules/@cloudflare/think/dist/index-DDnny6kt.d.ts:2861, 1852, 307`. The turn's tool set is "Merged tool set (workspace + getTools + session + MCP + client + caller)" (same file, line 1124).
- **Think docs.** "Add persistent memory … the model sees a `MEMORY` section in its system prompt and gets a `set_context` tool … facts written to memory survive DO hibernation and restarts" — [docs] `.../agents/docs/think/getting-started.md:200–232`.
- **Memory scope.** Memory blocks "are stored per chat, so a fact the model saves in one chat is not visible in another. Think does not ship a cross-Durable-Object context provider; to share memory, store it on the directory and expose it through your own RPC" — [docs] `.../agents/docs/think/multi-chat.md:475–479`.
- **Doc drift.** The cloudflare-docs concept page "Conversation state and memory" (mirrored at commit `6897a9f`) imports `agents/experimental/memory/session` and describes a `session_search` tool through `SessionManager`. Neither the subpath nor `SessionManager` exists in 0.33.0 — [docs] `docs/reference/cloudflare-agents/source/cloudflare-docs/src/content/docs/agents/concepts/conversation-state-and-memory.mdx:23, 34, 166`. [d.ts]: the `agents/package.json` exports map has only `./experimental/webmcp` and `./experimental/channels*`, and there is no `SessionManager`/`session_search` in any `dist/*.d.ts`. This is already logged as F12 in [guide] `docs/reference/cloudflare-agents/fact-check.md:141`. The same page says a custom `search()` can call Vectorize ("full-text search, vector search via Vectorize, a call to an external API, or anything else").
- **Vectorize** — [d.ts] `verify/cloudflare-agents/node_modules/@cloudflare/workers-types/index.d.ts`:
  - `declare abstract class Vectorize` (line 17999): `describe()`, `query(vector: VectorFloatArray | number[], options?: VectorizeQueryOptions): Promise<VectorizeMatches>`, `queryById(vectorId, options?)`, `insert`, `upsert(vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation>`, `deleteByIds(ids: string[]): Promise<VectorizeAsyncMutation>` and `getByIds`. Mutations are async and return a `mutationId`.
  - The legacy beta class `VectorizeIndex` (line 17953) has the same methods with synchronous `VectorizeVectorMutation` results.
  - `interface VectorizeQueryOptions { topK?; namespace?; returnValues?; returnMetadata?: boolean | VectorizeMetadataRetrievalLevel; filter?: VectorizeVectorMetadataFilter }` (line 17849).
  - Filter operators are `"$eq" | "$ne" | "$lt" | "$lte" | "$gt" | "$gte"`, plus collection ops `"$in" | "$nin"` (line 17811–17813).
  - `VectorizeVector { id; values; namespace?; metadata? }`.
  - There is no TTL field.
- **Vectorize docs.** topK is capped at 100, or 50 with `returnValues`/`returnMetadata: "all"`. Metadata filtering needs a metadata index, "Limited to 10 properties" — [docs] https://developers.cloudflare.com/vectorize/reference/client-api/.
- **Workers AI embeddings.** `AiModels` lists `"@cf/baai/bge-base-en-v1.5"`, `"@cf/baai/bge-small-en-v1.5"`, `"@cf/baai/bge-large-en-v1.5"`, `"@cf/baai/bge-m3"`, `"@cf/google/embeddinggemma-300m"`, `"@cf/qwen/qwen3-embedding-0.6b"` and the reranker `"@cf/baai/bge-reranker-base"` — [d.ts] `.../workers-types/index.d.ts:12036–12099`. They are called through `Ai.run` (class at line 12201).
- **AI Search (formerly AutoRAG)** — [d.ts] `.../workers-types/index.d.ts`:
  - `declare abstract class AiSearchNamespace` (5624): `get(name)`, `list()`, `create(config)`, `delete(name)` and multi-instance `search`.
  - `declare abstract class AiSearchInstance` (5549): `search(params: AiSearchSearchRequest): Promise<AiSearchSearchResponse>`, `chatCompletions(...)`, `update`, `info`, `stats`, `items` and `jobs`.
  - `AiSearchItems`: `list`, `upload` (5453), `uploadAndPoll`, `get`, `delete(itemId: string): Promise<void>` (5487).
  - `Ai.aiSearch()` (12209) and `Ai.autorag()` are both `@deprecated`, the latter with "AutoRAG has been replaced by AI Search. Use the standalone `ai_search_namespaces` or `ai_search` Workers bindings". `declare abstract class AutoRAG` (12892) is deprecated throughout.
- **AI Search docs.** "Local development is supported by proxying requests to your deployed AI Search instance. Add `remote: true`" — [docs] https://developers.cloudflare.com/ai-search/api/search/workers-binding/ (line 427–429). Agents docs page: `docs/reference/cloudflare-agents/source/cloudflare-docs/src/content/docs/agents/tools/ai-search.mdx`.
- **Agent Memory binding (private beta)** — [d.ts] `.../workers-types/index.d.ts`:
  - `declare abstract class AgentMemoryNamespace` (4887): `getProfile(profileName: string): Promise<AgentMemoryProfile>`, plus a profile soft-delete "and schedule deferred purge".
  - `declare abstract class AgentMemoryProfile` (4794):
    - `get(memoryId)`
    - `delete(memoryId: string): Promise<AgentMemoryMemory>` ("Removes the memory and any source messages linked")
    - `remember(memory: AgentMemoryIncomingMemory): Promise<AgentMemoryMemory>` ("automatically classified, summarized, and indexed")
    - `ingest(messages: Iterable<AgentMemoryMessage>, options?): Promise<void>`
    - `getSummary(options?)`
    - `recall(query: string, options?: AgentMemoryRecallOptions): Promise<AgentMemoryRecallResult>` (returns `answer` and scored `candidates`)
    - `list(options?)`
    - `deleteSession(sessionId: string): Promise<void>` ("Soft-delete every memory and message … tagged with `sessionId`")
  - Memory types are `"fact" | "event" | "instruction" | "task"` (4677). There is no TTL field.
- **Agent Memory docs.** "Agent Memory is in private beta". It is bound through an `agent_memory` entry in the Wrangler config. Storage uses "full-text search indexes. Non-task memories are also embedded as vectors", and recall runs keyword, topic-key, vector and raw-message retrieval in parallel — [docs] https://developers.cloudflare.com/agent-memory/, https://developers.cloudflare.com/agent-memory/api/workers-api/, https://developers.cloudflare.com/agent-memory/concepts/how-agent-memory-works/. The agents 0.33.0 package does not wrap this binding: no `.d.ts` under `agents/dist` or `@cloudflare/think/dist` mentions `AgentMemory` [d.ts].
- **Offline status.** The "Supported bindings per development mode" table marks **AI** and **Vectorize** "❌" for local simulation and "✅" for remote binding, while Durable Objects are "✅" locally — [docs] https://developers.cloudflare.com/workers/local-development/bindings-per-env/. The Local development page says: "There is no current local simulation for Workers AI" and "There is no current local simulation for Vectorize" — [docs] https://developers.cloudflare.com/workers/local-development/.
- **Our harness.** It runs every example in workerd through Miniflare with SQLite-backed DOs and a mock `AI` binding, and has no network access [guide] (`verify/cloudflare-agents/README.md`, "How it works"). `this.sql`, `ContextBlocks` and `AgentSearchProvider` should therefore run offline. FTS5 inside local workerd is untested here.
- **Retrieval is mostly bring-your-own.** The only built-in retrieval in the agents package is FTS5 keyword search: `AgentSearchProvider` and `Session.search`. Vector retrieval means writing a `SearchProvider` over Vectorize plus Workers AI. Think's workspace also gives the model `find` and `grep` over the virtual `/workspace` [guide] (guide.md, gotcha after §5).
- **Suggested example: `10-context-memory.ts`.** A Think or plain Agent that declares `configureContext()` with a writable `memory` block and an `AgentSearchProvider` `knowledge` block. Its test would have the mock model call `set_context` and `search_context`, evict the DO with `h.evict`, and assert that the block and the FTS hit survive. A second test would check that a second agent name (a "different chat") does not see the fact. Vectorize, AI Search and Agent Memory cannot be shown offline except against a hand-written fake binding.

## Google ADK for TypeScript (@google/adk 2.5.0)

### Takeaway
ADK has the clearest long-term-memory contract of the four:
- **The contract.** `BaseMemoryService` has two methods: `addSessionToMemory(session)` and `searchMemory({appName, userId, query})`. `Runner` takes it as `memoryService`. Agents read it through `LOAD_MEMORY` (a tool the model calls) or `PRELOAD_MEMORY` (injected before every model request). Tools and callbacks can also call `context.searchMemory(query)`.
- **Backends in 2.5.0.** `InMemoryMemoryService` (keyword match, process memory), `VertexAiMemoryBankService` (also has `addEventsToMemory` and `addMemory`) and `VertexAiRagMemoryService`.
- **Retrieval tools.** `VertexAiSearchTool`, `VertexRagRetrievalTool` (server-side grounding), `GoogleSearchTool`, `EnterpriseWebSearchTool`, `LlamaIndexRetrieval` and `FilesRetrieval`. `FilesRetrieval` needs `llamaindex`, which is not installed.
- **Gaps against Python ADK 2.14.1.** TS has no delete or forget API at all. Its base interface lacks `addEventsToMemory`/`addMemory`. `Context` lacks `addSessionToMemory`. There is no SQLite memory service.
- **Offline.** `InMemoryMemoryService` with `ScriptedLlm` works offline. Everything else needs Google Cloud.

### Cited Findings
- **`BaseMemoryService`.** `export interface BaseMemoryService { addSessionToMemory(session: Session): Promise<void>; searchMemory(request: SearchMemoryRequest): Promise<SearchMemoryResponse>; }` — [d.ts] `verify/google-adk/node_modules/@google/adk/dist/types/memory/base_memory_service.d.ts:37–52`. `SearchMemoryRequest` is `{ appName: string; userId: string; query: string }`, and the comment says "Implementations may use keyword matching or semantic search". `SearchMemoryResponse` is `{ memories: MemoryEntry[] }`.
- **`MemoryEntry`.** `{ content: Content; id?: string; customMetadata?: Record<string, unknown>; author?: string; timestamp?: string }` — [d.ts] `.../memory/memory_entry.d.ts`.
- **`InMemoryMemoryService`.** `export declare class InMemoryMemoryService implements BaseMemoryService` ("for prototyping purpose only. Uses keyword matching instead of semantic search"). It implements only `addSessionToMemory` and `searchMemory` — [d.ts] `.../memory/in_memory_memory_service.d.ts:13`. The adk-js guide says matching is whole-word, lowercase and alphabetic only, "so `flight` does not match `flights`", and that `InMemoryRunner` defaults to an `InMemoryMemoryService` — [docs] `docs/reference/google-adk/source/adk-js/docs/guides/memory/index.md` ("How it works", step 3; "Introduction").
- **`VertexAiMemoryBankService`** — [d.ts] `.../memory/vertex_ai_memory_bank_service.d.ts:21–51`:
  - The constructor takes `VertexAiMemoryBankServiceOptions { projectId?; location?; agentEngineId; expressModeApiKey?; client? }`.
  - Beyond the base methods it adds `addEventsToMemory(request: { appName; userId; events: Event[]; sessionId?; customMetadata? }): Promise<void>` and `addMemory(request: { appName; userId; memories: MemoryEntry[]; customMetadata? }): Promise<void>`.
  - TTL is not a typed option, but the compiled service forwards `ttl`, `revisionTtl`, `expireTime` and `revisionExpireTime` from `customMetadata` into the Vertex config (`ttl` becomes an alias for `revisionTtl`). [d.ts-adjacent: read in `.../dist/esm/memory/vertex_ai_memory_bank_service.js:21–34, 371–374`, not executed.]
- **`VertexAiRagMemoryService`.** `export declare class VertexAiRagMemoryService implements BaseMemoryService` with `constructor(options: VertexAiRagMemoryServiceOptions, ragApiClient?: RagApiClient)`. The options are `ragCorpus`, `similarityTopK?`, `vectorDistanceThreshold?` (default 10), `projectId?` and `location?`. The second argument is "An internal seam for tests to substitute a fake REST client … @internal". The comment says "Only `addSessionToMemory` and `searchMemory` are supported, matching adk-python" — [d.ts] `.../memory/vertex_ai_rag_memory_service.d.ts:41–54`. The comment in `.../memory/vertex_ai_rag_api.d.ts` says that "neither `@google-cloud/vertexai` nor `@google/genai` ships a RAG client", so it calls REST with Application Default Credentials.
- **Memory tools** — [d.ts] `.../tools/load_memory_tool.d.ts:36, 50` and `.../tools/preload_memory_tool.d.ts:15, 23`:
  - `export declare class LoadMemoryTool extends BaseTool { constructor(options?: LoadMemoryToolOptions); ... }` and `export declare const LOAD_MEMORY: LoadMemoryTool;`
  - `export declare class PreloadMemoryTool extends BaseTool` ("automatically executed for each `LlmRequest`, and it won't be called by the model … only uses text part") and `export declare const PRELOAD_MEMORY`.
  - The adk-js guide says PRELOAD injects `<PAST_CONVERSATIONS>` into the instructions [docs].
- **Wiring.** `Runner` has `memoryService?: BaseMemoryService` ("An optional service for storing and querying agent memory") — [d.ts] `.../runner/runner.d.ts:59, 127`. `InvocationContext` has `memoryService?` — [d.ts] `.../agents/invocation_context.d.ts:38, 122`. `Context` has `searchMemory(query: string): Promise<SearchMemoryResponse>` — [d.ts] `.../agents/context.d.ts:99`. It is the only memory method on `Context`.
- **Retrieval tools** — [d.ts] `verify/google-adk/node_modules/@google/adk/dist/types/tools/`:
  - `export declare class VertexAiSearchTool extends BuiltInTool` takes `DataStoreParams | SearchEngineParams` with `filter?` and `maxResults?` (`vertex_ai_search_tool.d.ts:38`).
  - `export declare class VertexRagRetrievalTool extends BuiltInTool { constructor(config: VertexRagStore) }` ("operates server-side … does not perform local code execution", one corpus per instance) (`vertex_rag_retrieval_tool.d.ts:39`).
  - `export declare class GoogleSearchTool extends BuiltInTool` and `GOOGLE_SEARCH` (`google_search_tool.d.ts:10`).
  - `ENTERPRISE_WEB_SEARCH`/`EnterpriseWebSearchTool` and `LoadArtifactsTool` are exported (`common.d.ts:159, 169`).
  - `export declare abstract class BaseRetrievalTool extends BaseTool` gives every retrieval tool the same one-argument `query` declaration (`retrieval/base_retrieval_tool.d.ts`).
  - `export declare class LlamaIndexRetrieval extends BaseRetrievalTool` takes a structural `LlamaIndexRetriever { retrieve(query: string): Promise<LlamaIndexNodeWithScore[]> }` and "Answers with the text of the single highest-scoring node" (`retrieval/llama_index_retrieval.d.ts:58`).
  - `export declare class FilesRetrieval extends LlamaIndexRetrieval` with `static create(params): Promise<FilesRetrieval>`, which "Requires the optional `llamaindex` and `@llamaindex/readers` packages, and a configured LlamaIndex embedding model" (`retrieval/files_retrieval.d.ts:39, 49`).
- **Optional packages missing locally.** `llamaindex` and `@mikro-orm/sqlite` are not installed in the worktree: `node_modules/.pnpm` has only `@mikro-orm+core@7.2.10` and `@google-cloud+vertexai@1.12.0`. So `FilesRetrieval.create` and a SQLite `DatabaseSessionService` would need `pnpm add`, which is out of scope here.
- **Artifacts.** `BaseArtifactService.deleteArtifact(request: DeleteArtifactRequest): Promise<void>` — [d.ts] `.../artifacts/base_artifact_service.d.ts:105`. `InMemoryArtifactService`, `FileArtifactService` and `GcsArtifactService` are exported (`index.d.ts:9–10`, `common.d.ts:42`). Artifacts are blob storage, not search.
- **Cross-session state.** `user:`- and `app:`-prefixed session state is shared across a user's or the app's sessions. It is a key-value store, not search [guide] (guide.md §6, "[verified: 04]"). Sessions have `deleteSession` — [d.ts] `.../sessions/base_session_service.d.ts:127`.
- **What the docs claim.**
  - Memory is "Supported in ADK … Python v0.1.0, TypeScript v0.2.0, Go, Java, Kotlin" — [docs] `docs/reference/google-adk/source/adk-docs/docs/sessions/memory.md:3` (adk-docs commit `ff7a5f5`, which "renders main, so pages may describe releases after 2.5.0").
  - The page lists `add_session_to_memory`, `add_events_to_memory` and `add_memory` as the ingestion operations, and says the last two "are optional and are not implemented by every service" (lines 13–31).
  - The TypeScript snippet for saving memory from a callback reaches through `callbackContext.invocationContext.memoryService.addSessionToMemory(...)`. Python uses `callback_context.add_session_to_memory()` (lines 403–433).
  - The callback-level `addEventsToMemory`/`addMemory` section is tagged Kotlin only (line 481ff.).
- **Python 2.14.1 has more** [docs: primary source at tag `v2.14.1`]:
  - `BaseMemoryService` declares `add_session_to_memory`, `add_events_to_memory`, `add_memory`, `search_memory` and `delete_memory(*, app_name, user_id, memory_id=None)`, which raises `NotImplementedError` by default (`src/google/adk/memory/base_memory_service.py:52–165`).
  - `InMemoryMemoryService` implements `add_events_to_memory` and `delete_memory` (`in_memory_memory_service.py:117, 216`).
  - `google.adk.memory` exports `SqliteMemoryService` (`memory/__init__.py:23–38`), which uses an FTS5 virtual table `memory_events_fts` with `fts="auto"|"on"|"off"` (`_sqlite_memory_service.py:79–195`).
  - `VertexAiMemoryBankService` documents `ttl` and `revision_ttl` ("Time-to-live for memory revisions, e.g. `"6000s"`") on `add_events_to_memory` and has `retrieve_profiles` (`vertex_ai_memory_bank_service.py:251–302, 625`).
  - `Context` has `add_session_to_memory`, `add_events_to_memory`, `add_memory`, `search_memory` and `delete_memory` (`agents/context.py:751–848`).
- **Python retrieval naming.** Python's RAG tool lives at `google/adk/tools/retrieval/vertex_ai_rag_retrieval.py`: HTTP 200 at `v2.14.1`, class name not read [secondary]. TS names its counterpart `VertexRagRetrievalTool`, a built-in tool that grounds on the server.
- **Community packages.** A Python-only community `adk-database-memory` (SQLAlchemy) integration is listed in the docs — [docs] `.../adk-docs/docs/integrations/database-memory.md`.
- **What TS lacks against Python 2.14.1:**
  1. Any delete or forget method: no `deleteMemory` in any `.d.ts` [d.ts].
  2. `addEventsToMemory`/`addMemory` on the base interface and on `InMemoryMemoryService`.
  3. `customMetadata` on `addSessionToMemory`.
  4. Memory-write methods on `Context`.
  5. `SqliteMemoryService`, the only persistent local memory backend.
  6. Typed TTL options.
  7. `retrieve_profiles`.
- **Existing example.** `verify/google-adk/examples/04-sessions-state.ts` covers session state prefixes (`user:`, `app:`, `temp:`) on `InMemorySessionService`. No example touches `memoryService` (grep of `examples/*.ts` for "memory" finds only `InMemoryRunner`). The adk-js repo ships `samples/memory/agent.ts`, a deterministic `BaseAgent` that seeds two sessions and checks tenant isolation — [docs] `docs/reference/google-adk/source/adk-js/samples/memory/README.md`.
- **Offline status.**
  - Works offline: `InMemoryMemoryService`, `LOAD_MEMORY` and `PRELOAD_MEMORY` with our `ScriptedLlm` (`verify/google-adk/examples/lib/check.ts`) [guide] (fact-check.md:42 describes the scripted-model preload and refusal of non-local requests).
  - Needs Google Cloud: Memory Bank, RAG memory, Vertex AI Search, RAG retrieval and Google Search. They are built-in tools that only change the request config, so a scripted model never exercises them.
  - `VertexAiRagMemoryService` could be driven offline through its `@internal` `ragApiClient` seam with a fake `RagApiClient`. That relies on an internal API.
- **Retrieval is not only bring-your-own.** ADK ships first-party retrieval tools, but every vector-backed one is Google Cloud or LlamaIndex. Offline vector search means writing a `BaseRetrievalTool` or `FunctionTool` yourself.
- **Suggested example: `09-memory-service.ts`.** Run session 1 with `Runner({ memoryService: new InMemoryMemoryService() })`, then call `addSessionToMemory`. In session 2, the scripted model calls `load_memory` and the test asserts the recalled `MemoryEntry`. Further cases:
  - `PRELOAD_MEMORY` puts `<PAST_CONVERSATIONS>` in the request.
  - Another `userId` sees nothing.
  - The whole-word match misses `flights` for `flight`.
  - A recorded negative: there is no way to forget an entry except discarding the service.

## GitHub Copilot SDK (@github/copilot-sdk 1.0.31, runtime 1.0.109)

### Takeaway
The Copilot SDK exposes GitHub Copilot Memory as a session option:
- **Memory option.** `memory: { enabled, mode?, storeMemory? }` turns on the runtime's `store_memory` and `vote_memory` tools. Writes pass through the permission handler as `kind: "memory"`, with scope `"repository" | "user"`.
- **Bring your own backend.** The experimental `storeMemory` callback redirects writes to your own storage. With it set, the runtime retrieves nothing, `vote_memory` disappears, and you must supply recall yourself, for example through `systemMessage`.
- **No forgetting from the SDK.** The SDK has no list, delete or TTL call for memories. Expiry (90 days by default, reset by an upvote) and deletion happen on GitHub's side, in settings.
- **Other cross-session pieces.** Persisted sessions with `resumeSession`/`deleteSession`; an `enableSessionStore` flag for a cross-session store that the runtime's prompt describes as a read-only `session_store` SQL database; infinite sessions with background compaction; custom-instruction files (`AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md`); and skills.
- **Retrieval tools.** The runtime ships `grep`/`glob` (ripgrep binaries in the platform package) and GitHub `search_code`. There is no embedding or vector-store API.
- **Offline.** Built-in memory almost certainly needs a GitHub identity, so it cannot run in our offline BYOK harness. The docs say `storeMemory` needs no GitHub identity, so a callback-only example is plausible but untested.

### Cited Findings
- **`MemoryConfiguration`** — [d.ts] `verify/copilot-sdk/node_modules/@github/copilot-sdk/dist/types.d.ts:1899–1923`:
  - `export interface MemoryConfiguration { enabled: boolean; mode?: "system-prompt" | "user-prompt"; storeMemory?: (memory: StoredMemory, options: MemoryStoreCallOptions) => Promise<void>; }`.
  - `mode` and `storeMemory` are `@experimental`.
  - The comment on `storeMemory`: "The runtime validates the memory, filters secrets and requests approval, then calls this callback. `store_memory` succeeds only after the returned promise resolves … `options.signal` aborts when the runtime stops waiting, for example after its 60-second timeout. While set, the runtime retrieves no memories and `vote_memory` is unavailable, so supply recall yourself, for example through `systemMessage`."
- **`StoredMemory`.** `export interface StoredMemory { sessionId: string; subject: string; fact: string; citations: string; reason: string; }` — [d.ts] `types.d.ts:1939`.
- **Session option.** `memory?: MemoryConfiguration` on the session config ("When omitted, the runtime default applies") — [d.ts] `types.d.ts:2821–2822`. The RPC schema mirrors it as `MemoryConfiguration`/`MemoryMode`/`MemoryStoreRequest`, all `@experimental` — [d.ts] `dist/generated/rpc.d.ts:4896, 23413–23440`. `SessionCapability` includes `"memory"` ("Memory tool and memories prompt section") — [d.ts] `rpc.d.ts:5964–5965`.
- **Permission flow.** `export interface PermissionRequestMemory { action?: "store" | "vote"; citations?; direction?: "upvote" | "downvote"; fact: string; kind: "memory"; reason?; repoNwo?; scope?: "repository" | "user"; subject?; toolCallId? }` — [d.ts] `dist/generated/session-events.d.ts:11573` (enums at 1283–1330). Session-scoped approval `{ kind: "memory" }` is "Approval covering writes to long-term memory" — [d.ts] `rpc.d.ts:25506`.
- **No list or delete RPC.** No `.d.ts` declares a memory list, get, delete or expiry method. The only memory-named RPC types are configuration, store request and approval kinds [d.ts] (grep of `dist/generated/rpc.d.ts` for quoted `*memor*` identifiers).
- **SDK docs.** "Sessions can opt in to the memory feature … In the default `"copilot-cli"` client mode the SDK leaves `memory` unset so the runtime applies its own default, while `"empty"` mode defaults `memory` to disabled" — [docs] `docs/reference/copilot-sdk/source/nodejs/README.md:1646–1653` (tag `v1.0.31`, commit `15de061`).
- **`storeMemory` docs** — [docs] `docs/reference/copilot-sdk/source/docs/setup/multi-tenancy.md:486–538`:
  - "Set `storeMemory` to keep the memories the agent saves in your own storage … No GitHub identity or memory feature flag is required."
  - "`store_memory` takes no `scope`, so apply your own tenant, user and retention rules. Only the main agent stores memories; sub-agents can't store memories and don't recall built-in memories. `storeMemory` requires `enabled: true` and isn't supported for cloud sessions. Set it again on every resume."
  - "A retried tool call can deliver the same memory again."
- **GitHub Copilot Memory docs** — [docs] https://docs.github.com/en/copilot/concepts/agents/copilot-memory (fetched as markdown via `docs.github.com/api/article/body`):
  - Memory comes as "Repository-level facts" and "User-level preferences", and is available on paid plans and on surfaces including "Copilot CLI".
  - Copilot checks citations before using a memory, and an "internal voting system" rates usefulness.
  - "stored repository facts and user preferences expire after a period without reinforcement … The default expiry period is 90 days. Enterprise and organization owners can configure the expiry period for repository-level facts to any value between 7 and 180 days". An upvote resets the period, and "Simply retrieving a memory does not reset this period."
  - Deletion happens in repository or personal settings, and org owners can export or delete in bulk.
  - The page also says "Use Copilot CLI to import prepared memories in bulk".
- **Runtime contents** [runtime strings] (`node_modules/.pnpm/@github+copilot-sdk-darwin-arm64@1.0.31/node_modules/@github/copilot-sdk-darwin-arm64/prebuilds/darwin-arm64/runtime.node`):
  - The prompt text "Use store_memory only for a durable fact that is not already in the displayed memories …" and "vote_memory budget exhausted".
  - A `sql` tool database: "**Session store** (database: "session_store", read-only): History from all past sessions … prefer it over `store_memory` for historical retrieval", with tables `sessions(id, cwd, repository, branch, summary, created_at, updated_at)` and `turns(session_id, turn_index, user_message, assistant_response, timestamp)`.
  - A `context_board` "dynamic context board".
  - The platform package also ships `definitions/rem-agent.agent.yaml`, a "Memory consolidation agent … updates the dynamic context board (add / prune) so future sessions on this repository benefit. Launched in the background from the /subconscious run slash command" [runtime file, read as text]. No SDK `.d.ts` exposes the board.
- **Session store flag.** `enableSessionStore?: boolean` ("enables the cross-session store for search and retrieval across sessions. When false, session content is not written to or read from the shared session store") — [d.ts] `types.d.ts:2952`. The README adds: "When unset in `"copilot-cli"` mode, the runtime default applies (enabled). In `"empty"` mode, defaults to disabled" — [docs] `nodejs/README.md:400`.
- **Persistence and resume.** `resumeSession(sessionId: string, config: ResumeSessionConfig): Promise<CopilotSession>`, `deleteSession(sessionId: string): Promise<void>` and `listSessions(filter?: SessionListFilter): Promise<SessionMetadata[]>` — [d.ts] `dist/client.d.ts:285, 391, 408`. "`disconnect()` releases in-memory resources but keeps session data on disk … `deleteSession()` permanently removes everything" — [docs] `docs/reference/copilot-sdk/source/docs/features/session-persistence.md:667`. Custom tools must be passed again on resume [guide] (guide.md §3, "[verified: 06]").
- **Infinite sessions.** `InfiniteSessionConfig { enabled?: boolean (default true); backgroundCompactionThreshold?: number (0.80); bufferExhaustionThreshold?: number (0.95) }` — [d.ts] `types.d.ts:1876`.
- **Instructions and skills** — [d.ts] `types.d.ts`:
  - `skipCustomInstructions?: boolean` (default false, true under `mode: "empty"`), whose comment names `.github/copilot-instructions.md`, `AGENTS.md` and `CLAUDE.md` (2545–2551).
  - `instructionDirectories?: string[]` (2795).
  - `skillDirectories?: string[]` (2737).
  - `SkillProvider` (README "Skill providers (experimental)" serves skills "from your own storage, such as a database").
- **Search tools.** The harness denies the runtime's host tools by name, among them `grep`, `glob`, `sql`, `view` and `web_fetch` [guide] (`verify/copilot-sdk/README.md`, "Safety"). The platform package ships `ripgrep/` and `tgrep/` binaries [runtime file listing]. Runtime strings show a "Search Subagent" and GitHub `search_code` [runtime strings]. The SDK offers no embedding, vector-store or file-search API [d.ts] (none in `dist/*.d.ts`). Retrieval beyond grep and glob is bring-your-own, through custom tools or MCP.
- **Existing examples.** `verify/copilot-sdk/examples/06-resume-session.ts` covers resume from `baseDirectory`. No example sets `memory`.
- **Offline status.** The harness uses BYOK against a local mock model and blocks GitHub [guide] (`verify/copilot-sdk/README.md`). Built-in memory backends are GitHub services, so they cannot be tested offline [inference]. `storeMemory` "requires no GitHub identity" [docs], but it is untested whether the 1.0.109 runtime offers `store_memory` to a BYOK session, and whether `BUILTIN_DENY` in `scripts/mock-model.mjs` would need to allow it. The harness also runs only on Linux (`unshare -rn`).
- **Suggested example: `10-memory-callback.ts`.** Create a session with `memory: { enabled: true, storeMemory }`. The mock model calls `store_memory`, and the test asserts:
  - the permission request arrives with `kind: "memory"`;
  - the callback receives `{ subject, fact, citations, reason, sessionId }`;
  - a rejected callback fails the tool call with a generic message;
  - a resume without `storeMemory` reverts to built-in backends.

  Recall would be shown by passing stored facts back through `systemMessage`. If the runtime does not expose `store_memory` under BYOK, record that as a finding.

## Pi (@earendil-works/pi-coding-agent 1.5.2, pi-agent-core 1.5.2)

### Takeaway
Pi ships no memory feature and no retrieval primitives beyond its file tools:
- **File tools.** `read`, `grep` (local ripgrep), `find` and `ls`, plus a built-in `tool_search` that searches deferred tools, not content.
- **Long-term context.** Context files only: `AGENTS.md` and `CLAUDE.md`, loaded from the agent dir, cwd and parent directories. Skills (`SKILL.md`) load on demand.
- **Sessions.** Append-only JSONL trees with compaction. "Entries cannot be modified or deleted". `SessionManager.list` and `listAll` enumerate past sessions.
- **Documented stance.** The mirrored v1.5.2 docs say nothing about memory. The README says Pi "skips features like sub-agents and plan mode" and that users should "build what you want, or install a package". Memory is therefore an extension concern: `pi.registerTool()` adds a memory or search tool, `pi.appendEntry()` persists state in the session (not sent to the LLM), and `before_agent_start` can inject recalled text.
- **Offline.** Everything runs offline with `fauxProvider()`.

### Cited Findings
- **Built-in tool set.** `export type ToolName = "read" | "bash" | "powershell" | "edit" | "write" | "grep" | "find" | "ls";` plus `createReadOnlyTools(cwd, options?)` and `createCodingTools(...)` — [d.ts] `verify/pi/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.d.ts:23, 40–41`.
- **`grep`.** `export declare function createGrepTool(cwd: string, options?: GrepToolOptions): TypeBoxAgentTool<typeof grepSchema>`, with schema `{ pattern; path?; glob?; ignoreCase?; literal?; context?; limit? }`. Its comment: "The search itself always runs the local ripgrep; to search a remote system, override the tool's execute()" — [d.ts] `.../core/tools/grep.d.ts:5–41`.
- **`find` and `read`.** `createFindTool(cwd, options?)` with schema `{ pattern; path?; limit? }` — [d.ts] `.../core/tools/find.d.ts:8, 40`. `createReadTool` — [d.ts] `.../core/tools/read.d.ts:61`.
- **`tool_search`.** Pi "ships a built-in `tool_search` tool. Register tools with `exposure: "deferred"` to make them findable by it". The custom search-tool example "uses simple keyword matching, but the search implementation could use BM25, embeddings, a remote catalog" — [docs] `docs/reference/pi/source/coding-agent/extensions.md:2660–2665`. `export type ToolExposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden"` — [d.ts] `.../core/extensions/types.d.ts:415`.
- **Context files.** `<agent-dir>/AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md` and `CLAUDE.MD` are "User instructions applied across working directories". Pi loads context files "from the agent directory, the working directory, and its parent directories" — [docs] `.../coding-agent/configuration.md:18, 41–45`. `export declare function loadProjectContextFiles(options: { cwd: string; agentDir: string }): Array<{ path: string; content: string }>` — [d.ts] `.../core/resource-loader.d.ts:65`. A CLI flag "Disables `AGENTS.md` and `CLAUDE.md` discovery" — [docs] `.../coding-agent/cli.md:217`.
- **Skills.** `export declare function loadSkills(options: LoadSkillsOptions): LoadSkillsResult` and `loadSkillsFromDir` — [d.ts] `.../core/skills.d.ts:35, 62`. Docs: `.../coding-agent/skills.md`.
- **Sessions** — [d.ts] `.../core/session-manager.d.ts`:
  - `static create`, `open`, `continueRecent`, `forkFrom`, `inMemory` (378–401, 393).
  - `static list(cwd, sessionDir?, ...)` and `static listAll(...)`, both returning `Promise<SessionInfo[]>` (415–421).
  - `appendCustomEntry(customType: string, data?: unknown): string` (280).
  - `getEntries()` (341).
  - The comment "Entries cannot be modified or deleted" (339).

  There is no delete method. Forgetting means deleting the JSONL file or branching away from an entry [inference]. Compaction "appends a summary and keeps the originals" [guide] (guide.md §9, "[verified: 06]").
- **Extension API.** `registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = any>(tool: ToolDefinition<TParams, TDetails, TState>): void` and `appendEntry<T = unknown>(customType: string, data?: T): void` ("Append a custom entry to the session for state persistence (not sent to LLM)") — [d.ts] `.../core/extensions/types.d.ts:1271, 1317`. The docs list "Session persistence — Store state that survives restarts via `pi.appendEntry()`" and say `registerTool` "works both during extension load and after startup" — [docs] `.../coding-agent/extensions.md:12–17, 1582–1588`.
- **Prompt injection.** `before_agent_start` exposes `systemPromptOptions` (sections, `contextFiles`, selected tools), which an extension can mutate to inject recalled memory — [docs] `.../coding-agent/extensions.md:639–657`.
- **Stance.** "Pi ships with powerful defaults but skips features like sub-agents and plan mode. Ask Pi to build what you want, or install a package that does it your way." — [docs] `.../coding-agent/README.md`, intro. A grep of the mirrored docs and examples for memory, remember, rag, embedding and vector finds no memory feature or memory example extension. The only hits are llama.cpp RAM notes, `remember: true` on a project-trust decision, and the `search_tools` example [docs] (`docs/reference/pi/source/`, tag `v1.5.2`, commit `b4afddd`). `pi-agent-core` typings contain no "memory" [d.ts] (grep of `verify/pi/node_modules/@earendil-works/pi-agent-core/dist`). The README points to OpenClaw as a real-world build on Pi. Its memory features were not checked [secondary, unverified].
- **Existing examples.** `verify/pi/examples/03-tool-selection.ts` (read-only `["read","grep","find","ls"]`), `05-session-tree.ts`, `06-compaction.ts` and `07-extension-gate.ts`. All use the faux provider [guide] (guide.md §9–§10 and the example table).
- **Offline.** pi-ai's `fauxProvider()` is "for tests and demos". With in-memory session and settings managers and an explicit `DefaultResourceLoader`, nothing touches `~/.pi` [guide] (guide.md lines 161–198).
- **Retrieval is bring-your-own**, apart from grep and find over files.
- **Suggested example: `09-memory-extension.ts`.** An inline extension registers `remember(fact)` and `recall(query)` tools backed by a JSON or SQLite file in a temp dir, and recalled facts are injected in `before_agent_start`. Session A's faux model calls `remember`. Session B is a new `SessionManager.inMemory()` over the same store and recalls the fact. A third test shows a `forget(id)` tool removing it. A simpler variant writes `AGENTS.md` into the temp cwd and asserts that session B's system prompt contains it, which is "file memory" with no extension.

## Summary table

| SDK | Pinned version (as of November 2026) | Retrieval primitives | Long-term memory primitive | Forget / TTL | Offline test support |
|---|---|---|---|---|---|
| Cloudflare Agents | agents 0.33.0, think 0.23.0, workers-types 5.20261103.1 | `this.sql` (DO SQLite, FTS5 available); `AgentSearchProvider` (FTS5) + `search_context` tool; `Session.search` (FTS5 over messages); Think workspace `find`/`grep`; bindings: Vectorize (`query`, `upsert`, `deleteByIds`, namespace, metadata filter), Workers AI embeddings (bge-*, embeddinggemma, qwen3-embedding), AI Search (`search`, `chatCompletions`, `items`) | `ContextBlocks` + `AgentContextProvider` (writable block, `set_context`); Think `configureContext()`; Agent Memory binding (`remember`/`ingest`/`recall`, private beta) | Overwrite via `set`; `Session.deleteMessages`/`clearMessages`; Vectorize `deleteByIds`; AI Search `items.delete`; Agent Memory `delete`, `deleteSession`, profile soft-delete. No TTL anywhere | Yes for DO SQLite, context blocks and FTS (workerd/Miniflare; FTS5 locally untested). No local simulation for Workers AI or Vectorize; AI Search only via remote proxy |
| Google ADK (TS) | @google/adk 2.5.0 | `VertexAiSearchTool`, `VertexRagRetrievalTool`, `GoogleSearchTool`, `EnterpriseWebSearchTool` (server-side built-ins); `BaseRetrievalTool`, `LlamaIndexRetrieval`, `FilesRetrieval` (needs llamaindex, not installed) | `BaseMemoryService` (`addSessionToMemory`, `searchMemory`); `InMemoryMemoryService`, `VertexAiMemoryBankService` (+`addEventsToMemory`, `addMemory`), `VertexAiRagMemoryService`; `LOAD_MEMORY`, `PRELOAD_MEMORY`; `Context.searchMemory` | None in TS (no `deleteMemory`); Memory Bank TTL only via untyped `customMetadata.ttl`/`revisionTtl`. Python 2.14.1 has `delete_memory` and typed TTL docs | Yes for `InMemoryMemoryService` + memory tools with `ScriptedLlm`; Vertex services need GCP (RAG memory has an `@internal` fake-client seam) |
| GitHub Copilot SDK | @github/copilot-sdk 1.0.31 (runtime 1.0.109) | Runtime built-ins `grep`, `glob`, `view`, `sql` (incl. read-only `session_store` of past sessions, runtime strings), GitHub `search_code`; no embedding or vector API | `memory: { enabled, mode?, storeMemory? }` → runtime `store_memory`/`vote_memory` (GitHub Copilot Memory, repo and user scope); `enableSessionStore`; persisted sessions + `resumeSession`; `AGENTS.md`/`copilot-instructions.md`; skills | SDK: `deleteSession` only; no memory list or delete. GitHub side: 90-day expiry (7–180 configurable for repo facts), reset by upvote; delete in settings. `storeMemory`: your own retention | Partial: sessions and resume tested offline (BYOK mock, Linux only); built-in memory needs GitHub; `storeMemory` path untested |
| Pi | pi-coding-agent 1.5.2, pi-agent-core 1.5.2 | `read`, `grep` (ripgrep), `find`, `ls`; `tool_search` (over deferred tools, not content) | None built in; `AGENTS.md`/`CLAUDE.md` context files; skills; session JSONL tree + `appendEntry`; extension `registerTool` for a DIY memory tool | None: entries cannot be modified or deleted; delete the session file yourself | Yes: `fauxProvider()` + in-memory managers; any DIY memory extension runs offline |

## Gaps

- **Cloudflare.**
  - FTS5 inside local workerd/Miniflare was not exercised. It is documented for deployed Durable Objects only.
  - `agents/context` and `agents/sessions` are `@experimental`, and the cloudflare-docs memory page already teaches import paths that 0.33.0 lacks (F12).
  - Agent Memory is in private beta and typed in workers-types only. Its limits, pricing, regional storage and any local simulation were not read beyond the overview, Workers API and concepts pages.
  - Whether Think auto-adds `search_context` and `set_context` to the turn tool set was inferred from the d.ts comment ("session" in the merged tool set) and `think/getting-started.md:276`, not run.
- **Google ADK.**
  - The adk-docs mirror renders `main`, not the 2.5.0 release, so its TS support tags may describe later releases.
  - Python claims come from adk-python `v2.14.1` source files read as text. The Python docs page itself does not mention `delete_memory` or `SqliteMemoryService`.
  - Memory Bank TTL behaviour on the TS path was read from compiled JS, not typings, and not run.
  - `VertexRagRetrievalTool` against Python `VertexAiRagRetrieval` was compared by file path only.
- **Copilot SDK.**
  - The `store_memory`, `vote_memory`, `session_store` and `context_board` details come from strings in a native binary and a bundled agent YAML. They are not documented SDK APIs and may change without notice.
  - Whether a BYOK session with no GitHub identity is offered `store_memory` at all is unknown.
  - The GitHub docs page was fetched through `docs.github.com/api/article/body`, the markdown rendering of the article URL, not the HTML page.
  - How the SDK's `"user-prompt"` memory mode interacts with retrieval was not checked.
- **Pi.**
  - No primary statement on memory exists in the v1.5.2 docs, so "no memory feature" rests on its absence from the docs and typings. The upstream repo's `main`, issues and Pi packages registry were not searched.
- **All four.**
  - No new example was written or run. The suggested examples (`10-context-memory.ts`, `09-memory-service.ts`, `10-memory-callback.ts`, `09-memory-extension.ts`) are proposals only.
