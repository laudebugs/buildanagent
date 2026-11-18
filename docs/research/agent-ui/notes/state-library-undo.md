# Undo in client-side state libraries, and how each would carry an AI agent's edits (as of November 2026)

*Working material for the [undo report](../undo-agent-edits.md); the report and its [fact-check log](../fact-check.md#undo-for-agent-edits-report-2026-11-18) supersede this note where they disagree.*

Scope: Yjs `UndoManager`, Immer patches, TanStack Query optimistic updates, NgRx Store (ngrx-wieder) and NgRx SignalStore (`withUndoRedo` from `@angular-architects/ngrx-toolkit`), plus brief coverage of zundo (Zustand), redux-undo, valtio-history, jotai-history, Legend-State and mobx-state-tree's `UndoManager`. Versions are npm `latest` dist-tags read from `https://registry.npmjs.org/<pkg>` on 2026-11-18. Unless marked otherwise, claims come from the pinned source or the official docs. "Inferred" marks my own reading of the code and is not a documented guarantee.

Pinned versions (npm `latest`, publish date, license; all MIT):

| Package | Version | Published | Note |
|---|---|---|---|
| `yjs` | 13.6.33 | 2026-09-23 | `next` = 14.0.0-8, `beta` = 14.0.0-16 (v14 is still pre-release) |
| `immer` | 11.2.10 | 2026-11-10 | under the repo's one-week age rule, so pin an earlier 11.2.x for code |
| `@tanstack/query-core` / `@tanstack/react-query` | 5.108.0 | 2026-11-17 | one day old, so pin an earlier 5.x for code |
| `@ngrx/store` / `@ngrx/signals` | 22.0.1 | 2026-09-10 | |
| `@angular-architects/ngrx-toolkit` | 22.0.0 | 2026-08-31 | |
| `ngrx-wieder` | 17.0.0 | 2026-08-30 | |
| `zundo` | 2.3.0 | 2024-11-17 | |
| `redux-undo` | 1.1.0 | 2023-07-17 | README says "Not Actively Maintained" |
| `valtio` / `valtio-history` | 2.3.2 / 1.1.3 | 2026-05-01 / 2026-09-18 | |
| `jotai` / `jotai-history` | 3.0.2 / 0.6.0 | 2026-11-09 / 2026-07-29 | |
| `@legendapp/state` | 2.1.15 (latest); 3.0.0-beta.48 | 2024-08-30; 2026-07-12 | v3 is still beta |
| `mobx-state-tree` / `mst-middlewares` | 9.0.2 / 6.1.0 | 2026-11-18 / 2024-07-21 | |

Sources for the table: `https://registry.npmjs.org/yjs`, `.../immer`, `.../@tanstack/query-core`, `.../@ngrx/signals`, `.../@angular-architects/ngrx-toolkit`, `.../ngrx-wieder`, `.../zundo`, `.../redux-undo`, `.../valtio-history`, `.../jotai-history`, `.../@legendapp/state`, `.../mst-middlewares` (fetched 2026-11-18).

## Yjs UndoManager: origins, grouping, stack items, scope and collaborators

### Takeaway
Yjs is the only library here with built-in per-actor selective undo. Tagging every agent transaction with its own origin and giving the agent its own `UndoManager` (`trackedOrigins: new Set([agentOrigin])`) yields an agent-only undo stack that never reverts a human's or a remote collaborator's edits. Undo works on CRDT item IDs rather than array indices, so it stays correct after interleaved concurrent edits. The limits: grouping is time-based (`captureTimeout`, default 500 ms) or manual (`stopCapturing()`), and the stacks live only in memory.

### Cited Findings
- **Constructor and defaults.** `new UndoManager(typeScope, { captureTimeout = 500, captureTransaction = _tr => true, deleteFilter = () => true, trackedOrigins = new Set([null]), ignoreRemoteMapChanges = false, doc })`. The scope may be a `Doc`, one shared type, or an array of types. "If set to a specific type, only changes on that type or its children will be undone." — [UndoManager.js v13.6.33, L130–175](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **Tracking rule (the core of actor separation).** A transaction is captured only if `captureTransaction(tr)` returns true, it touched a type in scope, and `trackedOrigins.has(transaction.origin)` holds, or the origin's constructor is in `trackedOrigins` (so class-based matching works): `(!this.trackedOrigins.has(transaction.origin) && (!transaction.origin || !this.trackedOrigins.has(transaction.origin.constructor)))` returns early. — [UndoManager.js L212–218](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **Defaults track only untagged local edits.** The default `trackedOrigins` is `new Set([null])`, and "By default, all local changes that don't specify a transaction `origin` will be tracked." The manager adds itself to `trackedOrigins` (`trackedOrigins.add(this)`), so its own undo/redo transactions are captured onto the opposite stack. — [UndoManager.js L169, L181](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js); [Yjs docs: Y.UndoManager](https://docs.yjs.dev/api/undo-manager) (source: [yjs/docs api/undo-manager.md](https://github.com/yjs/docs/blob/main/api/undo-manager.md))
- **Tagging an edit.** Callers set the origin with `doc.transact(() => { ... }, origin)`. The docs show origins as a number (`42`) or a class (`CustomBinding`); a transaction with origin `41` is not tracked when only `42` is. `addTrackedOrigin(origin)` and `removeTrackedOrigin(origin)` change the set at runtime. — [Yjs docs: Specify tracked origins](https://docs.yjs.dev/api/undo-manager); [UndoManager.js L290–305](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **Time-based grouping.** A tracked change is merged into the top stack item when `now - this.lastChange < this.captureTimeout` (and the manager is neither undoing nor redoing). Otherwise it pushes a new `StackItem`. "Set it to 0 to capture each change individually." — [UndoManager.js L239–250](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js); [Yjs docs](https://docs.yjs.dev/api/undo-manager)
- **`stopCapturing()`** only sets `lastChange = 0`, so the next tracked change starts a new stack item. — [UndoManager.js L320–342](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **`StackItem` content.** Each item holds two `DeleteSet`s, `insertions` and `deletions` (ranges of CRDT item IDs), plus `meta = new Map()`, which is commented "Use this to save and restore metadata like selection range". — [UndoManager.js L21–34](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **Events.** `stack-item-added`, `stack-item-updated` (a change merged into the top item), `stack-item-popped` and `stack-cleared`. Each event carries `{ stackItem, origin, type: 'undo'|'redo', changedParentTypes }`. The docs show saving a cursor location in `stackItem.meta` on add and restoring it on pop. — [UndoManager.js L144–158, L268–276](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js); [Yjs docs: Add additional information to the StackItems](https://docs.yjs.dev/api/undo-manager)
- **New edits clear redo.** Any tracked change made outside undo/redo calls `this.clear(false, true)`, which clears the redo stack. — [UndoManager.js L224–228](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **How undo works.** `popStackItem` runs in one `transact(doc, ..., undoManager)`. It deletes the items recorded in `insertions` that are still alive and in scope (following `redone` links), and calls `redoItem` to restore items in `deletions`. Items both created and deleted inside the same capture interval are skipped. `deleteFilter(item)` can veto individual deletions. — [UndoManager.js L44–128](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **Remote changes are protected.** `ignoreRemoteMapChanges` is documented as "Experimental. By default, the UndoManager will never overwrite remote changes. Enable this property to enable overwriting remote changes on key-value changes (Y.Map, properties on Y.Xml, etc..)." — [UndoManager.js L139](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **GC protection.** Deleted structs in scope are marked `keepItem(item, true)` so garbage collection cannot remove content an undo may need. `clear()` releases them. — [UndoManager.js L253–258, L43–50](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **Multi-doc scope.** `addToScope` warns `[yjs#509] Not same Y.Doc` and points to `MultiDocUndoManager` for scopes that span documents. — [UndoManager.js L279–287](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js)
- **Versions.** 13.6.33 is `latest` (2026-09-23); 14.0.0 is on the `next` and `beta` tags only. — [npm registry: yjs](https://registry.npmjs.org/yjs)

### Inferences
- **Per-actor stacks.** Run two managers on the same scope: `humanUM` with the default `trackedOrigins` (`null`), and `agentUM` with `trackedOrigins: new Set([agentOrigin])`. Wrap every agent write in `doc.transact(fn, agentOrigin)`. Each manager then sees only its own actor's transactions. `agentUM.undo()` deletes only the item IDs the agent inserted and restores only what it deleted, so the human's interleaved edits survive (from the tracking rule and the ID-based `popStackItem`). The agent's undo transaction carries origin `agentUM`, which `humanUM` does not track, so the human stack is unaffected.
- **One undo unit per agent action.** To make one agent action (a multi-tool turn) a single undo unit: call `agentUM.stopCapturing()` at the start, do all edits inside one `doc.transact(..., agentOrigin)` where possible, and set a large `captureTimeout` on the agent manager so writes spread over several seconds still merge. Then call `stopCapturing()` at the end. Use `stack-item-added` to write the run or turn ID into `stackItem.meta` for UI labels such as "Undo agent: rename section".
- **Remote collaborators are untouched.** Providers apply remote updates with a non-null origin (typically the provider object). That origin is not in `trackedOrigins`, so remote edits never land on a local stack. (Inferred from the tracking rule; I did not fetch provider source in this pass.)
- **Undo after human edits.** If the human edits text inside a range the agent inserted, undoing the agent deletes only the agent's own items. The human's characters stay, which may leave fragments. This is a semantic limit, not a correctness bug.
- **History is not persisted.** Stacks are plain in-memory arrays of DeleteSets. Persisting undo across reloads would mean serialising DeleteSets plus `meta`, which the API does not support. Persisting the document itself (Yjs updates or snapshots) is the usual alternative.

### Gaps
- No primary doc on `MultiDocUndoManager` was fetched (it lives outside the `yjs` package per the warning).
- I did not verify which origin each provider (y-websocket, Hocuspocus, y-indexeddb) uses for applied updates. Check before relying on it.
- Whether the v14 beta changes `UndoManager` semantics was not checked.

## Immer: patches, inverse patches and undo/redo

### Takeaway
Immer has no undo manager. `produceWithPatches` returns `[nextState, patches, inversePatches]`, and `applyPatches(state, inversePatches)` reverts a change, so undo/redo is an app-level stack of patch pairs. An app can tag each entry by actor and concatenate several producers' patches into one agent unit. However, patch paths use array indices, and the patches are correct only against an equal base, so undoing an agent's change after a human has also edited the same arrays is not safe without a rebase.

### Cited Findings
- **Opt-in plugin.** "Since version 6 support for Patches has to be enabled explicitly by calling `enablePatches()` once when starting your application." — [Immer docs: Patches (v11.2.10 source)](https://github.com/immerjs/immer/blob/v11.2.10/website/docs/patches.mdx); live at [immerjs.github.io/immer/patches](https://immerjs.github.io/immer/patches)
- **Undo/redo is a named use case.** The docs list patches "As basis for undo/redo or as an approach to replay changes on a slightly different state tree". Their example applies `inverseChanges` after the server changed an unrelated field. The server's `name` change is kept and only the wizard's `age` change is reverted. — [patches.mdx](https://github.com/immerjs/immer/blob/v11.2.10/website/docs/patches.mdx)
- **Two ways to get patches.** The third argument to `produce` is a listener `(patches, inversePatches) => ...`. `produceWithPatches` has "the same signature as `produce`" but returns a tuple `[nextState, patches, inversePatches]`, and it supports currying. — [patches.mdx](https://github.com/immerjs/immer/blob/v11.2.10/website/docs/patches.mdx)
- **Patch format.** "Similar (but not the same) to the RFC-6902 JSON patch standard, except that the `path` property is an array"; ops are `replace`, `add` and `remove`, e.g. `{"op": "remove", "path": ["tags", 3]}`. — [patches.mdx](https://github.com/immerjs/immer/blob/v11.2.10/website/docs/patches.mdx)
- **Not minimal.** Patches "should be correct, that is, applying them to an equal base object should result in the same end state. However Immer does not guarantee the generated set of patches will be optimal". The docs point to a third-party article on compressing patches. — [patches.mdx](https://github.com/immerjs/immer/blob/v11.2.10/website/docs/patches.mdx); [Immer Pitfalls: "Immer patches are not necessarily optimal"](https://github.com/immerjs/immer/blob/v11.2.10/website/docs/pitfalls.md)
- **Array patches are positional.** `generateArrayPatches` compares base and copy index by index. It emits `replace` for each reassigned index that differs, `add` for indices past the base length, and `remove` from the end for the inverse. When the array shrank, it swaps base/copy and patches/inversePatches first. When the Array Methods plugin marks `allIndicesReassigned_`, every differing index is treated as reassigned. — [src/plugins/patches.ts v11.2.10, L180–245](https://github.com/immerjs/immer/blob/v11.2.10/src/plugins/patches.ts); [src/plugins/arrayMethods.ts](https://github.com/immerjs/immer/blob/v11.2.10/src/plugins/arrayMethods.ts)
- **Speed.** "Generating patches doesn't significantly slow down immer." — [Immer docs: Performance](https://github.com/immerjs/immer/blob/v11.2.10/website/docs/performance.mdx)
- **Version.** 11.2.10, published 2026-11-10. — [npm registry: immer](https://registry.npmjs.org/immer)

### Inferences
- **Size.** From the array code: removing or inserting near the front of an array of length *n* yields roughly *n* positional `replace` patches plus one `add` or `remove`, not one splice-style op. Agent edits on long lists therefore produce large patches, and the inverse of a front deletion stores every shifted element.
- **Actor separation is metadata only.** An app keeps `{actor, runId, patches, inversePatches}[]` and can undo the latest agent entry. If a human change landed after it and touched the same array, the agent's inverse patches target stale indices and may corrupt or revert the wrong element. Index-based paths do not commute the way Yjs item IDs do. Reliable undo of one actor's entry under interleaving needs one of three fixes: entity maps keyed by ID instead of arrays, rebasing the inverse over later patches (not provided by Immer), or refusing undo when later entries touch overlapping paths.
- **Grouping is easy.** Concatenate the `patches` of every producer in an agent run, and concatenate their `inversePatches` in reverse order. Or run the whole agent step inside one `produce` call.
- **Persistence is easy.** Patches are plain JSON (paths are arrays of strings and numbers), so history can be stored and replayed. Values containing Maps, Sets or class instances need custom serialisation (inferred).

### Gaps
- The compress-patches article linked from the docs is a third-party Medium post; I did not review it.
- I did not test whether `applyPatches` throws or silently misapplies on a stale index path.

## TanStack Query v5: optimistic updates and rollback

### Takeaway
TanStack Query has optimistic updates with rollback on server failure, not a user-facing undo history. In the cache approach, `onMutate` snapshots the query data, `setQueryData` writes the optimistic value, and `onError` restores the snapshot. In the UI approach, pending `variables` (read locally or through `useMutationState`) are rendered and simply disappear on error, so no rollback is needed. The rollback is a whole-key snapshot restore: an `onError` rollback overwrites everything written to that key since the snapshot, including other concurrent optimistic writes, unless the app guards against it.

### Cited Findings
- **Two approaches.** "You can either use the `onMutate` option to update your cache directly, or leverage the returned `variables` to update your UI from the `useMutation` result." — [Optimistic Updates guide (tag @tanstack/query-core@5.108.0)](https://github.com/TanStack/query/blob/%40tanstack/query-core%405.108.0/docs/framework/react/guides/optimistic-updates.md); live at [tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)
- **Via the UI.** The UI renders `variables` while `isPending`. When the mutation completes "the item will automatically no longer be rendered". "If the mutation errors, the item will also disappear", and "`variables` are _not_ cleared when the mutation errors", so a retry button can call `mutate(variables)`. The docs say to return the `invalidateQueries` promise from `onSettled` "so that the mutation stays in `pending` state until the refetch is finished". — [optimistic-updates.md](https://github.com/TanStack/query/blob/%40tanstack/query-core%405.108.0/docs/framework/react/guides/optimistic-updates.md)
- **Across components.** `useMutationState({ filters: { mutationKey: ['addTodo'], status: 'pending' }, select: (mutation) => mutation.state.variables })` returns an array "because there might be multiple mutations running at the same time"; `mutation.state.submittedAt` can serve as a unique key. — [optimistic-updates.md](https://github.com/TanStack/query/blob/%40tanstack/query-core%405.108.0/docs/framework/react/guides/optimistic-updates.md)
- **Via the cache.** `onMutate: async (newTodo, context) => { await context.client.cancelQueries(...); const previousTodos = context.client.getQueryData(['todos']); context.client.setQueryData(['todos'], old => [...old, newTodo]); return { previousTodos } }`, then `onError: (err, newTodo, onMutateResult, context) => context.client.setQueryData(['todos'], onMutateResult.previousTodos)` and `onSettled: ... invalidateQueries`. The guide explains that refetching is often enough to revert, and the explicit rollback is for cases where "refetching may not work correctly". — [optimistic-updates.md](https://github.com/TanStack/query/blob/%40tanstack/query-core%405.108.0/docs/framework/react/guides/optimistic-updates.md)
- **Callback signature.** `onMutate?: (variables: TVariables, context: MutationFunctionContext) => Promise<TOnMutateResult> | TOnMutateResult`. Mutation options also carry `meta?: MutationMeta` and `scope?: MutationScope`, and "Mutations sharing the same `scope.id` run serially, in the order they were started." — [packages/query-core/src/types.ts (5.108.0), ~L1833–1987](https://github.com/TanStack/query/blob/%40tanstack/query-core%405.108.0/packages/query-core/src/types.ts)
- **Mutation scopes.** "Per default, all mutations run in parallel"; mutations with the same `scope.id` start `isPaused: true` and are queued. — [Mutations guide: Mutation Scopes](https://github.com/TanStack/query/blob/%40tanstack/query-core%405.108.0/docs/framework/react/guides/mutations.md)
- **When to use which.** The variables approach "requires less code" and "you don't need to handle rollbacks at all". The cache approach updates every place on screen that reads the key. — [optimistic-updates.md](https://github.com/TanStack/query/blob/%40tanstack/query-core%405.108.0/docs/framework/react/guides/optimistic-updates.md)
- **Concurrency is out of scope for the guide.** For concurrent optimistic updates the guide defers to TkDodo's blog post "Concurrent Optimistic Updates" (secondary source, not reviewed here). — [optimistic-updates.md, Further reading](https://github.com/TanStack/query/blob/%40tanstack/query-core%405.108.0/docs/framework/react/guides/optimistic-updates.md)
- **Version.** 5.108.0, published 2026-11-17. — [npm registry: @tanstack/query-core](https://registry.npmjs.org/@tanstack/query-core)

### Inferences
- **What rolls back.** Only what the app's `onError` writes back. That is typically the whole query value under one key, restored from the snapshot. Other keys the `onMutate` touched must be snapshotted and restored by hand. Local component state, form state and side effects (navigation, toasts, other stores) are not rolled back.
- **Interleaved writes get clobbered.** If a human mutation and an agent mutation both optimistically write `['todos']`, and the agent's fails, restoring its `previousTodos` snapshot erases the human's later optimistic item until the refetch in `onSettled` repairs it. Three mitigations: `scope: { id }` to serialise, the variables approach (each pending mutation renders independently and needs no rollback), or an inverse transform in `onError` instead of a snapshot.
- **Tagging the agent.** `mutationKey` (e.g. `['agent', runId, ...]`) or `meta: { actor: 'agent', runId }` tags agent mutations. `useMutationState` with a filter on the key or predicate can show "agent pending" items differently. Undoing a successful agent mutation is not a TanStack feature: it needs a compensating mutation to the server.
- **Mutation cache is not an undo log.** It holds in-flight and recent mutations (persistable for offline use through the persister plugins), but it is not designed for that role. This is inferred and unverified in this pass.

### Gaps
- I did not verify the persister plugin's handling of paused mutations in 5.108.0.
- The `MutationFunctionContext` shape was not fully read. The guide shows `context.client`; check `types.ts` for other fields (e.g. `meta`, `mutationKey`).

## NgRx Store, NgRx SignalStore and other signal stores

### Takeaway
NgRx ships no undo. For the classic Store, ngrx-wieder (17.0.0, Immer-patch based) gives undo/redo with action allow-lists, merge rules, a `BREAK_MERGE` action and per-key segmentation (separate stacks). For SignalStore, `withUndoRedo` from `@angular-architects/ngrx-toolkit` 22.0.0 records whole snapshots of chosen keys on every synchronous state change (through `watchState`). It has no actor tagging or grouping, and its `maxStackSize` check is ineffective in the shipped code. Among the other stores, only mobx-state-tree's `UndoManager` does patch-based grouping with `withoutUndo`. The rest (zundo, redux-undo, valtio-history, jotai-history, Legend-State) are snapshot histories with pause, filter or group hooks.

### Cited Findings

**NgRx SignalStore and `watchState` (`@ngrx/signals` 22.0.1)**
- "functionalities such as state undo/redo require tracking all SignalStore's state changes without coalescing state updates in the same tick." `watchState(store, watcher)` "allows for synchronous tracking of SignalStore's state changes". In the docs example the watcher runs 3 times (initial value plus two increments) while an `effect` runs once. — [NgRx docs: State Tracking (tag 22.0.1)](https://github.com/ngrx/platform/blob/22.0.1/projects/www/src/app/pages/guide/signals/signal-store/state-tracking.md)

**`withUndoRedo` (`@angular-architects/ngrx-toolkit` 22.0.0)**
- **Options.** `maxStackSize` (default 100), `collections` (entity collections, expanded to `${c}EntityMap`, `${c}Ids`, `selected${C}Ids`, `${c}Filter`), `keys` (default `[]`) and `skip` (default 0). The store gains `canUndo`, `canRedo`, `undo()`, `redo()` and `clearUndoRedo(store, { lastRecord? })`. — [docs: withUndoRedo](https://github.com/angular-architects/ngrx-toolkit/blob/main/docs/docs/with-undo-redo.md); [with-undo-redo.ts (main)](https://github.com/angular-architects/ngrx-toolkit/blob/main/libs/ngrx-toolkit/src/lib/undo-redo/with-undo-redo.ts)
- **Mechanism.** In `onInit`, a `watchState` watcher builds a snapshot `cand` of the tracked keys after every state change. It skips the change after its own undo/redo (`skipOnce`) and skips duplicates by `JSON.stringify` equality. Otherwise it clears `redoStack` and pushes the previous `lastRecord` onto `undoStack`. `undo()` applies the popped snapshot with `patchState(store, item)`. The stacks are closure variables, and the source says "This feature has its own internal state." — [with-undo-redo.ts](https://github.com/angular-architects/ngrx-toolkit/blob/main/libs/ngrx-toolkit/src/lib/undo-redo/with-undo-redo.ts)
- **`maxStackSize` is not enforced (code reading).** The limit check reads `if (redoStack.length > normalized.maxStackSize) { undoStack.unshift(); }`. It runs right after `redoStack.splice(0)`, so the condition is always false, and `unshift()` with no arguments removes nothing anyway. The same code ships in the npm 22.0.0 build (`fesm2022/angular-architects-ngrx-toolkit.mjs` L1166–1167). — [with-undo-redo.ts](https://github.com/angular-architects/ngrx-toolkit/blob/main/libs/ngrx-toolkit/src/lib/undo-redo/with-undo-redo.ts); [npm tarball 22.0.0](https://registry.npmjs.org/@angular-architects/ngrx-toolkit)
- **Docs import path is wrong.** The docs page imports from `'@ngrx-toolkit/core'`, but the package is `@angular-architects/ngrx-toolkit`, and its 22.0.0 build exports `withUndoRedo` and `clearUndoRedo`. — [with-undo-redo.md](https://github.com/angular-architects/ngrx-toolkit/blob/main/docs/docs/with-undo-redo.md); [npm 22.0.0 package.json/exports](https://registry.npmjs.org/@angular-architects/ngrx-toolkit)

**ngrx-wieder 17.0.0 (NgRx Store)**
- **Mechanism.** "based on immer", and it "works by recording patches from immer and applying them based on dispatch of actions for perfoming undo and redo". Reducers are made with `createUndoRedoReducer` (or by wrapping a switch reducer with `wrapReducer`, which is a meta-reducer). Undo and redo are dispatched as `{ type: "UNDO" }` and `{ type: "REDO" }`. — [ngrx-wieder README](https://github.com/nilsmehlhorn/ngrx-wieder/blob/master/README.md)
- **Config.** `allowedActionTypes` ("leave empty to allow all actions"), `mergeActionTypes`, `mergeRules` (per-action-type predicates), `maxBufferSize` (default 32), `breakMergeActionType` (`'BREAK_MERGE'`), `clearActionType`, `trackActionPayload`, and `segmentationOverride: (action) => key`. — [README: Configuration](https://github.com/nilsmehlhorn/ngrx-wieder/blob/master/README.md)
- **Segmentation.** "provides distinct undo-redo stacks for multiple instances of the same kind of state", through `createSegmentedUndoRedoReducer(initialState, segmenter, ...)`. "Any actions that change the result of the segmenter must not be undoable." — [README: Segmentation](https://github.com/nilsmehlhorn/ngrx-wieder/blob/master/README.md)
- **History selectors.** `createHistorySelectors` gives `selectHistory`, `selectCanUndo` and `selectCanRedo`. The history lives in the NgRx state (`UndoRedoState`). — [README: History Selectors](https://github.com/nilsmehlhorn/ngrx-wieder/blob/master/README.md)

**zundo 2.3.0 (Zustand)**
- **Options and API.** Options: `partialize`, `limit`, `equality`, `diff` (store deltas; returning `null` skips the change), `onSave`, `handleSet` (wrap the setter, e.g. to throttle or debounce), `pastStates`/`futureStates` (initial history) and `wrapTemporal`. The temporal API has `undo(steps?)`, `redo(steps?)`, `clear()`, `isTracking`, `pause()`, `resume()` and `setOnSave`. — [zundo README](https://github.com/charkour/zundo/blob/main/README.md)

**redux-undo 1.1.0**
- **Status and options.** The README carries "⚠️ Project Status: Not Actively Maintained". Options include `limit`, `filter` (`includeAction`/`excludeAction`, or custom `(action, currentState, previousHistory)`), `groupBy` (`groupByActionTypes`, or a custom function returning a group key), `clearHistoryType`, `ignoreInitialState` and `syncFilter`. — [redux-undo README](https://github.com/omnidan/redux-undo/blob/master/README.md)

**valtio-history 1.1.3**
- **Moved out of core and snapshot-based.** `proxyWithHistory` moved from `valtio/utils` to `valtio-history`. History is `history.nodes` of `{ snapshot, createdAt, updatedAt? }`. The API includes `undo`, `redo`, `isUndoEnabled`, `isRedoEnabled`, `remove(index)`, `replace(index, snapshot)`, `saveHistory()`, `shouldSaveHistory(ops)` and `subscribe()`, plus an option `{ skipSubscribe?: boolean }` for manual saving. — [valtio-history README](https://github.com/valtiojs/valtio-history/blob/main/packages/history-utility/README.md); [API docs](https://github.com/valtiojs/valtio-history/blob/main/packages/history-utility/docs/modules.md)

**jotai-history 0.6.0**
- **Snapshot history per atom.** `withHistory(targetAtom, limit)` returns states "most recent first" plus `canUndo`/`canRedo`. It is driven by writing the `UNDO`, `REDO` and `RESET` symbols. "Be mindful of memory usage by setting a reasonable `limit`." (The task's `atomWithUndo` name was not found in this package's README; `withHistory` is the current API.) — [jotai-history README](https://github.com/jotaijs/jotai-history/blob/main/README.md)

**Legend-State 2.1.15**
- **Snapshot history per observable.** `undoRedo(obs$, { limit? })` returns `undo`, `redo`, `undos$`, `redos$` and `getHistory()`. "If you don't pass in a limit, it will keep all history." `trackHistory(obs, target?)` records `Partial<T>` changes keyed by timestamp string. Both are exported from `@legendapp/state/history`. — [npm tarball @legendapp/state 2.1.15: src/history/undoRedo.d.ts, trackHistory.d.ts](https://registry.npmjs.org/@legendapp/state)

**mobx-state-tree `UndoManager` (mst-middlewares 6.1.0)**
- **Patch-based with grouping and exclusion.** It "records patches for actions / processes, not snapshots". "An undo state is only comitted to the history if the action / process is finished", "Failing processes do not add an undo state", and "Multiple concurrent processes only undo their own changes and don't touch the changes caused by other actions - unlike snapshots would." The API covers `history: { patches, inversePatches }[]`, `withoutUndo(fn)`, `withoutUndoFlow(fn*)`, `startGroup(fn)`/`stopGroup()` ("all patches within a group are saved as one history entry"), `clear()`, and the `maxHistoryLength` and `includeHooks` options. — [mst-middlewares README](https://github.com/coolsoftwaretyler/mst-middlewares/blob/main/README.md) (repo per [npm registry](https://registry.npmjs.org/mst-middlewares))

### Inferences
- **`withUndoRedo` cannot tell actors apart.** It snapshots every change to the tracked keys whoever made it, with no origin, pause or group API. An agent's multi-step action becomes several undo steps (one per `patchState`). Undoing restores a whole snapshot of the tracked keys, which also reverts any human change made between steps. To separate actors, put agent-editable state in a separate store or feature with its own `withUndoRedo`, or write a custom feature on `watchState` that reads an "actor" flag set around agent calls. The stacks sit in closures and cannot be persisted.
- **ngrx-wieder gets closest among Redux-style tools.** `segmentationOverride` could route agent actions to an "agent" stack key and human actions to another. `mergeActionTypes` plus `BREAK_MERGE` can merge an agent run into one entry. Because it replays Immer patches, the Immer caveat applies: an agent-stack undo after later human edits on the same arrays can misapply. Its history is in the store, so it could be persisted with the store (inferred).
- **Snapshot libraries cannot undo one actor selectively.** Restoring a past snapshot reverts everything since then. They can approximate "group the agent run" with `pause()`/`resume()` (zundo), `groupBy` (redux-undo) or `skipSubscribe` + `saveHistory()` (valtio-history): pause during the run, then save one entry. They cannot remove the agent's run alone once a human has edited afterwards.
- **MST `UndoManager` comes nearest to Yjs** for non-CRDT state. `startGroup` covers grouping, `withoutUndo` excludes one actor (e.g. run human edits outside a separate agent UndoManager), and concurrent processes undo only their own patches. MST patches are JSON-patch with path strings, so the stale-index risk on arrays likely applies too (inferred, not verified).

### Gaps
- I could not fetch the ngrx-toolkit source at tag 22.0.0 (GitHub tag names did not resolve). The `main` source was checked against the npm 22.0.0 build for the `maxStackSize` lines only.
- Legend-State v3 (beta) docs were not reachable at the URLs tried (404), so v3 history helpers are unverified.
- MobX itself and Valtio core have no built-in undo beyond these utilities. I did not find an official Angular-signals-level undo API.

## Comparison: tag by actor, undo one actor only, group an agent action, persist history

### Takeaway
Only Yjs gives true per-actor selective undo that is safe under interleaving, through origins and ID-based inverse ops. Patch-based tools (Immer, ngrx-wieder, MST) can tag and group, but their inverse patches are positional, so undoing one actor after another actor's overlapping edits is unsafe. Snapshot tools (ngrx-toolkit `withUndoRedo`, zundo, redux-undo, valtio-history, jotai-history, Legend-State) cannot undo one actor without reverting the other. TanStack Query only rolls back failed optimistic writes; undoing a successful server write needs a compensating mutation.

### Cited Findings
(Each cell summarises findings cited in the sections above; "app" means the library offers a hook but the app must build the feature.)

| Library (version) | Mechanism | Tag change by actor | Undo one actor only | Group multi-step agent action | Persist history |
|---|---|---|---|---|---|
| Yjs `UndoManager` (13.6.33) | Inverse ops on CRDT item IDs (DeleteSets) | Yes: transaction `origin` + `trackedOrigins` | Yes: one manager per origin, and remote changes are never overwritten by default | Yes: `captureTimeout` merge + `stopCapturing()`; label through `stackItem.meta` | No (stacks are in memory) |
| Immer patches (11.2.10) | `produceWithPatches` / `applyPatches(inversePatches)` | App (metadata on stack entries) | Partial: unsafe if later edits shifted the same array indices | App: concatenate patches, or use one `produce` | App: patches are JSON |
| TanStack Query (5.108.0) | Snapshot in `onMutate`, restore in `onError`; or render pending `variables` | `mutationKey` / `meta` | Rollback is per key and clobbers concurrent optimistic writes; the UI-variables approach avoids this | `scope.id` serialises; no undo-unit concept | Mutation cache only; no undo log |
| ngrx-wieder (17.0.0) on NgRx Store (22.0.1) | Immer patches in a meta-reducer | By action type / `segmentationOverride` key | Partial: separate segment stacks, with the Immer index caveat | `mergeActionTypes` / `mergeRules` + `BREAK_MERGE` | History in store state |
| ngrx-toolkit `withUndoRedo` (22.0.0) on SignalStore | Snapshots of chosen keys via `watchState` | No | No (whole-snapshot restore) | No (one entry per state change) | No (closure state); `maxStackSize` not enforced |
| zundo (2.3.0) | Snapshots or `diff` deltas | No (`pause`/`resume` only) | No | `pause()` + `resume()`, `handleSet` throttle | App (`pastStates` initial option) |
| redux-undo (1.1.0, unmaintained) | Snapshots | Via `filter` | No | `groupBy` | History in store state |
| valtio-history (1.1.3) | Snapshots (`history.nodes`) | No | No | `skipSubscribe` + `saveHistory()` | App |
| jotai-history (0.6.0) | Snapshots per atom | No | No | No | No |
| Legend-State (2.1.15) | Snapshots per observable | No | No | No | `trackHistory` to an observable (app) |
| MST `UndoManager` (mst-middlewares 6.1.0) | Patches per action/process | `withoutUndo` scoping | Partial: concurrent processes undo only their own patches (documented), with likely positional caveats | `startGroup`/`stopGroup`; async flows commit on completion | `history` is MST state (app) |

### Inferences
- **Recommended shape for agent edits in a collaborative document.** Model the editable surface in Yjs. Give the agent its own origin object and `UndoManager`, bracket each agent turn with `stopCapturing()`, and store the run ID in `stackItem.meta`. Keep TanStack Query for server-confirmed side effects. On a failed agent tool call, use the UI-variables approach, or roll back through a Yjs undo rather than a cache snapshot.
- **For non-CRDT app state** (NgRx, Zustand and similar), the safest pattern is to keep agent-editable state keyed by entity ID (not arrays), record Immer or MST patches per agent turn as one entry, and refuse or warn on "undo agent turn" when a later human entry touched overlapping paths.

### Gaps
- None of these libraries documents an "undo actor X" API apart from Yjs `trackedOrigins`. The table's "Partial" verdicts come from code reading, not tests. A runnable check (e.g. two-manager Yjs test, Immer stale-index test) would turn them into **[verified]** claims.
