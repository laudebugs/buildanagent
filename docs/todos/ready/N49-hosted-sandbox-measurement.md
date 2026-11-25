# N49: Measure cold start, snapshot and per-call overhead on the hosted backends

| Field | Value |
| --- | --- |
| ID | `N49` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N46b](N46b-cloudflare-sandbox-backend.md), [N47b](../done/N47b-e2b-sandbox-backend.md), [N48b](../done/N48b-vercel-sandbox-backend.md), [N19](N19-sandbox-measurement.md) |
| Size | S |

## Goal

Measure what no vendor publishes: how long each hosted sandbox takes to start, to snapshot and to run one command, beside N19's local numbers (U11 change 15).

## Context

- [Harness plan, N19](N19-sandbox-measurement.md): the local measurement this extends.

## Scope

**In scope**

- A measurement script and a results file for Cloudflare Sandbox, E2B and Vercel Sandbox

**Out of scope**

- Snapshot-cache design (W11)

## Tasks

- [ ] Reuse N19's script with each hosted backend
- [ ] Run 20 samples per backend on the owner's accounts
- [ ] Commit the results with the pinned versions and the date

## Acceptance criteria

- [ ] A committed results file with p50 and p95 per backend
- [ ] A recommendation on whether Cloudflare Sandbox stays primary (CA3)

## Tests

The measurement script; it never runs in CI.

## Docs to update

Build-coding-agent plan CA3 and CA8 with the numbers.

## Risks and open questions

Live runs cost money; keep samples small.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
