# A14: The bundle hash and per-model prompt overlays

| Field | Value |
| --- | --- |
| ID | `A14` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 3](../../plans/build-agent.md#43-stage-3-the-workflow) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A13](A13-triage-workflow.md) |
| Size | S |

## Goal

Hash everything that changes the agent's behaviour into one bundle id, stamp it on every ticket session and span, and load per-model prompt overlays, so every result and incident names the exact configuration.

## Context

- [agent guide §4](../../guides/agent.md#4-the-system-prompt-stays-short-and-frozen-skills-hold-procedures-and-only-code-enforces): prompts, tools and skills versioned with the model as one bundle
- [build-agent.md §3.4](../../plans/build-agent.md#34-contexts-gates-and-the-workflow): `Bundle`, `bundleHash()`
- [build-agent.md §3.7](../../plans/build-agent.md#37-needs-from-the-sdk-and-harness-plans): need H8

## Scope

**In scope**

- `bundleHash()` over a canonical JSON form of models, prompts, overlays, questions, tool schemas, skills, policy version, grader versions, effort, SDK and harness versions
- Overlays in `prompts/overlays/<model>.md`, applied by model id
- The stamp on the session header (or the H8 workaround) and on spans

**Out of scope** (and which todo covers it)

- Choosing overlays by eval (A20)

## Tasks

- [ ] Test that changing any one input changes the hash and that key order does not.

## Acceptance criteria

- [ ] Two identical bundles hash equally; any single field change alters the hash
- [ ] Every ticket session in the workflow tests carries the hash
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/bundle.test.ts`.

## Docs to update

The README's "Versioning" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
