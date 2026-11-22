# N21: Built-in tools: `read`, `write`, `edit`, `bash`, `fetch` and the read-only `grep` and `glob` through the sandbox

| Field | Value |
| --- | --- |
| ID | `N21` |
| Status | `done` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-adds-the-sandbox-backends-and-the-credential-proxy) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N11](../done/N11-tool-registry.md), [N15](../done/N15-sandbox-interface.md), [N20](../done/N20-credential-proxy.md), [N8](../done/N8-write-cap-masking.md) |
| Size | M |

## Goal

Ship the small built-in tool set the eval baseline needs, each running only through a `Sandbox` or the egress proxy, each result passing the write cap.

**Scope change (owner, 2026-11-19).** The [retrieval and memory report](../../research/memory/retrieval-and-memory.md) proposed twelve plan changes, and the owner approved all twelve on 2026-11-19. Change 6 adds read-only `grep` and `glob` built-ins to this todo. Code search and memory search (HD17, N52) then need no `bash`, so they still work in a session whose host leaves `bash` out. Three of our eight SDKs ship dedicated search built-ins: Claude's `Grep` and `Glob`, Pi's `grep` and `find`, and Copilot's `grep` and `glob` ([retrieval and memory report](../../research/memory/retrieval-and-memory.md#all-eight-sdks-retrieve-through-tools-six-ship-long-term-memory-and-none-expires-it-in-the-process)).

## Context

- [Retrieval and memory report](../../research/memory/retrieval-and-memory.md#start-with-keyword-search-and-add-vectors-only-after-a-measured-miss): keyword search first, with the agent's ordinary file tools
- [harness guide §4](../../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension): every tool passes the pipeline and the write cap
- [AGENTS.md planned architecture](../../../AGENTS.md#planned-architecture-when-code-starts): a small set of well-designed tools
- [build-harness.md §5.1](../../plans/build-harness.md#51-every-test-runs-offline-on-the-sdks-scripted-model-and-no-test-touches-the-host): host tools only against the fake in tests

## Scope

**In scope**

- `builtinTools(sandbox, proxy)` returning `read`, `write`, `edit`, `bash`, `fetch`, `grep` and `glob` as `RegisteredTool`s
- `read` that can open spill files by path
- `edit` as exact string replacement with a unique-match rule
- `bash` with a timeout and output through the write cap
- `fetch` through `EgressProxy.fetch` only
- `grep` (a pattern over file contents, with an optional path and file glob) and `glob` (file paths matching a pattern), both read-only, run through the sandbox, with results through the write cap
- Path checks against `writeRoots` before calling the sandbox

**Out of scope** (and which todo covers it)

- Semantic or vector search: none, until an eval shows keyword search missing ([retrieval and memory report](../../research/memory/retrieval-and-memory.md#start-with-keyword-search-and-add-vectors-only-after-a-measured-miss))

## Tasks

- [x] Run every test of `write`, `edit` and `bash` against `fakeSandbox()`.
- [x] Mark `read`, `fetch`, `grep` and `glob` `firstParty` read-only for scheduling.
- [x] Check every `grep` and `glob` path against the sandbox policy's `readRoots` before calling the sandbox.

## Acceptance criteria

- [x] With `fakeSandbox()`, a scripted model's `bash` call records the command and touches no host file
- [x] `edit` with two matches returns an error result and changes nothing
- [x] A `fetch` to a non-allowlisted host returns an error result
- [x] `read` of a spill path returns the full output
- [x] With `fakeSandbox()`, `grep` finds a pattern in a seeded file and `glob` lists matching paths, and neither writes a file
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/tools/builtins.test.ts`.

## Docs to update

`packages/harness/README.md`: each tool's contract. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Tool descriptions affect model behaviour; version them and let N39 compare.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- `builtinTools(sandbox, proxy, options)` from `@buildanagent/harness/tools` returns `read`, `write`, `edit`, `bash`, `grep`, `glob` and, when a proxy is given, `fetch`. It takes a third argument the plan lacked, `{ root, policy, env?, spills? }`, because the `Sandbox` interface reports neither the workspace root nor the policy.
- Every path is checked as text against the policy's roots before any sandbox call; the backends' real-path check is the second line against symlinks. On `noneSandbox()` there is no second line.
- `grep` and `glob` run inside the sandbox through `find` and `grep`, so the model's regular expression never runs in the host loop. `fetch` is https only, goes only through the egress proxy and scrubs every known secret from its output.
- Open for the owner, each with what happens today:
  1. Whether `read`, `bash`, `grep` and `glob` should mark their output `untrusted` like `fetch`, since a workspace file or a command's output can carry instructions as a web page can. Today only `fetch`'s is `untrusted`.
  2. Whether tools may bind to a `none` sandbox. Today nothing prevents it, and a symlink is followed there (row N21-13).
  3. Whether `bash` output is also scrubbed of known secrets. Today only `fetch`'s is.
  4. Whether the shared `workspace` resource key, which makes writes to different files wait for each other, is acceptable. Today every file and search tool returns it.
  5. Whether `BUILTIN_TOOLS_HASH` goes into a session entry (N39 or N34). Today no entry records it.
- Next: N39 compares description versions; N34 decides whether to record the hash.
