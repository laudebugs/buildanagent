# L12l: Give every docs page a Markdown twin, plus llms.txt, llms-full.txt and "Copy as Markdown"

| Field | Value |
| --- | --- |
| ID | `L12l` |
| Status | `done` |
| Plan | [Publish and docs DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs) |
| Depends on | [L12](../ongoing/L12-docs-redesign.md) (L12b has no todo file of its own) |
| Size | M |

## Goal

Agents and readers get each docs page as plain Markdown, without the HTML around it. A post-build step writes `/<page>.md` beside every page, `llms.txt` lists the twins, `llms-full.txt` joins them, and a "Copy as Markdown" button under each title copies the twin. The build fails on a page without its twin or its `<link rel="alternate" type="text/markdown">`.

## Context

- [L12](../ongoing/L12-docs-redesign.md) and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the feature table row "Markdown twins" and the Lamina digest item "Markdown twins, `llms.txt` and Copy as Markdown" (adopted).
- [`apps/docs/README.md`](../../../apps/docs/README.md): how `file=` fences, figures and the shared build work, which the twin must resolve.
- The owner answered no to question 9a (Context7) on 2026-11-23, so no `context7.json`; the code leaves one seam where it could be added.

## Scope

**In scope**

- One function decides which pages have a twin; the post-build step, `llms.txt`, `llms-full.txt`, the head link and the button all read it.
- Twins resolve `file=` fences to their code and replace figures and components with Markdown a reader can use.
- Tests through `builtSite()`.

**Out of scope**

- `context7.json` (owner said no for now), the CSP (L12m) and any `.github/` edit.

## Tasks

- [x] Decide which pages get twins, and the generated API reference pages' case.
- [x] Write the twin step, `llms.txt` and `llms-full.txt`.
- [x] Add the head link and the "Copy as Markdown" button.
- [x] Write the tests and the README section.

## Acceptance criteria

- [x] Every page the function names has `/<page>.md`, and a test fails on one without it.
- [x] Every page's head links its twin, and the build fails on a page that does not.
- [x] `llms.txt` and `llms-full.txt` list and join the twins.
- [x] The button writes to the clipboard inside the click handler.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Outcome

Every docs page, the generated API reference included, now has a Markdown twin: 282 files (515 KiB), written in about 0.5 s. `hasTwin()` in `apps/docs/src/twins/rule.ts` decides which pages get one, and the post-build step, `llms.txt`, `llms-full.txt`, the head link and the button all read it.

The API reference stays in because TypeDoc already writes Markdown. The build fails on a page that lacks its twin or its head link. The "Copy as Markdown" button starts its clipboard write inside the click handler. The home page has the head link and no button, because Starlight's splash template has no page title. Claims are in [the fact-check log](../../plans/reviews/fact-check-publish-and-docs.md), rows `L12l-1` to `L12l-16`.

First review:

- `hasTwin()` rejects the 404 page.
- The twin step skips drafts, slugs files as github-slugger does and honours `slug`.
- Links to assets keep their address.
- An MDX expression other than a string or a comment fails the build.

Second review:

- A string literal is escaped so Markdown can't read it as syntax.
- A component that starts on its tag's line keeps its code's indent.
- Front matter reads CRLF, an end-of-file fence and an empty block.
- `llms.txt` entries stay on one line.
- The sidebar places `slug: "index"` and `link:` entries.
- A fence closes only on a line with no info string.

After the reviews: a twin error names the file under `src/content/docs/` and the line in that file, front matter included.

Dependencies: three new direct ones, `unified` 11.0.5, `remark-parse` 11.0.0 and `remark-mdx` 3.1.1. `yaml` and `remark-directive` moved to `dependencies`, beside the other packages the build imports.

## Tests

`apps/docs/test/`, reading the built site with `builtSite()`.

## Docs to update

`apps/docs/README.md` and the L12 todo's acceptance row.
