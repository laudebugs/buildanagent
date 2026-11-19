# Chapter fact-check logs

Each chapter keeps its own fact-check log here, `<slug>.md`, named for the chapter's file in `src/content/chapters/`. `check:book` fails when a chapter exists without its log, so a chapter's first commit adds both.

A log holds a table with one row per claim, in the format of the repository's other logs:

```markdown
| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 1 | The loop stops when the model answers without a tool call | § The loop | ✅ | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): "…" |
```

The verdict is ✅ confirmed, ✏️ corrected or ⚠️ unverified. A correction gets its own row, so every change stays visible. The log ends with a tally of each verdict.

Fact-check each section as soon as you draft it, before you start the next, and commit its rows with it ([BK21](../../../docs/plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted)). A chapter that needs a new source first adds a row that checks it here; the register entry in `src/data/sources.json` can then name this log as its `verifiedIn`.
