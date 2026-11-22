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

`@buildanagent/harness/extensions` holds `Extension`, `composeExtensions()`, `registerExtensionTools()`, `recordsOf()` and `memoryTrustStore()`. The Node-only `@buildanagent/harness/extensions/node` holds `fileTrustStore()`, `hashExtensionDir()`, `loadProjectExtensions()` and `pinProjectExtensions()`. 37 tests in `test/extensions/` cover the acceptance criteria and the review fixes.

- **Composition.** `composeExtensions()` delegates to the SDK's `composeInterceptors()`, whose rules already are the plan's: the first deny wins and an ask beats an allow on `beforeToolCall`, `transformContext` chains in order, and any stop wins on `shouldStop`. The extension layer adds name checks and the observers list. Tools-only extensions compose to an empty set, so they no longer turn another extension's `onFailure: "continue"` back into fail-closed. Registering tools is atomic.
- **Loading.** `loadProjectExtensions(root, { trust, headless })` returns `{ extensions, records, notices }`, not the planned `Extension[]`, so the caller can show why a load was skipped and write the `extension_loaded` records. A project's extensions live in `.agents/extensions/<folder>/index.mjs`, and the lock file is `.agents/extensions.lock.json`. The loader reads no file of a project before it has decided trust and headless, and an untrusted project with a corrupt lock file loads nothing and says why. The loader shape-checks each export (`invalid_extension`).
- **Headless.** A headless run skips project extensions even in a trusted project unless `loadInHeadless` is set. An untrusted project never loads.
- **Pins.** The folder hash covers every file in sorted order, each by its relative path and its own SHA-256. With a lock file present, the loader refuses a changed, added, removed or unlisted extension with `extension_hash_mismatch`, and none of the project's extensions load. Without one, they load and a notice says they are unpinned. `pinProjectExtensions()` writes the lock; a person runs it.
- **Imports.** The loader hashes and checks every folder before it imports any, so a refusal runs none of the project's code. Node caches modules for the life of a process, so a folder that changed after the process imported it is refused until restart, keyed by real path. A symlinked extension folder, or a symlink or special file inside one, is refused, because an import would follow it.
- **Stores and files.** The trust store compares real paths. Corrupt lock and trust files raise `invalid_extension`. Writes create their folder and remove their temp file on failure. The file trust store serialises writes within a process, creates its folder 0700 and refuses a file that others may write.
- **Log.** `HarnessOptions.extensionRecords` makes a turn write an `extension_loaded` entry for each record whose name and hash the log does not hold yet. For an extension written in code, `recordsOf()` hashes its name and version.
- **Trust is not a sandbox.** The README says so in its first paragraph on extensions. It also says what the pin leaves uncovered (imports that leave the folder) and that the lock file sits inside the project it pins.
- **Not done, left to later todos.** Skills (N23) and MCP servers (N24); N25 owns pinning MCP tool definitions on this lock file's format. The loader imports a module after it hashes it, so a file changed between the two steps goes unnoticed.
