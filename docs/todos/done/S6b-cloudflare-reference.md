# S6b: Cloudflare Agents

| Field | Value |
| --- | --- |
| ID | `S6b` |
| Status | `done` |
| Plan | [SDK references §4](../../plans/sdk-references.md#4-the-eight-sdks) |
| Round / milestone | M2c (added 2026-11-18) |
| Depends on | [S6a](../done/S6a-cloudflare-verify.md) |
| Size | S6a-cloudflare-verify:M |

## Goal

Cloudflare Agents, following the eight-step SDK process in [AGENTS.md](../../../AGENTS.md#process-for-documenting-an-sdk) and the plan's S6/S7 notes, including the language policy (TypeScript references with a parity check against the SDK's primary language).

## Context

- The [SDK references plan](../../plans/sdk-references.md), sections S6, S7 and the language policy
- The five finished references as the structure to mirror

## Scope

**In scope**

- As named in the title; see the plan section for packages, docs, test model and behaviors

**Out of scope** (and which todo covers it)

- Deployment to the vendor's platform; primary-language harnesses (the parity check reads their docs only)

## Tasks

- [x] Do the work the title names, following the plan section
- [x] Draft any prose with `/anthropic-skills:writing` and review it with `/anthropic-skills:writing-review`
- [x] Run the local checks and push

## Acceptance criteria

- [x] The deliverables named in the plan exist and pass review
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

The SDK harness's behavioral examples, where the todo has a harness.

## Docs to update

Root README; the relevant plan.

## Risks and open questions

Cloudflare needs the Workers runtime locally (workerd); Google's TypeScript ADK lags its Python primary. Record both in the fact-checks.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- `guide.md`, `fact-check.md` and `README.md` written with the writing skill, reviewed with the review skill and fixed. Rubric for both: coherence 4→5, concision 4→5, cadence 3→4.
- All 18 draft findings were re-verified before writing:
  - Five changed. F5 (`never` stub types) is a `@cloudflare/workers-types` issue on TypeScript 5.9.3 and 7.0.2 alike, not TypeScript 7-only. F3 (identity on connect) warns once per class, not on every connection. F17 has 4 McpAgent doc blocks, not 10. Two drafts were merged into F11, and line numbers were corrected.
  - The draft "ahead of release" finding was largely wrong. Its heuristic matched unrelated text on main, so two of its blocks are doc errors (F11).
  - One new doc error: F10, an undocumented and ignored `static options = { hibernate: false }`. I re-checked it against `AgentStaticOptions`.
- Tier 4 has 18 of 20 behavioral claims holding. Workflows are not verified offline.
- Follow-up for the harness: tighten `scripts/ahead-of-release.mjs` so it doesn't match unrelated text on main.
