# L12g: Write the protocol and CLI pages, with a quick start for each and CLI transcripts from real runs

| Field | Value |
| --- | --- |
| ID | `L12g` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-23) |
| Depends on | [L12d](../done/L12d-docs-figure-pipeline.md), [L12f](../done/L12f-docs-api-reference-four-packages.md) |
| Size | M (split the transcripts from the pages if the pull request grows past one review) |

## Goal

Give the protocol and the CLI the written pages the gateway and the SDK have: a quick start for each, built from one tested example, and a page on how each is used. Draw figure 9, `protocol-clients`. Every terminal session a CLI page shows comes from a committed transcript that a CLI test re-runs, and a docs test fails on a typed session. The owner's amendments of 2026-11-25 add the quick starts, the transcripts and the friction record to the original scope.

## Context

- [L12](../ongoing/L12-docs-redesign.md), its [amendments of 2026-11-25](../ongoing/L12-docs-redesign.md#amendments-to-the-sub-todos-2026-11-25) and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the plan, the nine figures and the three added requirements.
- [L12q](../done/L12q-docs-examples.md): the protocol examples this todo's pages quote.
- [L12k](../done/L12k-docs-fences-gateway-figures.md) and [`apps/docs/README.md`](../../../apps/docs/README.md): the `file=` fence, the figure directive and the tests that share one site build.
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md): the page and example rules.
- `packages/protocol/README.md`, `packages/cli/README.md` and their `src/`: the source of every claim.

## Scope

**In scope**

- A "Protocol" topic and a "CLI" topic in the sidebar, each with a quick start and a page on how the package is used, and the home cards of both packages moved to their quick starts.
- A new protocol example for the quick start, with a test.
- Figure `protocol-clients`.
- `packages/cli/transcripts/`, a CLI test that runs each command and compares its output, and a docs test that fails on a `console` fence or a `$ ` shell block that names no transcript.
- A link from each package's API reference index to its quick start.
- A friction record in the outcome.

**Out of scope**

- The harness and agent-safety pages and quick starts (L12h to L12j) and any change to the gateway's or the SDK's pages.
- A recorded run of the CLI against a real model: the transcripts hold the runs that need no key.
- A figure that is not `protocol-clients`.

## Tasks

- [x] Add the protocol quick start example and its test.
- [x] Add the transcripts, the CLI test that re-runs them and the `file=` fence's support for them.
- [x] Add the docs test that fails on a typed terminal session.
- [x] Write the protocol and CLI pages, wire the sidebar and the home cards, and update `home.test.ts`.
- [x] Draw `protocol-clients` and place it.
- [x] Link each reference index to its quick start.
- [x] Fact-check every claim and log it.

## Acceptance criteria

- [x] Each of the two packages has a quick start built from a tested example file
- [x] A changed CLI output fails `packages/cli/test/transcripts.test.ts` until the transcript is rewritten
- [x] A docs test fails on a terminal-session fence that names no transcript: a `console` fence, or a shell fence with a line that starts with a `$ ` prompt
- [x] The protocol and CLI home cards lead to the quick starts, and `home.test.ts` checks them
- [x] Both API reference indexes link to their quick start
- [x] `pnpm check`, `pnpm typecheck`, the protocol, CLI and docs suites and the five package checks pass offline, and the docs build's link validator reports no broken link

## Tests

`packages/protocol/test/examples.test.ts`, `packages/cli/test/transcripts.test.ts` and `apps/docs/test/`.

## Docs to update

`apps/docs/README.md` for the transcript fence, the L12 todo's table and the plan's todo table.

## Risks and open questions

- A transcript that holds the SDK's version would fail on every release, so the CLI test replaces that one value before it compares.
- The CLI's binary cannot reach a scripted model, so no transcript shows a turn. The quick start shows the commands that need a key as commands, not as output.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check` and `pnpm typecheck` pass locally, and so do the protocol, CLI and docs suites; root `pnpm test` stops in `verify/copilot-sdk` on this machine, which needs `unshare -rn`, so CI ran the rest; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [x] Two code-review rounds run on the pull request: the first, high, found 15 findings and all were fixed; the second round's medium review found 18 items, of which 7 were fixed and the rest explained, and its low review found 3, all fixed
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores, before and after, in the pull request description

## Outcome

- **Pages.** Two new sidebar topics, "Protocol" and "CLI". Protocol: `protocol/quick-start`, `protocol/messages` (with figure 9, `protocol-clients`) and `protocol/session-files`. CLI: `cli/quick-start` and `cli/commands`. The home cards of both packages lead to the quick starts, and `home.test.ts` checks the targets and that each page is built. The sidebar tests now expect three written topics, and the next-link test works within a topic (the last protocol page links on to its API reference, the last CLI page to its own).
- **Quick starts.** The protocol's is built from the new `packages/protocol/examples/quick-start.ts` (regions `request` and `answer`, three tests). The CLI's is built from the existing `packages/cli/examples/run-json.ts`, which needed no change.
- **Transcripts.** `packages/cli/transcripts/` holds five: `help`, `sessions-empty`, `no-model`, `no-key` and `rpc-initialize`. `packages/cli/test/transcripts.test.ts` spawns the binary for each, compares its output and fails on a changed output until `REWRITE_TRANSCRIPTS=1` rewrites the file; it also fails on a stray file. The SDK's version, which changes every release, is replaced with `<version>` before the comparison. A `console` fence takes a transcript through `file="packages/<pkg>/transcripts/<name>.txt"`, and `apps/docs/test/transcripts.test.ts` fails on a terminal-session fence that names none, and on a committed transcript that no page shows.
- **Reference links.** The `@module` comments of the protocol and the CLI link their quick starts, so the generated reference index shows the link, and `apps/docs/test/reference-links.test.ts` checks it in the built pages. The address is absolute because the same TSDoc reaches readers in an editor or on npm, where a site-relative path leads nowhere; a preview build therefore links to production. The changeset is a patch.
- **Friction: the harness version.** The CLI never passes `harnessVersion`, so `initialize` and every session header say `0.0.0`; the quick start names it a known bug, and [L12g1](../ready/L12g1-cli-reports-harness-version.md) fixes it.
- **Friction: no turn transcript.** The binary cannot reach a scripted model, so no transcript shows a turn, and settling how to record one offline is left to L12u.
- **Friction: no public validator.** The protocol has no public validator, so the quick start checks envelopes only, as L12q found.
- Claims are in the fact-check log, rows L12g-1 to L12g-38.
