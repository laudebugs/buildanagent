# L12i: Write the harness pages, part 2, with figure 8 and a "Problems and fixes" section

| Field | Value |
| --- | --- |
| ID | `L12i` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-23) |
| Depends on | [L12h](../done/L12h-docs-harness-pages-1.md) |
| Size | M |

## Goal

Finish the harness topic with the four pages that L12h left out: permissions, the sandbox and credentials, the server and its clients, and extensions. Draw figure 8, `sandbox-egress`. Extend the shared Problems and fixes page with an entry set for each new area, each from a symptom to a cause and a fix, naming the error code. The owner's amendments of 2026-11-25 add the Problems and fixes entries and the friction record to the original scope.

## Context

- [L12](../ongoing/L12-docs-redesign.md), its [amendments of 2026-11-25](../ongoing/L12-docs-redesign.md#amendments-to-the-sub-todos-that-have-not-started-2026-11-25) and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the plan, the nine figures and the added requirements.
- [L12h](../done/L12h-docs-harness-pages-1.md) and [L12g](../done/L12g-docs-protocol-cli-pages.md): the templates for this todo, with their review lessons.
- [L12q](../done/L12q-docs-examples.md): the harness examples this todo's pages quote.
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md): the page and example rules.
- `packages/harness/README.md` and `packages/harness/src/`: the source of every claim.

## Scope

**In scope**

- Four pages in the Harness topic, after Tools and before Problems and fixes: Permissions, Sandbox and credentials, Server and clients, and Extensions.
- New harness examples for the permission rules, the egress proxy and project extensions, each with a test, and regions in the existing triage, sandbox, in-process client and audit examples.
- Figure `sandbox-egress`.
- New sections of the Problems and fixes page for these four areas.
- A friction record in the outcome.

**Out of scope**

- Links from Problems and fixes entries to error-code pages (L12t is only proposed).
- A live run against a real sandbox or real credentials: every example here runs offline on `ScriptedModel`, the fake sandbox and loopback only.
- Any change to the harness's behaviour.

## Tasks

- [ ] Add the harness examples and their tests.
- [ ] Write the four pages, wire the sidebar and the next links, and update the tests.
- [ ] Draw `sandbox-egress` and place it.
- [ ] Extend Problems and fixes with at least three new entries.
- [ ] Fact-check every claim and log it.
- [ ] Update the L12 umbrella and the plan's todo table.

## Acceptance criteria

- [ ] The four pages exist in the sidebar, in order, and each links to the next
- [ ] Every code block over five lines comes from a tested example file
- [ ] The Problems and fixes page holds at least three new entries for these areas, each from a symptom to a cause and a fix
- [ ] Figure 8 is on the sandbox page, with alt text that states one point, and the page text states every fact it shows
- [ ] `pnpm check`, `pnpm typecheck`, the harness and docs suites and the package checks pass offline, and the docs build's link validator reports no broken link

## Tests

`packages/harness/test/examples/` and `apps/docs/test/`.

## Docs to update

The L12 todo's table and "L12i progress", and the plan's todo table.

## Risks and open questions

- The sandbox page cannot show a real backend's run without a real sandbox, so it shows the fake sandbox, which enforces the same policy in memory, and leaves the real backends to the package README.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check` and `pnpm typecheck` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed
