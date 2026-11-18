# W1: `@agent-speak/coding-agent` package and its task model

| Field | Value |
| --- | --- |
| ID | `W1` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [N1](N1-harness-workspace-scaffold.md) |
| Size | S |

## Goal

Create the coding agent's package and the task model every later todo uses: a task id, a repository, a trigger, a branch name and a status.

## Context

- [Build coding agent plan](../../plans/build-coding-agent.md): the architecture.

## Scope

**In scope**

- Package scaffold, `private: true`, licence fields
- The `Task` type and its status union

**Out of scope**

- Runner, control plane and delivery (W4–W6)

## Tasks

- [ ] Scaffold the package beside the harness packages
- [ ] Define `Task` with a stable id used for deduplication
- [ ] Add the package to CI

## Acceptance criteria

- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

Type tests for the task model.

## Docs to update

README of the package; AGENTS.md layout.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
