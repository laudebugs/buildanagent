# <ID>: <Title>

<!--
Copy this file to docs/todos/ready/<ID>-<kebab-slug>.md (for example S3a-openai-verify.md).
One todo is one pull request, squash-merged into main. If the work is bigger than one reviewable
pull request, split it into several todos (S3a, S3b, …) and chain them with "Depends on".
Keep the section order; write "None" for a section that doesn't apply.
-->

| Field | Value |
| --- | --- |
| ID | `<ID>` |
| Status | `ready` \| `ongoing` \| `done` (must match the folder) |
| Plan | `[<plan name> §<section>](../../plans/<plan>.md#<anchor>)` |
| Round / milestone | <for example Round S (SDK references), M1> |
| Depends on | <todo IDs that must be done first, linked; or "None"> |
| Size | S (one sitting) \| M (a few hours) \| L (a day: split it if you can) |

## Goal

One paragraph: what this todo delivers and why it matters now.

## Context

The plans, references, research and upstream sources to read first, with one line on why each matters.

## Scope

**In scope**

- …

**Out of scope** (and which todo covers it)

- …

## Tasks

A checklist detailed enough that someone new to the repo could do the work in order.

- [ ] …

## Acceptance criteria

Observable, checkable conditions: files that must exist, commands that must pass, numbers that must be met.

- [ ] …

## Tests

Which checks or examples to add or run, and where they live.

## Docs to update

Plans, READMEs, AGENTS.md, the roadmap: whatever this todo changes.

## Risks and open questions

What could go wrong, what's unknown, and who decides.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high`, then `medium` and `low` after more than 6 findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
