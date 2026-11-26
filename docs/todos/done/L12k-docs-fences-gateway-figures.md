# L12k: Put `file=` fences on the docs' inline examples, add the gateway page and draw figures 3 to 6

| Field | Value |
| --- | --- |
| ID | `L12k` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-23) |
| Depends on | [L12d](../done/L12d-docs-figure-pipeline.md) |
| Size | M (split the gateway page from the figures if the pull request grows past one review) |

## Goal

Make every code block on the docs' existing pages come from a tested example file, add a page for the gateway, and draw the four figures that explain the loop's stream, its stop reasons, the approval pause and the gateway's adapters, with the pipeline L12d built. The manager asked for this on 2026-11-23.

## Context

- [L12](../ongoing/L12-docs-redesign.md) and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the plan. The nine figures are `package-map`, `run-loop` (done in L12d), `stream-and-transcript`, `stop-reasons`, `approval-pause`, `gateway-adapters` (this todo), and `session-log`, `sandbox-egress` and `protocol-clients` (L12h, L12i, L12g).
- [L12d](../done/L12d-docs-figure-pipeline.md) and [`apps/docs/README.md`](../../../apps/docs/README.md): the figure pipeline, the `::figure` directive and its rules, and the tests that share one site build (`builtSite()`).
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md): the page and example rules.
- `packages/gateway/README.md` and `packages/gateway/src`: the source of every claim on the gateway page and in the gateway figure.

## Scope

**In scope**

- Every `ts` block on the existing pages that has no `file="packages/<pkg>/examples/<file>.ts"` fence gets one, taken from a `// #region` of a tested example file. Today that is one block in `start/first-agent.md` and one in `testing/offline.md`. Add an example file only where none holds the code.
- A gateway page under `concepts/` that says what the gateway does (provider adapters, streaming, retries, prompt caching and cost accounting), shows tested examples from `packages/gateway/examples/`, and links the generated API reference. Every claim is checked against the gateway's README and source.
- Figures `stream-and-transcript`, `stop-reasons`, `approval-pause` and `gateway-adapters`, each on the page that explains it, with alt text that states the point in two short sentences, a caption, token-only colours and a layout that shows whole at 390 pixels.
- One MDX test for `::figure`, now that the docs enable MDX.
- Sidebar entries only where a new page needs one, kept minimal because L12c rewrites the sidebar.

**Out of scope**

- The other figures (L12g, L12h, L12i) and the protocol, harness, CLI and agent-safety pages.
- Any change to the figure sanitiser or the directive; if one is needed, stop and say why.
- Editing anything under `.github/`.

## Tasks

- [x] Add `file=` fences to the inline blocks, with an example file where none exists.
- [x] Write the gateway page and check every claim against the gateway's README and source.
- [x] Draw the four figures and put each on its page, with the page text stating every fact it shows.
- [x] Add the MDX test for `::figure`.
- [x] Add fact-check rows for the gateway page and the figure labels.

## Acceptance criteria

- [x] No `ts` block on a docs page lacks a `file=` fence, and a test fails if one appears
- [x] The gateway page and each figure's claims are in the fact-check log
- [x] The four figures build, pass the stale and sanitiser tests, and show whole at 390 pixels
- [x] A test builds an MDX page with a `::figure` and checks the inlined figure
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`apps/docs/test/`, reading the shared build through `builtSite()`.

## Docs to update

`apps/docs/README.md` if the fence rule changes, the L12 todo's table and the plan's todo table.

## Risks and open questions

- L12c rewrites the sidebar at the same time, so this todo adds pages and figures and keeps its wiring minimal.
- Stop reasons and the approval pause must match `packages/sdk/src/loop.ts` exactly; the figures say what the code does, not what the concept pages summarise.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed

## Outcome

- The two inline `ts` blocks now come from tested example files (`packages/sdk/examples/make-model.ts`, `make-openai-model.ts` and `offline-setup.ts`), and `apps/docs/test/fences.test.ts` fails on any `ts` block without a `file=` fence, whatever the case of its language, and on a `<Code lang="ts">` component (`test/exceptions.ts` is empty, and each entry needs a reason).
- The gateway page is `concepts/the-gateway.mdx` (MDX because it uses tabs for the Anthropic and OpenAI adapters), with five sections and examples from `packages/gateway/examples/`; every claim is in the fact-check log.
- Four figures, each on the page that explains it: `stream-and-transcript`, `stop-reasons`, `approval-pause` and `gateway-adapters`. The gateway's third adapter is labelled `scripted`, because the gateway has no testing adapter of its own.
- Checking `loop.ts` corrected the stop-reasons page: `error` also covers a hook that throws, a budget that cannot price a call and a refused resume (fact-check rows L12k-22 and L12k-30). The gateway page also says a provider hint over 60 seconds ends the call with no retry (row L12k-29).
- `::figure` works in MDX with no change to the plugin, and a test requires a figure on an `.mdx` page. Starlight's typographic quotes turn an apostrophe in a caption into a curly one, so captions must not contain apostrophes (the README says so).
- The make-model examples' model ids are checked against the price catalog and its `retires` date (row L12k-35).
