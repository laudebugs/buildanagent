# W2: Git tools, repository checkout and the completion check

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `W2` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [N21](N21-builtin-tools.md), [N32](../done/N32-completion-check.md) |
| Size | M |

## Goal

Give the agent the tools a coding task needs, configured as one permission profile: the built-in tools, git commands through the sandbox, a checkout step and the repository's own test command as the completion check.

## Context

- [ADR 0036](../../decisions/0036-loop-outside-sandbox-and-pr-approval.md): commands run without prompts inside the sandbox's bounds.

## Scope

**In scope**

- Checkout into the sandbox
- `git` status, diff, add and commit as tools
- A permission profile that allows commands in the sandbox and asks for anything outside it
- The completion check runs the repository's configured test command

**Out of scope**

- Pushing (W3, W6)

## Tasks

- [ ] Add the tools on top of N21
- [ ] Write the profile with HD12's modes
- [ ] Wire the completion check (N32) to a per-repository command

## Acceptance criteria

- [ ] A scripted-model test edits a fixture repository and passes its tests in `fakeSandbox()` (harness plan §5.1)
- [ ] No tool touches the host outside the temp directory

## Tests

Offline fixture-repository test on the scripted model.

## Docs to update

Plan §3.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
