# N23: Skills, context files and the plan-file convention

| Field | Value |
| --- | --- |
| ID | `N23` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-extensions-and-mcp) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N22](N22-in-process-extensions.md), [N9](N9-summary-layer.md) |
| Size | S |

## Goal

Add the no-code tier: advertise skills by name, description and path, record each load, read `AGENTS.md` natively, and ship the plan and progress file convention that long tasks keep their state in.

## Context

- [harness guide §7](../../guides/agent-harness.md#7-extensions-come-in-three-trust-tiers-and-project-trust-gates-loading-not-execution): skills from `.agents/skills`, `skill_loaded`, `AGENTS.md`
- [harness guide §3](../../guides/agent-harness.md#3-context-policy-should-run-five-removable-layers-cheapest-first-and-keep-every-compaction-visible-and-reversible): long tasks keep state in files; re-read on resume
- [`.agents/skills/README.md`](../../../.agents/skills/README.md): the format this repo uses

## Scope

**In scope**

- `discoverSkills(cwd)` from `.agents/skills` up to the repository root
- Name, description and path in the system prompt; the body loaded through `read`; a `skill_loaded` entry when `read` opens a `SKILL.md`
- `contextFiles(cwd)` for `AGENTS.md` and `CLAUDE.md`, outside the trust gate and labelled untrusted, re-injected after compaction
- A plan-file convention (`.agents/plan.md` and `progress.json`) and a resume hook that re-reads them

**Out of scope** (and which todo covers it)

- Skill authoring tools

## Tasks

- [ ] Use this repo's own `.agents/skills` as a fixture.

## Acceptance criteria

- [ ] The system prompt lists each skill's three fields and no body
- [ ] Reading a `SKILL.md` writes one `skill_loaded` entry
- [ ] After a compaction, the next request contains the `AGENTS.md` text again
- [ ] On resume, the plan file's content is in the first request
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/extensions/skills.test.ts`, `context-files.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

The Agent Skills specification was unreachable during research; follow this repo's README and Pi's field limits.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
