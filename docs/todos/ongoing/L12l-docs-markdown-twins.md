# L12l: Give every docs page a Markdown twin, plus llms.txt, llms-full.txt and "Copy as Markdown"

| Field | Value |
| --- | --- |
| ID | `L12l` |
| Status | `ongoing` |
| Plan | [Publish and docs DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs) |
| Depends on | [L12b](../done/L12b-docs-logo-header-mdx.md) |
| Size | M |

## Goal

Agents and readers get each docs page as plain Markdown, without the HTML around it. A post-build step writes `/<page>.md` beside every page, `llms.txt` lists the twins, `llms-full.txt` joins them, and a "Copy as Markdown" button under each title copies the twin. The build fails on a page without its twin or its `<link rel="alternate" type="text/markdown">`.

## Context

- [L12](L12-docs-redesign.md) and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the feature table row "Markdown twins" and the Lamina digest item "Markdown twins, `llms.txt` and Copy as Markdown" (adopted).
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

- [ ] Decide which pages get twins, and the generated API reference pages' case.
- [ ] Write the twin step, `llms.txt` and `llms-full.txt`.
- [ ] Add the head link and the "Copy as Markdown" button.
- [ ] Write the tests and the README section.

## Acceptance criteria

- [ ] Every page the function names has `/<page>.md`, and a test fails on one without it.
- [ ] Every page's head links its twin, and the build fails on a page that does not.
- [ ] `llms.txt` and `llms-full.txt` list and join the twins.
- [ ] The button writes to the clipboard inside the click handler.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

`apps/docs/test/`, reading the built site with `builtSite()`.

## Docs to update

`apps/docs/README.md` and the L12 todo's acceptance row.
