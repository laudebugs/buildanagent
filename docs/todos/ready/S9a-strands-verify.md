# S9a: Strands Agents: mirror, verification harness, behavioral examples and TS parity check

| Field | Value |
| --- | --- |
| ID | `S9a` |
| Status | `ready` |
| Plan | [SDK references §4, S9](../../plans/sdk-references.md#s9-strands-agents-added-2026-11-18) |
| Round / milestone | M2d (added 2026-11-18) |
| Depends on | [S8b](../done/S8b-copilot-reference.md), [U10](../done/U10-strands-harness-sdk.md); start on or after 2026-11-20 |
| Size | L (split into S9a1/S9a2 if the mirror and harness outgrow one batch) |

## Goal

Do steps 1–5 of the [SDK process](../../../AGENTS.md#process-for-documenting-an-sdk) for Strands Agents in TypeScript: pin, mirror, lay out, verify the doc examples in tiers, and write behavioral examples ending in the triage-agent capstone.

## Context

- The plan section S9 and the [U10 report](../../research/external-designs/strands-harness-sdk.md), which lists the 0.4.0 defaults and the safety steps
- The finished harnesses in `verify/`, especially `verify/pi/` (in-process loop) and `verify/openai-agents-sdk/` (interrupt and resume)

## Scope

**In scope**

- `verify/strands/` with exact pins (`@strands-agents/sdk@1.25.0`, `@strands-agents/harness@0.4.0` from 2026-11-20)
- The docs mirror from tag `harness-typescript/v0.4.0` in `docs/reference/strands/source/`, with `_manifest.json`
- Tier 1–4 verification and 6–9 behavioral examples
- A TypeScript–Python parity draft

**Out of scope** (and which todo covers it)

- The guide and fact-check (S9b)
- The comparison and gap report (C6) and the skill (K5)

## Tasks

- [ ] Research: confirm the pins clear the one-week rule, the licence, the docs location, and how `Model` can be subclassed for a scripted test model
- [ ] Mirror the docs with `scripts/fetch-docs.mjs` and record where strandsagents.com (`main`) differs from the tag
- [ ] Extract, type-check and classify every TypeScript block; run the complete ones offline
- [ ] Diff the documented API surface (createHarness options, interventions, hooks, stream events) against the `.d.ts`
- [ ] Write behavioral examples, each asserting one documented behavior, plus the triage capstone
- [ ] Draft `results/findings-draft.md` and `results/parity-draft.md`

## Acceptance criteria

- [ ] `pnpm test` passes offline, with no AWS credentials in the environment
- [ ] Every example passes an explicit sandbox, and the scripted model never calls shell, write, edit, web fetch or search, code execution or subagent tools (denied by name)
- [ ] Results are committed in `verify/strands/results/` and the drift check passes

## Tests

The harness's own examples, run by `pnpm test`; the doc-example tiers run by `pnpm run verify`.

## Docs to update

`verify/strands/README.md`; the SDK references plan's todo table.

## Risks and open questions

- The docs site renders `main`; some pages will run ahead of 0.4.0.
- Weekly releases may move the pins; follow the one-week rule and the vulnerability exception.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, fact-checked, and reviewed whole with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; delivered through its own pull request, squash-merged after CI passes
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
