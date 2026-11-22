# N23: Skills, context files and the plan-file convention

| Field | Value |
| --- | --- |
| ID | `N23` |
| Status | `done` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client) |
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

- [x] Use this repo's own `.agents/skills` as a fixture.

## Acceptance criteria

- [x] The system prompt lists each skill's three fields and no body
- [x] Reading a `SKILL.md` writes one `skill_loaded` entry
- [x] After a compaction, the next request contains the `AGENTS.md` text again
- [x] On resume, the plan file's content is in the first request
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/extensions/skills.test.ts`, `context-files.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

The Agent Skills specification was unreachable during research; follow this repo's README and Pi's field limits.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/harness/extensions` gains `parseSkill()`, `skillsPrompt()`, `withSkills()`, `skillOfRead()`, `projectContext()`, `contextText()`, `planPrompt()` and `withPlanConvention()`, and the Node-only `@buildanagent/harness/extensions/node` gains `discoverSkills()`, `contextFiles()` and `planFileSource()`. `HarnessOptions.skills` makes the runner write a `skill_loaded` entry. 32 tests in `test/extensions/skills.test.ts` and `context-files.test.ts` cover the acceptance criteria. No changeset is needed: the harness is private, and the changeset gate skips private packages.

- **Skills.** `discoverSkills(cwd)` walks from `cwd` to the first folder with a `.git` and reads each `SKILL.md` under `.agents/skills`, nearest folder first; a name taken by a nearer skill is skipped with a notice. With no repository it searches `cwd` alone, so a stray file in `/tmp` or a home folder is never a skill. It takes an optional `{ trust, headless, loadInHeadless }`, which applies the project-trust gate the guide describes for skills; the todo's `discoverSkills(cwd)` form lists every skill found, so a host with a trust store passes it. The name and description limits (64 and 1,024 characters, the name's character set) are Pi's, and the folder-name match is this repository's skills README; the Agent Skills specification was not read.
- **`skill_loaded`.** The runner matches each successful `read` call's `path` or `file_path` input against `HarnessOptions.skills` and writes one entry per read. The `read` built-in (N21) does not exist yet, so the match is on the tool's name and those two input names, and N21 must keep them.
- **Context files.** Found outside the trust gate, labelled `<untrusted-project-context>`, cut at 64 KiB (our limit), and a link leaving the project is skipped. They reach the model as the start of the first user message of every request, built by a `transformContext` hook, not in the system prompt as the todo's context line for N52 supposed, and not as a log entry. A compaction therefore cannot drop them, which is how the first request after a compaction holds the `AGENTS.md` text again. The N9 summary layer needed no change. The cost is that the log holds no copy of the files' text.
- **Plan files.** `.agents/plan.md` and `.agents/progress.json`, read from a `PlanSource` at the first model call of each run and held for the rest of that run so the cached prefix stays put. The test resumes a session in a new harness over the same log and finds the plan the earlier process left. `resumeTurn()` goes through the same interceptors, but no test pauses for an approval and resumes with the plan changed.
- **Not done.** Skill authoring tools and `disable-model-invocation` are not handled, and skills' path matching is POSIX-only.
