# S7b: Google ADK

| Field | Value |
| --- | --- |
| ID | `S7b` |
| Status | `ongoing` |
| Plan | [SDK references §4](../../plans/sdk-references.md#4-the-eight-sdks) |
| Round / milestone | M2c (added 2026-11-18) |
| Depends on | [ guide and fact](../ready/ guide and fact-check, written and reviewed.md) |
| Size | S7a-google-adk-verify:M |

## Goal

Google ADK, following the eight-step SDK process in [AGENTS.md](../../../AGENTS.md#process-for-documenting-an-sdk) and the plan's S6/S7 notes, including the language policy (TypeScript references with a parity check against the SDK's primary language).

## Context

- The [SDK references plan](../../plans/sdk-references.md), sections S6, S7 and the language policy
- The five finished references as the structure to mirror

## Scope

**In scope**

- As named in the title; see the plan section for packages, docs, test model and behaviors

**Out of scope** (and which todo covers it)

- Deployment to the vendor's platform; primary-language harnesses (the parity check reads their docs only)

## Tasks

- [ ] Do the work the title names, following the plan section
- [ ] Draft any prose with `/anthropic-skills:writing` and review it with `/anthropic-skills:writing-review`
- [ ] Run the local checks and push

## Acceptance criteria

- [ ] The deliverables named in the plan exist and pass review
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

The SDK harness's behavioral examples, where the todo has a harness.

## Docs to update

Root README; the relevant plan.

## Risks and open questions

Cloudflare needs the Workers runtime locally (workerd); Google's TypeScript ADK lags its Python primary. Record both in the fact-checks.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
