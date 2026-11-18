# X1: CI workflows for the checks and the scheduled verify

| Field | Value |
| --- | --- |
| ID | `X1` |
| Status | `ready` |
| Plan | [CI §3](../../plans/ci.md#3-the-workflows) |
| Round / milestone | Round X (CI) |
| Depends on | None |
| Size | S |

## Goal

Add `.github/workflows/ci.yml` for the local checks on every push, and `verify.yml` for a nightly and on-demand full verify.

## Context

- The [CI plan](../../plans/ci.md)
- The measured timings in its §2

## Scope

**In scope**

- Two workflows with a cached pnpm store

**Out of scope** (and which todo covers it)

- Live API runs

## Tasks

- [ ] Write `ci.yml`: checkout, Node 22, corepack pnpm, cached install, `pnpm check`, `pnpm typecheck`, `pnpm test`
- [ ] Write `verify.yml`: schedule and `workflow_dispatch`, fetch-docs for gitignored mirrors, `pnpm verify`, fail on result drift
- [ ] Push; if the token lacks workflow permission, hand the files to the owner
- [ ] Watch the first runs and fix what differs from local

## Acceptance criteria

- [ ] Both workflows run green on `main`
- [ ] A run takes under 3 minutes

## Tests

The workflows themselves.

## Docs to update

README Development section; the CI plan.

## Risks and open questions

Workflow permission on this session's token.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
