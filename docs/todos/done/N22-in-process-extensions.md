# N22: In-process extensions: composition, project trust and content-hash pins

| Field | Value |
| --- | --- |
| ID | `N22` |
| Status | `done` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N11](../done/N11-tool-registry.md), [N12](../done/N12-permission-pipeline.md) |
| Size | M |

## Goal

Let TypeScript extensions add interceptors, observers and tools under declared composition rules, and load project-supplied ones only in a trusted project with a matching content hash.

## Context

- [harness guide §7](../../guides/agent-harness.md#7-extensions-come-in-three-trust-tiers-and-project-trust-gates-loading-not-execution): tiers, composition, trust gates loading, pinning
- [build-harness.md §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): the API sketch

## Scope

**In scope**

- `Extension`, `composeExtensions()` with the composition rules of §3.5
- `TrustStore` (a file of trusted project roots) and `loadProjectExtensions()`
- `extensions.lock.json` with a SHA-256 per extension; a mismatch refuses the load
- Headless and untrusted: skip with a notice
- `extension_loaded` entries

**Out of scope** (and which todo covers it)

- Skills (N23)
- MCP servers (N24), and pinning MCP tool definitions, which N25 owns on this lock file's format

## Tasks

- [x] Hash every file in the extension's directory in sorted order.
- [x] Write the docs sentence that trust is not a sandbox.

## Acceptance criteria

- [x] Two extensions' `beforeToolCall`: one denying and one allowing yields deny; any ask yields ask
- [x] Two `transformContext` extensions chain in registration order
- [x] An untrusted project's extension does not load, and a trusted one with a changed file is refused
- [x] Headless runs skip project extensions by default
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/extensions/compose.test.ts`, `trust.test.ts`, `lock.test.ts`.

## Docs to update

`packages/harness/README.md`: writing an extension. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/harness/extensions` holds `Extension`, `composeExtensions()`, `registerExtensionTools()`, `recordsOf()` and `memoryTrustStore()`; the Node-only `@buildanagent/harness/extensions/node` holds `fileTrustStore()`, `hashExtensionDir()`, `loadProjectExtensions()` and `pinProjectExtensions()`. 20 tests in `test/extensions/` cover the acceptance criteria.

- **Composition.** `composeExtensions()` delegates to the SDK's `composeInterceptors()`, whose rules already are the plan's: the first deny wins and an ask beats an allow on `beforeToolCall`, `transformContext` chains in order, any stop wins on `shouldStop`. The extension adds name checks and the observers list.
- **Loading.** `loadProjectExtensions(root, { trust, headless })` returns `{ extensions, records, notices }`, not the planned `Extension[]`, so the caller can show why a load was skipped and write the `extension_loaded` records. A project's extensions live in `.agents/extensions/<folder>/index.mjs`, and the lock file is `.agents/extensions.lock.json`.
- **Headless.** A headless run skips project extensions even in a trusted project unless `loadInHeadless` is set; an untrusted project never loads.
- **Pins.** The folder hash covers every file in sorted order, each by its relative path and its own SHA-256. With a lock file present, a changed, added, removed or unlisted extension is refused with `extension_hash_mismatch` and none of the project's extensions load; with none, they load and a notice says they are unpinned. `pinProjectExtensions()` writes the lock, which is the act a person performs.
- **Log.** `HarnessOptions.extensionRecords` makes a turn write an `extension_loaded` entry for each record the log does not hold yet. For an extension written in code, `recordsOf()` hashes its name and version.
- **Trust is not a sandbox.** The README says so in its first paragraph on extensions.
- **Not done, left to later todos.** Skills (N23) and MCP servers (N24); N25 owns pinning MCP tool definitions on this lock file's format. The module is imported after it is hashed, so a file changed between the two is not caught.
- **Review fixes.** Every folder is hashed and checked before any is imported, so a refusal runs none of the project's code, and a pinned folder that is gone is refused. A symlink or special file in an extension folder is refused, because an import would follow it. A folder that changed after the process loaded it is refused until restart, because Node caches modules. A tools-only extension no longer turns another's `onFailure: "continue"` back into fail-closed. The trust store compares real paths. Corrupt lock and trust files are `invalid_extension`, and writes create their folder and clean up their temp file. The README says what the pin does not cover (imports that leave the folder) and that the lock file sits inside the project it pins.
