# N30: CLI: one-shot JSON mode, line-mode chat, and `sessions` list, show, search and replay

| Field | Value |
| --- | --- |
| ID | `N30` |
| Status | `done` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-puts-the-protocol-its-transports-and-the-cli-over-the-harness) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N28](../done/N28-server-requests-backpressure.md) |
| Size | M |

## Goal

Ship `buildanagent` as a client of the in-process transport: a one-shot JSONL mode for scripts, a line-mode chat with approvals, and the search and replay commands practitioners ask for, with nothing leaving the machine by default.

## Context

- [harness guide §8](../../guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport): the CLI as a client of the core
- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): search and replay CLI
- [harness guide §9](../../guides/agent-harness.md#9-telemetry-should-be-a-projection-of-the-log-with-content-off-by-default-and-cost-recorded-on-every-entry): running cost, preamble size, nothing outward by default

## Scope

**In scope**

- `buildanagent run <prompt> [--json]`: JSONL events on stdout
- `buildanagent chat`: line mode with approval prompts, grouped calls and chained commands shown normalised
- `buildanagent rpc`, which mounts the stdio transport N29 built, `resume <session>`, `sessions list|show|search|replay`, `session unlock --force`, `keys rotate|prune`
- Preamble size at session start; context fill and running cost with the 80% warning
- Optional `--otlp-endpoint`; no update check and no commit attribution

**Out of scope** (and which todo covers it)

- A full-screen TUI (non-goal)

## Tasks

- [x] Test the CLI through its in-process transport with a scripted model; spawn the binary only in the smoke test, with `spawnEnv`.

## Acceptance criteria

- [x] `buildanagent run --json` prints one JSON object per line and exits 0 on `done`
- [x] `sessions search <text>` finds a message in a recorded session
- [x] `sessions replay` plays a session back with zero model calls
- [x] With no flags, the CLI opens no outbound connection (guarded `fetch`)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/cli/test/*.test.ts`.

## Docs to update

`packages/cli/README.md`: every command. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Line-mode approval UX may be rough; the protocol keeps it replaceable.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- `buildanagent` runs `run`, `chat`, `resume`, `sessions list|show|search|replay`, `keys rotate|prune`, `session unlock --force` and `rpc` over the harness's in-process and stdio transports, with a scripted model in every test and one spawn smoke test.
- `--budget` caps each turn and each resume, not the session, because `turn/start` takes no budget; the README and help say so. The binary has no built-in tools until N21, and a `client_request` tool gets a tool error, since the CLI runs no client tools.
- Known limit: if `approval/list` reads the log after a resume appends an answer but before its event arrives, the answer is dropped and a later settle is discarded.
- The first code-review round found 10 findings (nine fixed; the tenth, the todo's place, was resolved by moving it after `rpc` landed).
