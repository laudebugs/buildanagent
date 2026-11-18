# N19: Measure `srt` and Docker cold start and per-call overhead (HD4)

| Field | Value |
| --- | --- |
| ID | `N19` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-sandbox-and-credentials) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N16](N16-srt-backend.md), [N17](N17-docker-backend.md) |
| Size | S |

## Goal

Measure what the guide says nobody has measured on our hardware, so the owner can confirm or change HD4's sandbox defaults.

## Context

- [HD4](../../plans/build-harness.md#hd4-srt-for-interactive-runs-and-docker-for-headless-runs-owner-to-confirm): the decision and its evidence
- [ADR 0020](../../decisions/0020-default-sandbox-backend.md): the decision records
- [harness guide §6](../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both): cold-start evidence is partly secondary

## Scope

**In scope**

- A script `packages/harness/scripts/measure-sandbox.mjs` that provisions each backend 20 times and runs `true` and a 10 MB file write 50 times
- Median and p95 cold start and per-call overhead, with host OS, CPU and versions
- A results note in `packages/harness/results/sandbox-overhead.md`

**Out of scope** (and which todo covers it)

- Changing the default (the owner, through ADR 0020)

## Tasks

- [ ] Run on at least one Linux host; add macOS if available.
- [ ] Present the numbers to the owner with HD4's choice.

## Acceptance criteria

- [ ] The results note lists median and p95 for both backends on at least one host, with versions
- [ ] ADR 0020's status line records the owner's answer or still says owner to confirm
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The script itself; not part of `pnpm test`.

## Docs to update

ADR 0020 (status only), `packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Numbers from shared CI runners are noisy; prefer a dedicated host.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
