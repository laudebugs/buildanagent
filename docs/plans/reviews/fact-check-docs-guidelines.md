# Fact-check: the docs-writing guideline

This log checks the claims that [docs-writing.md](../../guidelines/docs-writing.md) and its pointer in [examples.md](../../guidelines/examples.md) make about what the docs app and the book enforce. Each row names the file it describes. Row ids follow AGENTS.md: the todo id, a hyphen and a count.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

## The diagram, callout and tab rules (L12n, 2026-11-22)

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| L12n-1 | The docs app has no figure pipeline and no tabs component yet | ✅ | `grep -rli "figure\|TabItem\|<Tabs"` over `apps/docs/src` and `apps/docs/astro.config.mjs` finds nothing |
| L12n-2 | The docs test checks none of the diagram or callout rules | ✅ | `apps/docs/test/content.test.ts` checks the title and description, the 50-word opening, 40-word sentences and 100-word paragraphs, ids and paths, banned words, sentence-case headings, fences and the sidebar; `grep -ri "callout\|aside"` over `apps/docs/src` and `apps/docs/test` finds nothing |
| L12n-3 | The docs test already fails a fence of more than five lines that has no `examples/` file, wherever it sits on the page | ✅ | `content.test.ts`, the "shows a long code block only from a tested example file" test, loops over `page.fences` with `MAX_INLINE_CODE_LINES = 5`; `pages.ts` `splitFences` collects every fence in the body, indented ones included |
| L12n-4 | The book's figure kit sets labels at 12 px, and a label's size comes from a `fig-text` class | ✅ | `apps/manual/src/styles/components.css`: `.fig-text { font-size: 12px; }`; `apps/manual/figures/lib/svgkit.ts` `STYLE_CLASSES`, and `apps/manual/README.md` ("labels stay at 12 px, the approved phone label size"). The heading class is 14 px, so no label is under 12 px |
| L12n-5 | The book colours figure marks through `fig-*` classes that read panel tokens, never colour attributes | ✅ | `components.css` `.fig-text`, `.fig-line` and `.fig-amber` use `var(--panel-*)`; `svgkit.ts` writes `class=` only; `apps/manual/README.md`: "never with colour attributes"; `apps/manual/test/figures.test.ts` line 253, "colours only through classes" |
| L12n-6 | The book's build fails when a figure lacks alt text or a caption | ✅ | `apps/manual/README.md`: "fail, with the chapter's file and line, when a figure lacks its alt text or its caption"; `apps/manual/src/markdown/remark-figures.ts` header |
| L12n-7 | Starlight's four callout kinds are note, tip, caution and danger | ✅ | `@astrojs/starlight` 0.42.10 `dist/translations/en.js`: `aside.note`, `aside.tip`, `aside.caution`, `aside.danger` |
| L12n-8 | "More than five nodes" is our own threshold for a text description, and each callout kind's job is our own wording | ⚠️ | Our choice, flagged as such in the rule for the first; no upstream source sets either |
| L12n-9 | `examples.md` now says a page that shows tabs takes every tab from its own example file, and that anchor in `docs-writing.md` exists | ✅ | The heading "Use code tabs only for one task in two forms" slugs to `use-code-tabs-only-for-one-task-in-two-forms` |

**Totals:** 9 claims: 8 ✅, 0 ✏️, 1 ⚠️.
