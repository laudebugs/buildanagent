# L5: Build the docs app on Astro Starlight

| Field | Value |
| --- | --- |
| ID | `L5` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [B3](../done/B3-scripted-model.md) |
| Size | M |

## Goal

Stand up `apps/docs`, the docs site for `docs.buildanagent.fyi`, with the structure docs-writing.md asks for and the first pages ([DS1](../../plans/publish-and-docs.md#ds1-starlight-docs-with-a-generated-api-reference-accepted), ADR 0048).

## Context

- [DS1](../../plans/publish-and-docs.md#ds1-starlight-docs-with-a-generated-api-reference-accepted) and [ADR 0048](../../decisions/0048-docs-on-astro-starlight.md)
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md)
- Lamina PDF's `apps/docs` (Starlight config, explicit sidebar, `starlight-links-validator`)

## Scope

**In scope**

- `apps/docs` (`@buildanagent/docs`, private) with Astro and Starlight pinned (7.4.11 and 0.42.10 on 2026-11-19, or the newest releases at least a week old when the todo starts), and `apps/*` in `pnpm-workspace.yaml`
- An explicit sidebar in the order start, concepts, guides, testing, reference
- First pages from the package READMEs: what the SDK is, install, the transcript and stream rule, testing with `ScriptedModel`
- `starlight-links-validator` failing the build on a broken link
- A footer naming the CC BY 4.0 licence with a link to `LICENSE-DOCS`
- `build` and `test` scripts the root `pnpm test` picks up

**Out of scope** (and which todo covers it)

- The API reference (L6), deploys (L8)

## Acceptance criteria

- [x] `pnpm -C apps/docs build` writes a static site to `apps/docs/dist/` and fails on a broken internal link
- [x] Every page opens with a paragraph of 50 words or fewer and mentions no todo or ADR ids, checked by a test over the content files
- [x] Every code block of more than five lines is imported from a file under `packages/*/examples/` or is listed as a gap until B19 adds the examples
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The content checks, under `apps/docs/test/`.

## Docs to update

AGENTS.md (layout: `apps/`), README.md (docs link), [Known gaps](../../guidelines/README.md#known-gaps) if the README-snippet gap moves here, the plan's todo table.

## Risks and open questions

Astro and Starlight release weekly; pin exact versions and let the weekly SDK-updates pattern stay limited to `verify/*`.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`apps/docs` (`@buildanagent/docs`, private) builds a static Starlight site with 14 pages in five sections, an explicit sidebar and a footer that names CC BY 4.0 and links to `LICENSE-DOCS`. `pnpm --filter @buildanagent/docs build` writes `dist/` and fails on a broken internal link, which the build proved by failing on a seeded one.

- **The content rules run as a test.** Every page opens with a paragraph of 50 words or fewer, keeps sentences to 40 words and paragraphs to 100, names no todo, decision or round id, repository path or banned word, uses sentence-case headings, introduces each code block with a sentence, sits in the sidebar and ends with a link to the next page.
- **Code comes from tested files.** A fence with `file="packages/<pkg>/examples/<file>.ts"` and an optional `region` takes its code from the example at build time, so a block of more than five lines can only come from an `examples/` folder, and the build fails on a missing file or region. The SDK's examples gained `// #region` markers, and two new examples with tests, `offline-order-agent.ts` and `refund-approval.ts`, show `ScriptedModel` and an approval gate. The capstone stays at its 100-line limit, so it carries no markers. No block is listed as a gap.
- **Inline blocks type-check.** A shorter inline block is compiled against the workspace packages by a test, so no snippet on the site can drift from the API.
- **The pins are the plan's.** Astro 7.4.11, as the book uses, with Starlight 0.42.10 and `starlight-links-validator` 0.27.0, all at least a week old. Newer Astro and Starlight releases exist and can be adopted together with the book.
- **One rule was read two ways.** The examples guideline says an example holds no test scaffolding, yet a page on `ScriptedModel` has to show one in use. The new example's header says it is about testing, and the guideline is unchanged.
