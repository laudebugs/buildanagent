# Writing a chapter of the book

`@buildanagent/manual` is the textbook at manual.buildanagent.fyi, a static Astro site ([book plan](../../docs/plans/build-book.md)). The build computes every chapter, figure, listing and table number, and checks every citation, glossary tag and analogy, so a chapter holds ids instead of numbers. **A chapter is ready when `pnpm --filter @buildanagent/manual check:book` passes, because that check runs the same rules as the build.**

## The outline places the chapter and gives it its number

Each chapter lives at `src/content/chapters/<slug>.md`, and its page is `/<slug>/`. Its slug must appear in [`src/outline.ts`](src/outline.ts), which lists the two parts and their chapters in reading order. The chapter's number is its position there, counted across both parts, so moving a chapter in the outline renumbers it, its figures, listings and tables, and every reference to them. The contents page lists every chapter in the outline, as plain text until its file exists.

The outline also gives each chapter its opening type: `scenario`, `incident`, `question`, `fact`, `code` or `analogy`. `check:book` fails when two consecutive chapters share an opening type, or when one type opens more than a quarter of the chapters, rounded up.

## The front matter is strict

The front matter takes exactly these six keys, and any other key, a misspelt one included, fails the check:

```yaml
---
title: "Use the least autonomy that works: a call, a workflow, then a loop"
summary: One or two sentences for the page's description.
opening: scenario
sources: [anthropic-building-effective-agents]
glossary: [agent, agent-loop, workflow]
switchTo: [B11]
---
```

- `opening` must be the type the outline plans for this chapter. To change it, change the outline, which reruns the rotation check.
- `sources` lists the register ids the chapter relies on, in the order its source list shows them; it needs at least one.
- `glossary` lists the glossary ids whose first use the chapter links; it may be empty.
- `switchTo` lists the todos whose code will replace the chapter's `verify/` listings; it may be empty.

The chapter's last `##` section is `## Exercises`, and it holds a list. The layout adds the chapter's sources after it, so the chapter has no sources section of its own.

## Citations point at the source register

Cite a source with `[@id]`, or several with `[@a; @b]`. The id must be in [`src/data/sources.json`](src/data/sources.json) and in the chapter's `sources`. The page shows each citation as the source's position in `sources`, such as `[1]`, linked to `/sources/#<id>`.

Each register entry names the fact-check log that verified it:

```json
{
  "id": "anthropic-building-effective-agents",
  "title": "Building effective agents",
  "publisher": "Anthropic",
  "url": "https://www.anthropic.com/engineering/building-effective-agents",
  "kind": "post",
  "asOf": "November 2026",
  "verifiedIn": "docs/research/agent/fact-check.md"
}
```

`kind` is `docs`, `repo`, `paper`, `spec` or `post`, and an optional `version` holds a tag or commit. `verifiedIn` is a path from the repository root, and that file must contain the URL, whether as an inline link, a bare URL or a reference-style definition. To cite a new source, first add its row to the chapter's fact-check log, `apps/manual/fact-checks/<slug>.md`, then add the entry with that log as `verifiedIn`. Set `"secondary": true` when the check rests on a search summary or a secondary write-up; the sources page then says so.

## References name an id, and the build writes the number

Mark a numbered block with a container directive, its caption in brackets and its id after `#`:

```markdown
:::figure[The loop runs until a stop condition holds]{#tool-call-round-trip}
…the figure…
:::

:::table[How each SDK stops the loop]{#stop-defaults}
| SDK | Default cap |
| --- | --- |
:::

:::listing[One model call]{#one-call}
…a fenced code block…
:::
```

Ids are kebab-case and unique across the book for each kind. A table must hold a table and a listing a code block, and every block needs a caption. Refer to a block with `[[fig:tool-call-round-trip]]`, `[[tbl:stop-defaults]]` or `[[lst:one-call]]`, and to a chapter with `[[ch:tools]]`. The build replaces each reference with a numbered link such as "Figure 3.2"; a reference to a planned chapter shows its number without a link. An unknown id or a malformed reference fails with the file and line. Inside code, both reference and citation syntax stay as written. Listings from real files arrive with T4's `::listing` directive, and generated figures with T6.

## Glossary terms link on their first use

[`src/data/glossary.json`](src/data/glossary.json) holds each term's definition in plain text, its spellings (`match`, the term itself when omitted) and at least one register source. A chapter tags a term by listing its id in `glossary`. The build links the term's first use to `/glossary/#<id>` and gives screen readers the definition through `aria-describedby`; later uses stay plain. Terms match any case and a plural, while an abbreviation (`"kind": "abbr"`, with its `expansion`) matches its exact case. A tagged id that the glossary lacks fails the check, and so does a tagged term that the chapter's text never uses.

## Each analogy explains one concept, across the whole book

Analogies are optional (BK22). A chapter that uses one first registers it in [`src/content/analogies.json`](src/content/analogies.json):

```json
{
  "id": "kitchen-ticket-rail",
  "concept": "agent loop",
  "analogy": "a kitchen ticket rail",
  "chapter": "call-workflow-loop",
  "illustration": "ticket-rail",
  "breaks": "A cook remembers yesterday's orders; a model sees only what the transcript carries."
}
```

The chapter then marks each use with `:analogy[the ticket rail]{#kitchen-ticket-rail}`. A later chapter refers back to the same analogy by the same id; it may not name an analogy from a later chapter. `illustration` is the id of a figure in that chapter, or `null`. The check compares analogies and concepts without case, punctuation or a leading article. It fails on the same analogy listed twice, on an analogy that explains a second concept, on a concept given a second analogy, and on a chapter that names an id the register lacks.

## Running the checks

From the repository root:

- `pnpm --filter @buildanagent/manual check:book` loads the outline and the three registers, then renders every chapter through the build's own Markdown plugins, and prints each problem as `file:line: message`.
- `pnpm --filter @buildanagent/manual test` runs the plugins on the fixture book in `test/fixtures/book/`, with one failing fixture for each rule `check:book` applies.
- `pnpm --filter @buildanagent/manual build` builds the site into `dist/` and indexes it with Pagefind.

The content model lives in `src/book/` and the Markdown plugins in `src/markdown/`. When either changes, or the outline, a register or another chapter's numbered blocks change, `astro.config.mjs` clears Astro's content cache, so no chapter keeps stale numbers or links. The citation and glossary plugins, the strict schema and the text splitter are adapted from the owner's garment engineering textbook and are licensed Apache-2.0 only ([THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)).
