# `@buildanagent/manual`: the textbook at manual.buildanagent.fyi

The book is a static Astro site with Pagefind search, built from the [book plan](../../docs/plans/build-book.md). This README first covers writing a chapter. The build computes every chapter, figure, listing and table number and checks every citation, glossary tag and analogy, so **a chapter is ready when `check:book` passes, because that check runs the same rules as the build**. The README then covers the book's look: where the design tokens come from, where each token may be used, how the fonts are made, and which components exist. Every colour, font and size on a page comes from one file, [`docs/design/book-tokens.json`](../../docs/design/book-tokens.json), so a design change starts there and never in the CSS.

## Commands

Run each from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm --filter @buildanagent/manual build` | Builds the site into `apps/manual/dist/` and indexes the chapters with Pagefind |
| `pnpm --filter @buildanagent/manual dev` | Serves the site locally while you edit |
| `pnpm --filter @buildanagent/manual test` | Runs the offline tests, including a full build into a temporary folder |
| `pnpm --filter @buildanagent/manual typecheck` | Type-checks the app's TypeScript with the root `tsc` setup |
| `pnpm --filter @buildanagent/manual check:book` | Checks the outline, the three registers and every chapter against the build's own rules, without building |
| `pnpm --filter @buildanagent/manual book:switch-report` | Lists each written chapter's `switchTo` todos and which are done; `test` runs it too, and it never fails |
| `pnpm --filter @buildanagent/manual tokens` | Regenerates `src/styles/tokens.css` from `book-tokens.json` |
| `pnpm --filter @buildanagent/manual anatomy:css` | Regenerates `src/styles/anatomy.css` from the vendored anatomy kit's `iso.css` |
| `pnpm --filter @buildanagent/manual figures:build` | Runs every figure script, the book's and the two fixture books', and writes its SVG or fragment beside it |
| `pnpm --filter @buildanagent/manual figures:audit` | Proves every isometric figure with the anatomy skill's geometry audit and its line check in both themes; needs Chrome |
| `pnpm --filter @buildanagent/manual exec wrangler dev` | Serves the built `dist/` locally as Cloudflare would, with the `_headers` rules and the 404 page; it needs no Cloudflare login |

## The outline places the chapter and gives it its number

Each chapter lives at `src/content/chapters/<slug>.md`, and its page is `/<slug>/`. Its slug must appear in [`src/outline.ts`](src/outline.ts), which lists the two parts and their chapters in reading order. The chapter's number is its position there, counted across both parts, so moving a chapter in the outline renumbers it, its figures, listings and tables, and every reference to them. The contents page lists every chapter in the outline, as plain text until its file exists. Each chapter also needs its fact-check log at `fact-checks/<slug>.md`, and `check:book` fails without it ([`fact-checks/README.md`](fact-checks/README.md)).

The outline also gives each chapter its opening type: `scenario`, `incident`, `question`, `fact`, `code` or `analogy`. `check:book` fails when two consecutive chapters share an opening type, or when one type opens more than a quarter of the chapters, rounded up.

## The front matter is strict, and the chapter ends with exercises

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
- `switchTo` lists the todos whose code will join the chapter's `verify/` listings as a first tab, while the `verify/` listings stay (BK8); it may be empty.

The chapter's last `##` section is `## Exercises`, and it holds a list and nothing else: `check:book` fails on a paragraph or a box after the list, which would render inside the exercises. The layout adds the chapter's sources after it, so the chapter has no sources section of its own.

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

`kind` is `docs`, `repo`, `paper`, `spec` or `post`, and an optional `version` holds a tag or commit. `verifiedIn` is a path from the repository root, and it must name a fact-check log. Four kinds count: a `fact-check*.md` file under `docs/research/` or in `docs/plans/reviews/`, a `docs/reference/<sdk>/fact-check.md`, and a chapter's own log in `apps/manual/fact-checks/`. That log must contain the URL, whether as an inline link, a bare URL or a reference-style definition. To cite a new source, first add its row to the chapter's fact-check log, `apps/manual/fact-checks/<slug>.md`, then add the entry with that log as `verifiedIn`. Set `"secondary": true` when the check rests on a search summary or a secondary write-up; the sources page then says so.

## References name an id, and the build writes the number

Mark a numbered block with a container directive, its caption in brackets and its id after `#`:

```markdown
:::figure[The loop runs until a stop condition holds]{#tool-call-round-trip}
::svg{alt="What the drawing shows"}
:::

:::table[How each SDK stops the loop]{#stop-defaults}
| SDK | Default cap |
| --- | --- |
:::

:::listing[One model call]{#one-call}
…a fenced code block…
:::
```

Ids are kebab-case and unique across the book for each kind. A table must hold a table and a `:::listing` a code block, and every block needs a caption. Refer to a block with `[[fig:tool-call-round-trip]]`, `[[tbl:stop-defaults]]` or `[[lst:one-call]]`, and to a chapter with `[[ch:tools]]`. The build replaces each reference with a numbered link such as "Figure 3.2"; a reference to a planned chapter shows its number without a link. An unknown id or a malformed reference fails with the file and line. Inside code, both reference and citation syntax stay as written. A `:::listing` with its code in the chapter suits a snippet that runs nowhere; code a reader should trust comes from a real file through `::listing`, described next. A figure holds its generated drawing, as [the figures section](#a-figure-is-a-script-that-draws-an-svg-and-the-build-inlines-it) describes.

## A listing shows a region of a real file

A listing shows only code that CI type-checks and runs, because the build cuts it from a real file instead of taking it from the chapter. The chapter names the file and a region in it with a leaf directive, written with two colons:

```markdown
::listing[One model call]{#one-call file="verify/vercel-ai-sdk/examples/01-generate-text.ts" region="call"}
```

The file marks the region with comments on their own lines, which change nothing when the example runs:

```ts
// #region call
const { model, requests } = scripted(["Hello from the mock."]);
const result = await generateText({ model, instructions: "You are terse.", prompt: "Say hello." });
// #endregion
```

The build cuts the lines between the markers, drops any markers of regions nested inside, removes the indentation the lines share and highlights them with Shiki. The caption line shows the number, such as "Listing 1.1", then the caption you wrote, the file's path, the line range and the pinned version of the harness's main package, such as `ai@7.0.162` as of November 2026. Each code line also shows its own number in the file. Without `region`, the listing shows the whole file without its markers. References use the same id as any listing, `[[lst:one-call]]`.

Region names are kebab-case and unique in their file, and an `// #endregion` may repeat its name (`// #endregion call`). The build finds markers line by line without parsing the code, so a line inside a template literal or a block comment that starts with `// #region` also counts as a marker.

The pin comes from the harness's own `package.json`. [`src/data/harnesses.json`](src/data/harnesses.json) names each `verify/` harness's main package, such as `ai` for `verify/vercel-ai-sdk`. The weekly SDK-update job rewrites those pins, so each caption follows the harness's current pin; prose that names a version still says "as of <month year>".

The book loads every listing before it renders a page, so `check:book` and the build fail on the same problems, each named with the chapter's file and the directive's line. A listing fails when:

- its file is missing, its path is not a plain path from the repository root (it is absolute, or holds `./`, `..` or `//`), or the file resolves through a symbolic link to a place outside the repository;
- the file is not TypeScript (`.ts`, `.tsx`, `.mts` or `.cts`), or no workspace package's `typecheck` covers it, as the next paragraph explains;
- the file sits in no harness that `harnesses.json` lists, or the harness's `package.json` lacks the main package or pins it as a range instead of an exact version;
- the region is missing, empty or malformed (an unnamed or repeated `#region`, an `#endregion` without its `#region` or naming another one, a `#region` never closed), and such a message also names the file's own line;
- the directive lacks a caption or `file`, or takes an attribute other than `id`, `file`, `region` and `replay`, the last of which takes no value.

A file counts as covered when `pnpm typecheck` would check it. Its nearest `package.json` must match a glob in `pnpm-workspace.yaml` that no `!` glob cancels, and one `tsc -p <config>` in that package's `typecheck` script must hold the file in its program. To decide, the check runs the manual's own `tsc`, from its exact `typescript` devDependency, as `tsc -p <config> --listFilesOnly`. TypeScript therefore applies `extends`, `files`, `include` and `exclude` itself, and a file that an included example imports also counts.

Five of these rules are our choices, not BK9's: an exact pin, TypeScript files only, paths from the repository root only, a file inside a harness that `harnesses.json` lists, and no attribute but `id`, `file`, `region` and `replay`, which catches a misspelt `region`. Because of the harness rule, a listing from `packages/` fails as "in no harness", so the todo that adds our own packages' listings to a chapter as tabs must widen that rule first.

To add a listing, mark the region in the example, run that harness's `pnpm test` to confirm its results do not change, then write the directive and run `check:book`. Renaming or deleting a region breaks every chapter that lists it, and `check:book` names each one. When a chapter's `switchTo` todos are all done, `book:switch-report` says the chapter is ready for tabs on our own packages (BK8).

## Notes, SDK tabs and replays make a listing interactive

A file listing can carry three kinds of interaction, BK9's tiers, and each one reads in full with JavaScript turned off. All three build on the same `::listing`, so `check:book` and the build check them as they check the listing, and each problem names the chapter's file and line.

### Notes explain marked lines

An example marks a line by ending it with a `// book:note <id>` comment. The chapter then writes the listing as a container and gives one note for each marker:

```markdown
:::listing[The loop runs until the model answers]{#tool-loop file="verify/vercel-ai-sdk/examples/02-tool-loop.ts" region="loop"}
::note[The model's first answer asks for the tool.]{#first-call}
::note[The loop stops when the model answers with text.]{#stop}
:::
```

The build takes each marker off its line, highlights the line and puts a numbered marker at its end. The marker links to its note, and the notes form a numbered list under the code, in the order of their markers in the file. A note is Markdown, so citations, glossary terms and references in it work as in a paragraph. Because the marker sits on the line itself, a note follows its line when the file changes around it.

A listing fails when a note names an id that no marker in its lines carries, when a marker in its lines has no note, when a note repeats an id or lacks text, and when the container holds anything but notes. A marker fails, with the file's own line, when its id is not kebab-case, when its id appears twice in the file, or when it stands on a line of its own instead of ending a line of code. One rule is our choice: a listing that gives no notes shows its marked lines plainly, so one chapter can annotate a region that another lists bare. Like region markers, a marker is found by its text, so `// book:note` inside a string also counts.

### Tabs show one concept in several SDKs

A `:::tabs` block holds two or more file listings, usually from different harnesses:

```markdown
:::tabs
::listing[AI SDK]{#approval-ai file="verify/vercel-ai-sdk/examples/03-tool-approval.ts" region="approval-response"}
::listing[OpenAI Agents SDK]{#approval-openai file="verify/openai-agents-sdk/examples/05-approval-resume.ts" region="approve-resume"}
:::
```

Each listing keeps its own number, path and pin, and its caption names its tab. Without JavaScript the listings follow one another, each under a heading made from its caption, one level below the heading the block follows. Because the heading shows the caption, the caption line below it shows only the number, path, lines and pin. The chapter's "On this page" list leaves these headings out. With JavaScript, `scripts/tabs.ts` turns those headings into a tab list that the arrow keys, Home and End move through. The block fails when it holds anything but file listings, holds fewer than two, or has a caption of its own.

### A replay steps through a recorded run

Add `replay` to a file listing, and the page shows the recorded run of its example beside the code:

```markdown
::listing[One model call]{#one-call file="verify/vercel-ai-sdk/examples/01-generate-text.ts" region="call" replay}
```

The run comes from `verify/<sdk>/results/transcripts/<example>.json`, which the harness's `pnpm test` writes and CI's results-drift check keeps current, so a replay cannot drift from its code. Without JavaScript the replay lists every event of the run: the messages the example sent, the model's answers, each tool call and result, and each `check()` with its outcome. With JavaScript, `scripts/steps.ts` reveals one event at a time, with back, next, restart and play, and marks the listing line that each event came from. Each event also says where it came from, with or without JavaScript: "line 6" for a line the listing shows, "line 42, outside this listing" for one it leaves out, and "no source line" when the transcript names none. Neither script makes a network request, and `test/page-scripts.test.ts` checks that in happy-dom.

The replay shows a request's new messages only. When a request resends messages the replay already showed, as when a handoff gives the conversation to another agent, they fold into one "History" event that counts them. A part that the format has no shape for, such as Pi's system prompt sections or the text LangChain's fake model makes up, shows under a name a reader can follow. A body longer than 600 characters stops there and says how many more it holds, a limit that is our choice.

A replay fails when the transcript is missing or malformed, when it records another file, and when it was recorded at a pin other than the harness's current one. The pin check covers both the harness's main package and the package its recorder attaches to, which the transcript names as `mock`, and rerunning the harness's `pnpm test` fixes a stale pin. Six harnesses record transcripts: `vercel-ai-sdk`, `pi`, `openai-agents-sdk`, `langchain`, `google-adk` and `cloudflare-agents`. An example that calls no model, such as `cloudflare-agents/examples/01-state.ts`, has no transcript, and the Claude Agent SDK and Copilot SDK wait for [T49](../../docs/todos/ready/T49-book-http-mock-transcripts.md). The transcript format lives in [`scripts/transcripts/events.ts`](../../scripts/transcripts/events.ts), with its recorder and writer beside it.

## A box sets a passage apart from the chapter's argument

A box holds material that a reader can skip without losing the thread, such as Chapter 1's account of how the examples run without a key. Write it as a `:::box` container with a title and an id:

```markdown
:::box[How these examples run without a key]{#how-these-examples-run-without-a-key}
Every listing in this book runs against a mock model, …

::listing[The scripted mock behind this chapter's AI SDK listings]{#scripted-mock file="verify/vercel-ai-sdk/examples/lib/check.ts" region="scripted"}
:::
```

The page renders the box as an `<aside>` whose `aria-labelledby` names its title, and the title is a heading that carries the box's id, so a link to `#how-these-examples-run-without-a-key` lands on the title. Where the box sits sets the title's level:

- A box marked `top`, written `:::box[Title]{#id top}`, is a top-level box: its title is a level-2 heading, so the box stands beside the chapter's sections and the chapter's "On this page" list shows it. `top` is a bare flag with no value, and the box must sit directly in the chapter, not inside another block. Chapter 1's box is marked `top`, so it stands beside its sections.
- A box without `top` sits inside its section, wherever it falls: its title is a heading one level below the heading the box follows, as a tab heading is, and "On this page", which shows only level-2 headings, leaves it out. A box that ends a section, or follows another box, is still one level down.

Position never decides the level; only `top` does. Two examples:

```md
## A section

Text.

:::box[A side note]{#a-side-note}
Skippable material, an h3 under the section.
:::

:::box[How these examples run]{#how-these-examples-run top}
Skippable material at the chapter's top level, an h2 listed in "On this page".
:::
```

To move a box into its section, drop `top`; to lift it to the top level, add it.

Inside, a box takes any Markdown: paragraphs, citations, glossary terms, analogies, references and file listings, which are numbered and checked like any other. A `:::listing` container with notes fits inside too, once the box's fence has four colons, `::::box`. So does a `:::tabs` block inside a `::::box`, and its tab headings sit one level below the box's title. The box draws a thin card border in the rule colour, which is decorative, and a 4px left rule in the muted text colour, which marks its boundary at 7.22:1 on the light page and 6.94:1 on the dark one, above WCAG 1.4.11's 3:1. A listing inside keeps its own panel in both themes. In print the border takes the muted text colour, and the title stays on the same page as the text after it. The box needs no script and writes no inline style.

A box fails when its id is missing or not kebab-case, when it takes any attribute but its id and `top`, when `top` has a value (`top=x`), when a `top` box sits inside another block, when its title is missing or blank, when it holds nothing, and when it holds a heading or another box. It also fails when its id repeats another id on the page, such as `#exercises`, the slug of `## Exercises`, or `#lst-greet`, the id of Listing `greet`. The check covers every id on the page, from heading slugs to ids in a listing's raw HTML, so two boxes cannot share an id either. These rules are our choices. The heading rule keeps the title as the one heading a box adds to the page's outline.

## The live run compares the listed examples with real APIs, only when the owner starts it

Every listing runs against a mock model, and CI never holds a provider key. Once in a while the owner checks that the mocks still behave like the real APIs, with a workflow that only they can start and approve ([book plan BK18](../../docs/plans/build-book.md#bk18-an-occasional-live-run-compares-real-flows-with-the-mock-transcripts-accepted)). `.github/workflows/live-run.yml` runs the examples in [`src/data/live-examples.json`](src/data/live-examples.json) against the real APIs and compares each run's flow with the example's mock transcript. A pull request then records the date in [`src/data/live-comparison.json`](src/data/live-comparison.json), which pages show beside the listings the live run covers.

### What a page says

A chapter page with a file listing opens with one of three lines. When one of its listings shows a file the live list names, the line is "Listings on this page are verified against mock models; last compared with live APIs on 1 December 2026", or ends "not yet compared with live APIs" before the first complete run. When the live list names none of the page's files, the line is "Listings on this page are verified against mock models only", because no comparison covers them. A listing whose file the live list leaves out also carries "Verified against mock models only" in its caption. Every `google-adk` listing carries that caption, because the harness's pinned TypeScript release reaches only Gemini. Adding a provider package or a Gemini key is a separate change the owner approves. The build reads both files when it loads the book, fails on a date that is not `YYYY-MM-DD`, and clears its content cache when either file changes.

### What the owner sets up once

The workflow relies on these exact names and settings:

1. **The `live-run` environment**, with the owner as its required reviewer, **Allow administrators to bypass** turned off, and **Protected branches only** as its deployment branches. That setting admits every protected branch, so the run is safe only while `main` is the one protected branch. Before it receives its key, each provider's job reads the environment and the protected branches through GitHub's API. It stops when the owner's review is no longer required, when administrators can bypass it, or when a branch other than `main` is protected. A custom deployment policy that names only `main` would admit `main` alone, whatever else is protected. Switching to one also means changing the pre-run check, which expects "Protected branches only".
2. **Two environment secrets in `live-run`**: `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. No other provider key appears in the workflow, no other workflow names either one, and each provider's job names only its own. GitHub releases them only after the owner approves the jobs. An Anthropic key that belongs to no workspace also needs an `anthropic-workspace-id` header, which the live run doesn't send, so use a key scoped to one workspace.
3. **A monthly spend limit at each provider**, the hard ceiling on what a run can cost: on the Anthropic workspace the key belongs to (Console → Spend limits → Workspace limits) and on the OpenAI project its key belongs to (the project's hard spend limit, which stops its traffic once reached). The run's own cost guard catches our mistakes, not malicious package code, as the next section explains.
4. **The pull request token**, `SDK_UPDATES_TOKEN` or else `RELEASE_PR_TOKEN`, the repository secrets `sdk-updates.yml` already uses ([CI plan §3c](../../docs/plans/ci.md#3c-weekly-sdk-updates-added-2026-11-19)), so `ci.yml` runs on the results pull request.

### How to start a run and read its results

Start it from **Actions → live-run → Run workflow** on `main`, or with `gh workflow run live-run.yml --ref main`, then approve the `live-run` deployments when GitHub asks. Two jobs hold keys, one per provider, each on its own runner. Each job writes its key to a file that only the runner's user can read. `scripts/live/run.mjs` then reads the file, deletes it, and runs that provider's listed examples one after another, each through its harness's `scripts/run-examples.mjs --live`. The report job, which holds no key and runs no package code, then does the rest:

- **The run's summary and the provider jobs' reports** show each example's outcome, its checks passed, its model calls and the amount spent, against the job's share of the $1.00 cap and the run's $0.50 target.
- **An issue**, opened only when a flow differs, lists each difference by example: a changed sequence of tool calls (by name and argument keys), a changed stop reason, or a `check()` that changed result or did not run. Text, argument values, ids and timing never count. A real model varies between runs, so a difference is a prompt to look at the live transcript beside the mock one, not proof that a mock is wrong. The run stays green either way. The live jobs' text reaches the issue only inside code blocks that it can't close, with every @ mention broken, and a transcript may name tools and argument keys only with letters, digits, `_`, `.` and `-`.
- **A pull request** from `live-run/results` holds the live transcripts in `verify/<sdk>/results/live/<example>.json`. When both provider jobs completed every example, it also holds the date, which the report job takes from its own clock. Merge it to move the date on the listing pages.

### What a run may cost

The owner's rule is that a run may cost at most $1.00 and should aim for less than $0.50. Each provider's job may spend half of the cap, so the two together stay within $1.00. Before every model call, the harness's live mode projects the call's cost from the gateway's price catalog: every input token at the dearest input rate, plus the call's whole `maxTokens` at the output rate. When the job's spend so far plus that projection would pass its share, the call never goes out, the job stops, and its report names the call. A streamed call that fails or is cancelled counts at its projection. The list as committed projects $0.2207 a run at the catalog's prices as of November 2026. The projection counts twice each example's mock model calls, at 8,000 input tokens a call. The three Anthropic examples, on `claude-haiku-5-5` with 1,024 output tokens a call, project $0.0381; the two OpenAI examples, on `gpt-5.4-mini` with 2,048, project $0.1826.

That guard protects against our own mistakes, such as an example that loops or a model that answers at length. It can't contain malicious package code. The example's process must hold the key to call the provider, so code that runs there, a pinned dependency included, can read the key, call the provider without the guard, or misreport its spend in the ledger that `run.mjs` reads. The provider's spend limit is therefore the hard ceiling, and the owner sets it once (above).

### Changing the live list

An example may join the list when its harness has a live mode and a mock transcript, its tools are in-process functions with no host access, and its provider is one its harness's pinned packages reach. Five harnesses have a live mode: `vercel-ai-sdk`, `langchain`, `pi`, `openai-agents-sdk` and `cloudflare-agents`. The Claude Agent SDK and Copilot SDK record no mock transcript yet, so a live run of theirs would have nothing to compare with; [T49](../../docs/todos/ready/T49-book-http-mock-transcripts.md) adds their transcripts and then their live mode. After an edit, run `node --test scripts/ci/live-run.test.mjs`: it fails until the recorded `projection` matches the list, and it names the figures to write. An example whose checks test the mock's exact wording will differ on every run, so prefer examples whose checks test the flow, as the five triage capstones do.

## Code in the prose resolves to a listing, a transcript, a `.d.ts` or the standard library, or cites a fact-check row

Inline code that names an API is checked like code in a listing, by the owner's rule ([BK17](../../docs/plans/build-book.md#bk17-code-in-the-prose-is-checked-like-code-in-a-listing-accepted)). The check reads two kinds of span. An identifier or a dotted member path, such as `generateText`, `result.steps` or `response.json()`, is checked by every name in it; a name after a dot is a property, whatever it spells, so `part.type` is checked by `part` and `type`. Any other span is checked when the TypeScript compiler parses it as code, such as `stopWhen: isStepCount(5)`, `maxTurns = 10` or `` `hi ${name}` ``: every identifier in it counts, labels, property names, type names and a template literal's expressions included, but no string or number. Each name must appear in one of four places:

1. **The chapter's file listings.** Every identifier, keyword and string the listed lines hold counts, property names included, read with the TypeScript compiler from the real file. A name that only a comment holds, or that the file holds outside the listed region, does not count.
2. **Their transcripts.** The transcript of each listed example, whether or not the listing replays it, gives its tool names, message roles, stop reasons and `check()` messages.
3. **The `.d.ts` exports of the packages they import.** The compiler resolves each package import from the listed file, so the harness's own `node_modules` and the package's `exports` map pick the `.d.ts`. The compiler then lists the module's exports after every `export *` and re-export. Only exports count, by their exported names. An option such as `maxTurns`, which a type declares as a member, is no export, and a default export counts as `default`, not as its local name.
4. **The standard library their harnesses compile against.** By the owner's decision of 2026-11-19, built-ins resolve: a global that TypeScript's library declares, as the nearest `tsconfig.json` above the listed file selects it with `lib` and `types`. A harness that extends the workspace's base config gets ECMAScript 2024 and Node.js's globals, so `Promise`, `fetch` and `process` resolve, but `document` does not. A member path whose root is such a global resolves through the global's type, so `JSON.parse` resolves by both names. An environment variable is no property, because `process.env` has only an index signature, so `OPENAI_API_KEY` and `process.env.OPENAI_API_KEY` need a listing or a marker, as any other name does.

A name found in none of them fails `check:book` and the build at the chapter's line, and the message names every listing, transcript, package and library searched. To keep such a name, check it by hand, log the check as a row of the chapter's fact-check log, and cite the row right after the span:

```markdown
The run stops once it has spent `maxBudgetUsd`{checked=row-12}.
```

The marker must touch the span, with no space between them. The cited row must appear once in `fact-checks/<slug>.md` with a ✅ or ✏️ verdict. A ⚠️ row, a missing row, a row numbered twice, a malformed marker and a marker that stands apart from its span all fail. The page shows the code without the marker, and a marker may follow any inline code.

The check also fails when a listed file imports a package whose types it cannot read: no `.d.ts` resolves, as when the harness is not installed, or the `.d.ts` declares its module only ambiently, with `declare module`, so it has no exports to list.

Three skip patterns leave a span alone, and `test/checked-code.test.ts` tests each one:

- **Shell commands:** a span that starts with `git`, `node`, `npm`, `npx`, `pnpm`, `tsc` or `tsx`, the workspace's own toolchain, such as `pnpm test`.
- **File paths:** a span with a slash and no space, or a dotted name without `()` that ends in one of 20 file extensions, such as `package.json` or `AGENTS.md`.
- **Literal values:** a number, a quoted string, a template literal without `${…}`, `true`, `false`, `null`, `undefined`, `NaN` or `Infinity`.

The test fixes each list in full, so any addition shows up in review; add a command when a chapter first needs it. Keep the lists short, or the rule loses its force. Two kinds of span are not code and go unchecked: a reserved word alone, such as `const` or `await`, and arithmetic notation, which joins plain names and numbers only with `^`, `+`, `-`, `*`, `/` or `**`, such as `pass^k` or `n - 1`. Assignments, updates, unary, logical and nullish operators, `typeof` and `as` are code, so `maxTurns = 10`, `a ?? b` and `foo as Bar` are checked. A span the compiler cannot parse is not checked either, and fenced code in a `:::listing` comes from no file, so its names do not count.

The workspace's typescript 7.0.2 exports no stable compiler API, only `./unstable/*` clients that run the native compiler in a child process. The check therefore reads code with typescript 6.0.3, installed as `typescript-api`, which is our choice. The compiler loads on first use: a process that renders no chapter, such as `book:switch-report`, never loads it, but a build loads it once the book has a file listing, because the render dependencies read each listed file's imports. A standard library loads only when a name resolves nowhere else. One book load parses each listed file once and lists each package's exports once, however many spans need them. `astro.config.mjs` hashes each written chapter's fact-check log, each listed example's transcript and each listed file's nearest `tsconfig.json` with its other render inputs. The render dependencies name each package a listing imports at the version its harness resolves. An edit to any of these inputs renders every chapter again.

## A figure is a script that draws an SVG, and the build inlines it

Each flat figure is a TypeScript script, and the SVG it writes is committed beside it. A test redraws every figure and fails when a committed SVG differs from what its script draws now, so a figure cannot drift from its script. The build inlines the SVG instead of linking it, so the figure takes the page's colours in both themes and needs no JavaScript. To add a figure to a chapter:

1. Write `figures/<chapter slug>/<figure id>.ts`. Its default export draws the figure with [`figures/lib/svgkit.ts`](figures/lib/svgkit.ts) and returns it; [`figures/call-workflow-loop/who-decides.ts`](figures/call-workflow-loop/who-decides.ts) is the sample.
2. Run `pnpm --filter @buildanagent/manual figures:build`, which writes `<figure id>.svg` beside every script. Commit both files.
3. Place the figure in the chapter with its caption, its id and its alt text:

   ```markdown
   :::figure[A call, a workflow and a loop differ in who decides the next step]{#who-decides}
   ::svg{alt="Three columns of boxes joined by arrows: a call, a workflow and a loop."}
   :::
   ```

The kit throws while drawing, naming the figure, when a mark breaks one of its rules:

- A label uses a character that the embedded code font lacks, such as `↺`; the message names the character and its code point. The font is the upright Manual Code subset in `public/fonts/`, so the check matches what readers see.
- The figure is wider than 520 units, the widest a chapter's figure panel shows whole at desktop widths. This limit is our choice.
- A mark leaves the canvas, a label is wider or taller than its box leaves room for, two labels overlap, or a line or curve crosses a label.
- `connect()` joins two boxes that overlap or share no band across the gap between them, or an arrow is shorter than twice its head.
- An id does not start with `<figure id>--`. Inlined figures share the page's id space, and kebab-case ids never hold `--`, so two figures cannot clash.

The figure colours its marks with the `fig-*` classes in `src/styles/components.css`, never with colour attributes. The kit measures labels at those classes' font sizes. Each committed SVG also embeds the code font as a data URI and the panel tokens of both modes, so the file renders on its own, for example in a pull request. The build drops that `<style>` element when it inlines the figure, because the page serves the same font and tokens and its content security policy allows no inline style. A change to the kit, the `fig-*` rules, the tokens or the code font therefore makes the figures stale: rerun `figures:build`. The font makes each committed SVG about 61 KB, but no page carries it.

A page shows a figure at its natural size, so its labels stay at 12 px, the approved phone label size, on every screen (BK11). Where the panel is narrower than the figure, as on a phone, the drawing keeps its size and the panel's drawing area, the stage, scrolls sideways. A figure never splits into a second drawing, and none of this needs JavaScript. The note "Scroll sideways to see the whole figure →" shows under the drawing exactly when the stage overflows, because the note's animation runs on the stage's scroll timeline, which stays inactive while nothing scrolls. A browser without scroll-driven animations never shows the note, but the stage still scrolls. The stage takes keyboard focus on every screen, since CSS cannot make it focusable only while it overflows, and the figure's caption names it for screen readers.

The inlined drawing may hold only what the kit writes: `g`, `rect`, `path`, `circle` and `text` elements, the kit's attributes, and links to ids inside the figure. A script, an image, a `foreignObject`, a second `<style>`, an event handler or a link elsewhere fails the build, so a hand-edited SVG cannot put script or outside content on a page.

The build and `check:book` fail, with the chapter's file and line, when a figure lacks its alt text or its caption, or holds anything besides one `::svg` or `::viewer`. They also fail when its SVG is missing or was drawn for another figure. Figure numbers come from the outline, like every other block's.

### An analogy illustration names its register entry

An analogy illustration is a figure marked with the analogy it draws (BK22):

```markdown
:::figure[A kitchen ticket rail: the cook works one ticket at a time]{#ticket-rail analogy="kitchen-ticket-rail"}
::svg{alt="Three order tickets hang from a rail…"}
:::
```

The register entry must name this figure as its `illustration`, and the caption must start with the analogy's name. The page then adds a link from the caption to a note under it that says where the analogy breaks, taken from the entry's `breaks`. The build fails when the entry is missing or names another figure, when the caption starts with anything else, and when a figure that an entry names as its illustration lacks the mark. The sample is Chapter 1's [`figures/call-workflow-loop/ticket-rail.ts`](figures/call-workflow-loop/ticket-rail.ts), which the book's register names as the kitchen ticket rail's illustration. Both fixtures draw the same figure from that script, register the analogy in their own `analogies.json` and keep their own SVG, so the build test checks it on a built page.

## An isometric figure is drawn with the anatomy skill and proved by its audits

A few chapters get an isometric centerpiece, an interactive drawing of a small machine (BK10). Each is a script like a flat figure, but it draws with the anatomy skill vendored in [`.agents/skills/anatomy/`](../../.agents/skills/anatomy/SKILL.md), pinned at upstream commit `1482e84` ([THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)). Read the skill's `SKILL.md` and `references/craft.md` before designing one. One rule in them gives way to the book's: the skill allows at most one engraved label in a drawing, but a book figure may label each of its real parts, by the owner's decision of 2026-11-19 ([BK10](../../docs/plans/build-book.md#bk10-flat-diagrams-and-a-few-isometric-centerpieces-accepted)). To add an isometric figure to a chapter:

1. Write `figures/<chapter slug>/<figure id>.ts`. Its default export builds the camera with the kit's `fitProjection`, makes the audit's `recorder`, draws every part through `IsoParts` from [`figures/lib/isokit.ts`](figures/lib/isokit.ts), and returns an `IsoFigure` with the card's title, hint and readout. `IsoParts` draws each slab or cylinder with the kit and records the same shape for the audit, so the audit checks what the page shows. A part whose name starts with `stand.` is the ground, and every other part must rest on one that leads to it. Chapter 1's [`loop-bench.ts`](figures/call-workflow-loop/loop-bench.ts) is the book's centerpiece, and the fixture book's smaller [`loop-bench.ts`](test/fixtures/book/figures/first/loop-bench.ts) is the sample the tests use.
2. Run `figures:build`, which writes `<figure id>.html`, the kit's card around the drawing, beside the script. Commit both files; the staleness test covers fragments as it covers SVGs.
3. Run `figures:audit`. For every isometric figure it runs the skill's geometry audit, which must print `audit passed`, then the skill's `scripts/lines.mjs` on a light and a dark check page, which must each print `line ends: 0`. The line check needs Chrome; set `CHROME_PATH` if the skill's search does not find it. The book's CI job runs the same command.
4. Place the figure with `::viewer` where a flat figure has `::svg`:

   ```markdown
   :::figure[The agent loop's bench: context, model and tool, each with a lamp]{#loop-bench}
   ::viewer{alt="An isometric bench with three stations: …"}
   :::
   ```

The build inlines the fragment in the chapter, with no iframe, on the same scrolling stage as a flat figure, so the drawing keeps its natural size and its labels never shrink under 12 px. The alt text goes first, as a visually hidden paragraph, and the drawing itself is hidden from screen readers. The card's top-left corner shows the figure's number. The first paint is complete: the static page already shows the first step's part lit and its readout. Where parts carry `data-iso-step` and `data-iso-readout` attributes (pass them as `attributes` to `IsoParts`), [`src/scripts/iso-figures.ts`](src/scripts/iso-figures.ts) walks through the steps, moves the lit part and the readout, and adds Play and Next step buttons. It plays only while the card is on screen and starts paused when the reader prefers reduced motion. Without JavaScript the reader sees the first step and no buttons.

The fragment may hold only what the kit writes for a card and its drawing. Its elements are `figure`, `div`, `span`, `svg`, `g`, `path`, `circle` and `text`, each with the attributes and values the kit writes, and its ids start with `<figure id>--`. Its `data-*` attributes come from a closed list, each with the values it may take: the kit's tones, shades, flags and card corners, the part names `isokit.ts` writes, and the step number and readout text that `iso-figures.ts` reads. Anything else fails the build, for example:

- a script, an event handler, a link or a `url()`;
- a style element or attribute;
- an image, an iframe or a second drawing;
- an entity the kit never writes, in text or in a value;
- a self-closing tag outside the drawing, which HTML would ignore.

Flat SVGs and fragments go through one checker, `src/book/markup.ts`, and each kind adds its own allowlist. Two kit helpers write inline styles, `fadeLineSvg` and pulsing dots, so a book figure cannot use them, because the page's content security policy allows no inline style.

Ids need a prefix only when a page shows a figure twice. A chapter page shows each figure once, and figure ids are unique across the book, so a chapter's ids keep their names. The component gallery shows Chapter 1's centerpiece, [`figures/call-workflow-loop/loop-bench.ts`](figures/call-workflow-loop/loop-bench.ts), once per theme, so each copy's ids take the theme as a prefix. Under `BOOK_FIXTURE_DIR` it shows the site fixture's sample instead, and the build test checks its prefixed ids.

[`src/styles/anatomy.css`](src/styles/anatomy.css) gives the drawing its colours. `anatomy:css` generates it from the kit's `iso.css`: it keeps the kit's rules for parts, drops the kit's grey palettes, card and phone layout, and maps every `--anatomy-*` colour to the panel tokens of each mode, as [`src/design/anatomy-css.ts`](src/design/anatomy-css.ts) lists. `hi` is the panel text and `mid` the panel comment colour. The one lit part is outlined in the panel's terracotta and its faces are tinted with it, so even a small part reads as the lit one. The side shades and faint lines are `color-mix()` blends of panel tokens. The tops lighten toward the page colour, our choice: the page is lighter than the panel in both modes, while the panel's lighter tokens are text colours or, in dark mode, the decorative grid and border. No hex value leaves `tokens.css`. A test fails when the file is stale, so rerun `anatomy:css` after updating the vendored skill.

An isometric analogy illustration is an isometric figure with the analogy mark, checked against the register like a flat one; the fixture book's [`tally-counter.ts`](test/fixtures/book/figures/first/tally-counter.ts) is the sample. The site fixture re-exports both samples, so the build test sees them on a built page, and `figures:audit` proves each drawing once.

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

The chapter then marks each use with `:analogy[the ticket rail]{#kitchen-ticket-rail}`. A later chapter refers back to the same analogy by the same id; it may not name an analogy from a later chapter. `illustration` is the id of a figure in that chapter, or `null`; that figure carries the analogy's mark, as the figures section describes. The check compares analogies and concepts without case, punctuation or a leading article. It fails on the same analogy listed twice, on an analogy that explains a second concept, on a concept given a second analogy, and on a chapter that names an id the register lacks. It cannot tell that two different phrasings describe nearly the same image, such as a kitchen ticket rail and a waiter's order spike, so reviewers catch near-duplicates when they vet a chapter's analogies.

## The content model lives in `src/book/`

The outline checks, the three registers, the index that numbers blocks and the listing resolver live in `src/book/`, and the Markdown plugins that use them in `src/markdown/`. `check:book` loads the outline and the three registers, then renders every chapter through the build's own plugins and prints each problem as `file:line: message`. The tests run the same plugins on the fixture book in `test/fixtures/book/`, with one failing fixture for each rule `check:book` applies. That directory is also its own repository root, holding a workspace of one harness, `verify/demo-sdk`, whose example the second chapter lists. When the content model, a plugin, the outline, a register, another chapter's numbered blocks, a body's line offset, a listed file, its harness's pin or a replayed transcript change, `astro.config.mjs` clears Astro's content cache, so no chapter keeps stale numbers, links, listings or error lines.

The build reads chapters from `src/content/chapters/` and their logs from `fact-checks/`, unless `BOOK_FIXTURE_DIR` names a directory that holds `chapters/`, `fact-checks/`, `figures/` and `analogies.json`; the build then reads all four from there. Only the tests set it, pointing it at `test/fixtures/site/`, whose stand-in chapter uses every feature the build test checks, and any build that uses it says so on stderr. The book's `figures/` therefore holds only the book's own figures; the site fixture's scripts draw Chapter 1's two flat figures and the fixture book's two isometric samples by importing their scripts. The citation, glossary and figure plugins, the strict schema, the text splitter, the figure kit and its staleness check are adapted from the owner's garment engineering textbook and are licensed Apache-2.0 only ([THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)).

## The tokens come from one JSON file

`scripts/generate-tokens.ts` reads `book-tokens.json` and writes `src/styles/tokens.css`. The generated file puts the light page and light panel values on `:root` and on any `[data-theme="light"]` element. The dark values apply under `prefers-color-scheme: dark`, unless the reader chose light, and on any `[data-theme="dark"]` element. Because the panel tokens follow the same rule, a code or figure panel always matches its page: a light panel framed by `#E4D6C2` in light mode, C1 Ember in dark mode.

Four checks in three test files guard the file. First, `test/tokens.test.ts` fails when the committed CSS differs from what the script writes, and when a page or panel token has a value in one mode only. Second, `test/contrast.test.ts` reads every pair from the JSON file's `contrast` lists and recomputes its WCAG ratio from the colours the CSS ships. It fails below 4.5:1 for text and below 3:1 for focus rings, and it fails when a recorded ratio differs from the recomputed one at two decimals. Third, `test/styles.test.ts` fails when a stylesheet or component writes its own hex colour. Fourth, the same file fails when a decorative token colours anything but a border or a background.

To change a token, edit the JSON file, update its recorded ratio if a colour changed, then run `pnpm --filter @buildanagent/manual tokens`.

## Where each token may be used

| Custom property | Use it for | Never use it for |
| --- | --- | --- |
| `--color-text`, `--color-text-soft`, `--color-text-muted` | Body text; ledes and side notes; labels, numbers and control borders | Text on a panel |
| `--color-accent` | Labels, figure numbers and the focus ring | Body text |
| `--color-link` | Links, which keep their underline in both modes because neither link colour is 3:1 apart from body text | Anything that is not a link |
| `--color-rule` | Dividers and card borders | Text, focus rings or a line that carries meaning |
| `--panel-text`, `--panel-comment` | Code and figure text on a panel; comments, line numbers and panel labels | Text on the page |
| `--panel-amber`, `--panel-olive`, `--panel-terracotta` | Keywords, strings and highlights on a panel; the terracotta bar that marks a highlighted line | Text on the page |
| `--panel-grid`, `--panel-border` | The grid paper behind a figure and the panel's edge | Text, focus rings or a line that carries meaning |
| `--font-display`, `--font-body`, `--font-code` | Headings and chapter links; body text and notes; listings, labels and figure captions | |
| `--size-*`, `--line-height-body` | Type sizes, which scale from the phone value at 360 px to the desktop value at 1280 px | |
| `--page-width`, `--measure`, `--side-note-width`, `--gutter` | Direction C's widths: the page, the article column, the side-note margin and the side gutter | |

A figure colours its parts with the `fig-*` classes in `src/styles/components.css`, not with `fill` and `stroke` attributes, so every figure colour stays in a stylesheet that the style test reads.

## The fonts are self-hosted subsets

The site serves Instrument Serif, Literata and Google Sans Code from `public/fonts/`, so a reader's browser fetches nothing from another origin. The files come from [google/fonts](https://github.com/google/fonts) at the commit `fonts/sources.json` records. That file is the one list of the families. For each family it records the upstream folder and the SHA-256 of each upstream file, the served folder and file names, the licence files and, for Google Sans Code, the neutral name. Two scripts rebuild the served files, and both run only when a font changes:

```sh
cd apps/manual
node scripts/fetch-fonts.mjs
uv run --no-project --with fonttools==4.68.0 --with brotli==1.2.1 \
  python -I scripts/subset-fonts.py fonts/sources.json fonts/upstream public/fonts
```

`fetch-fonts.mjs` downloads the upstream files into the gitignored `fonts/upstream/` and refuses a file whose hash differs from the manifest; after a re-pin, `--record` writes the new hashes. `subset-fonts.py` writes WOFF2 subsets with Latin, punctuation, arrows, maths and box-drawing characters, and copies each family's `OFL.txt` beside them.

Google Sans Code's `TRADEMARKS.md` keeps the Google mark off modified versions, so its subsets are named Manual Code in their files, their CSS and their name tables. Instrument Serif and Literata keep their names, because neither licence reserves a font name and neither family has a trademark file; the owner chose to keep Literata's name on 2026-11-19. [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) records the licences. `test/fonts.test.ts` checks the licence files, and it reads each subset's WOFF2 name table to check the family names and that no Manual Code name record mentions Google.

### What a page downloads

The subsets, as committed, weigh:

| File | Bytes | Preloaded |
| --- | --- | --- |
| `instrument-serif/instrument-serif-regular.woff2` | 23,024 | Yes |
| `instrument-serif/instrument-serif-italic.woff2` | 24,128 | No |
| `literata/literata-roman.woff2` | 145,056 | Yes |
| `literata/literata-italic.woff2` | 149,452 | No |
| `manual-code/manual-code-roman.woff2` | 42,228 | No |
| `manual-code/manual-code-italic.woff2` | 46,048 | No |

`layouts/BaseLayout.astro` preloads the two files every page paints first: the title in Instrument Serif and the body in Literata's roman, 168 KB together. The other four load when a page first uses them.

Literata stays variable on both its axes, optical size (7–72) and weight (200–900), because the plan sets no narrower range, though narrowing both axes would roughly halve the body font. T2 measured the trade on a smaller Latin subset: the full axes took 125,796 bytes; limiting weight to 300–700 took 116,524 bytes; limiting weight to 400–700 and optical size to 12–36 took 65,596 bytes. A later todo can narrow the axes if the chapters never use the extremes.

## The components work without JavaScript

Each component in `src/components/` renders its full content with no script. A few then add behaviour as progressive enhancement, and their buttons render with `hidden` until the script shows them:

- **Layout:** `SiteHeader`, `ChapterHead` (the wide title), `Sidebar` with `Contents`, the article column in `layouts/ChapterLayout.astro`, and `PrevNext`. The columns switch with container queries on the `.layout` element, not with viewport media queries, so the layout follows the width it is given: the sidebar joins at 64rem and the side-note margin at 69rem.
- **Code:** `ListingBlock` with `AnnotationMarker` and `Annotations`; `Tabs` with `TabPanel`, which show every panel under its own heading until `scripts/tabs.ts` builds the tab list; `Replay` with `StepControls`, which `scripts/steps.ts` steps through. A chapter's notes, `:::tabs` and replays render the same markup from `listing-html.ts` and `replay-html.ts`, and `ChapterLayout` loads both scripts.
- **Figures:** `FigureFrame` on grid paper, which becomes the isometric stepper when it has steps; `scripts/steps.ts` then shows one step at a time and dims the figure parts of the others. `GeneratedFigure` puts a figure from `figures/` in a `FigureFrame`, inlined as a chapter's is; the gallery uses it.
- **Prose:** `SideNote`, `GlossaryCard`, `GlossaryTerm` (its card opens on hover and focus and stays open while the pointer is on it, and `scripts/glossary.ts` lets Escape close it), `Citation` and `SearchBox`. A chapter's box has no component: the Markdown pipeline writes its `<aside>` ([A box sets a passage apart](#a-box-sets-a-passage-apart-from-the-chapters-argument)).
- **Theme:** `ThemeToggle`, driven by `public/scripts/theme.js`, which applies a stored choice before the first paint. The button shows a sun in the dark theme and a moon in the light one, and its accessible name gives its action, "Switch to light theme" or "Switch to dark theme". Both follow the system setting while the reader has stored no choice.

The gallery at `/gallery/` renders every component in both themes, one above the other at full width, so each shows the layout at the width a reader sees it. It stays out of the search index and carries `noindex`. Its citation and glossary samples link to the `/sources/` and `/glossary/` pages. The owner compares the gallery with the reference board after any design change.

## The book deploys from main's workflow, and a pull request only ever gets a preview

GitHub Actions publishes the book, not Cloudflare's own Git integration. Two workflows split the work so that no pull request can change a job that holds a Cloudflare token ([book plan BK15](../../docs/plans/build-book.md#bk15-an-assets-only-worker-on-a-custom-domain-behind-a-guard-and-a-switch-proposed)). First, `book-build.yml` builds the site with no secrets on every pull request and every push to `main`, and uploads `dist/` as the `book-dist` artifact. Second, `book-deploy.yml` runs after each build finishes. GitHub always runs that second workflow from the file on `main`, so editing it on a branch changes nothing until the branch merges.

`book-deploy.yml` never checks out or runs a pull request's code. It takes the artifact and the build's commit SHA from the triggering run, and everything else from `main`: `wrangler.jsonc`, `public/_headers`, the scripts and Wrangler itself. It has six jobs. `resolve` runs first and decides which of the three deploy jobs runs. Two comment jobs then follow the preview and its deletion:

1. **`resolve`** names no environment and holds no Cloudflare secret, so it has no secrets check. It asks GitHub's API whether a push is still `main`'s newest commit, which open pull requests from a branch of this repository have the build's commit as their head, or which closed pull request a `book-pr-closed` run belongs to. If the API call fails, the job fails and nothing deploys.
2. **`production`** deploys to manual.buildanagent.fyi with `wrangler deploy`, from the `book-production` environment. It runs only for a push to `main` from this repository, only while the variable `BOOK_DEPLOY_ENABLED` is `true`, and only for `main`'s newest commit. A fork's branch named `main` never reaches it, and a running deploy is never cancelled.
3. **`preview`** runs `wrangler preview --name pr-<number>` from the `book-preview` environment, for each open pull request whose head is the build's commit and whose branch lives in this repository. The preview is served at `https://pr-<number>.manual.buildanagent.fyi`, and each commit's deployment also gets its own address, `https://<deployment id>.manual.buildanagent.fyi`, where the id is 8 lowercase hex digits, such as `https://40f313de.manual.buildanagent.fyi`. Cloudflare's docs give `<deployment id>-<preview name>` instead, but Wrangler 4.160.1 printed the shorter form for the first preview, so the workflow accepts only the shorter form. If the preview job warns that Wrangler reported the preview's URL but no commit URL of that form, Cloudflare has changed the id's form. Update the pattern to match in both places in `book-deploy.yml`, the record step and the comment script. A push to `main` gets no preview, because it already deploys production or is held back on purpose. Preview URLs are public, like the book.
4. **`delete-preview`** runs `wrangler preview delete` from the `book-preview` environment when a pull request closes.
5. **`comment`** and **`comment-deleted`** keep one comment on the pull request with the preview's addresses, as [the comment section](#each-previews-addresses-go-into-one-comment-on-its-pull-request) describes.

Each pull request has its own queue, shared by its previews and its deletion. A preview and its deletion therefore never overlap, and no other pull request's run can replace one that is waiting.

A fork's pull request gets no preview and no comment. A preview job holds a token that can also deploy the production Worker, and a fork's artifact holds whatever the fork wrote, so the book previews only branches of this repository, whose authors can already push to it (the owner's decision, 2026-11-19). To preview a fork's change, a maintainer pushes it to a branch here and opens a pull request from that branch.

Before Wrangler runs, `scripts/stage-dist.mjs` checks the artifact, because a pull request's build may have put anything in it. The script reads the zip itself and refuses the whole artifact if an entry escapes `dist/`, is a symbolic link or a dot file, is a file Cloudflare reads as configuration (such as `_redirects`), or breaks Cloudflare's limits of 25 MiB per file and 20,000 files. It skips the artifact's own `_headers`, refuses a `_headers` directory, and writes `main`'s copy in its place. For a preview, it runs with `--preview` and adds `X-Robots-Tag: noindex` to that copy's `/*` rule, because Cloudflare adds the header to `workers.dev` previews but not to previews on a custom domain. Production never gets it.

Next, `scripts/guard-deploy.mjs` refuses a deploy unless seven rules hold. Six are settings in `wrangler.jsonc`: exactly the one custom-domain route with `previews_enabled: true`, no `main`, `assets.directory: "./dist"`, `not_found_handling: "404-page"`, `workers_dev: false` and `preview_urls: false`. `preview_urls: false` keeps every preview off `workers.dev`. The seventh rule is that `dist/_headers` matches `public/_headers`, or, with `--preview`, matches it plus the one `X-Robots-Tag` line. Without `--config`, Wrangler looks for a `wrangler.json` in this directory and every one above it before it reads `wrangler.jsonc`, so every Wrangler call passes `--config wrangler.jsonc`. The guard also refuses when any other Wrangler config, or a `.wrangler/deploy/config.json` redirect, sits in `apps/manual/` or a directory above it. The guard is adapted from the owner's garment engineering textbook and is licensed Apache-2.0 only ([THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)).

Deleting a preview needs a third workflow, `book-pr-closed.yml`, because GitHub runs a `pull_request` workflow from the pull request's merge commit, so an unmerged branch supplies the file. A job there that held the preview token would run whatever a branch wrote into it, and a fork's run gets no secrets, so a fork's preview would never be deleted. `book-pr-closed.yml` therefore holds no secret and does nothing but finish. Its run starts `book-deploy.yml` from `main`, which finds the closed pull request through the API and deletes its preview.

Every page gets the headers in [`public/_headers`](public/_headers). The content security policy allows only the book's own origin: scripts, styles, fonts, fetches and Pagefind's worker all come from it, and no inline script or style runs. Pagefind's search also needs `'wasm-unsafe-eval'` to compile its WebAssembly, and `data:` images for its search icon. `Strict-Transport-Security` keeps browsers on HTTPS for a year, for manual.buildanagent.fyi and any name under it, the previews included; it leaves out `preload`. Files under `/_astro/`, whose names carry a content hash, are cached for a year.

**A preview runs its branch's own code in the browser.** Each preview is served on its own hostname under manual.buildanagent.fyi, so its scripts run on an origin apart from the book's. The book sets no cookies and has no sign-in, so a preview's script finds nothing of the book's to read.

### Each preview's addresses go into one comment on its pull request

After a preview deploys, the pull request gets a comment from `github-actions[bot]` that holds three things: the short SHA of the commit it shows, the preview's address, `https://pr-<number>.manual.buildanagent.fyi`, and that commit's own address. The preview's address follows the pull request's newest commit; the commit's own address keeps showing that commit. Each later preview edits the same comment instead of adding one. When the pull request closes and its preview is deleted, the comment changes to say the preview is gone. The comment carries no `workers.dev` address and so no part of the Cloudflare account's subdomain.

The URLs pass from the preview job to the comment job with no new permission for the job that holds the token:

1. Wrangler writes what it deployed, as JSON lines, to the file that `WRANGLER_OUTPUT_FILE_PATH` names. A step with no secret then keeps only the two URLs of the exact forms above and uploads them as the artifact `book-preview-urls-<number>`, one per pull request, because a matrix job's outputs would overwrite each other. A failed preview uploads nothing, so the comment never shows an old address as new.
2. The `comment` job holds `pull-requests: write` and nothing else: no environment, no secret, no checkout. It downloads that artifact, checks both URLs again, and writes only while the pull request is open with this commit as its head. It edits only a comment that `github-actions[bot]` wrote and that starts with the hidden marker `<!-- book-preview -->`, so a person's comment that quotes the marker stays as it is.
3. `delete-preview` uploads `book-preview-deleted-<number>` only when its deletion worked, and `comment-deleted` then edits the comment. It never creates one.

The comment's text is fixed in the workflow, and nothing in it comes from the pull request: no branch name, no title. Every failure in the comment script warns and stops without failing the run, so a comment never holds up a deploy.

## What the owner sets up

The owner creates every piece below; the workflows only use them, by these exact names. Until a piece exists, the job that needs it stops at its first step, which names the missing secret and links here. This repository can therefore merge the workflows before the setup is done.

| Where | Name | What it holds or allows |
| --- | --- | --- |
| Cloudflare | the `buildanagent.fyi` zone | In the account both tokens belong to. `manual.buildanagent.fyi` must have no CNAME record, because Cloudflare refuses a custom domain on a hostname that has one. No DNS record or certificate is needed for the previews: Cloudflare creates the wildcard record and certificate for `*.manual.buildanagent.fyi` itself |
| Cloudflare | the Worker `buildanagent-manual` | Created once by hand, or by one first deploy with a short-lived token that has Workers Admin. Workers Editor cannot create a Worker, so neither stored token needs Admin |
| GitHub environment | `book-production` | Deployment branches: protected branches only, which here means `main`. Secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |
| GitHub environment | `book-preview` | Deployment branches: protected branches only, which here means `main`. Secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, its own token |
| Production token, in `book-production` | An account-owned API token | Account › Workers › Editor, plus Zone › Workers Routes › Write on the `buildanagent.fyi` zone. The zone permission is needed whenever a deploy changes the custom domain, which includes the first deploy with `previews_enabled`; between such changes it can be removed |
| Preview token, in `book-preview` | An account-owned API token | Account › Workers › Editor, scoped to the Worker `buildanagent-manual`, with no zone permission. Creating a preview on the custom domain changes no domain setting |
| GitHub repository variable | `BOOK_DEPLOY_ENABLED` | `true` turns production deploys on |

`CLOUDFLARE_ACCOUNT_ID` is the ID of the account that owns the zone and the Worker. Both tokens are account-owned, because Wrangler needs that kind for per-Worker permissions. Cloudflare's [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/) page lists what each role allows.

**`book-preview` must allow protected branches only, like `book-production`.** Its token holds Editor on the book's Worker, which can also deploy to production. Without the rule, any workflow on a branch of this repository could name `book-preview` and read that token. `book-deploy.yml` runs from `main`, so the rule leaves its previews working. The owner set it on 2026-11-19.

One risk remains, accepted: the preview job handles a branch's artifact while it holds that token. Cloudflare's Workers roles have no permission for previews alone, so the token could also deploy the production Worker. Only branches of this repository get a preview, so only people who can already push here can supply that artifact. The artifact check, the guard and `main`'s own Wrangler also stand between the artifact and the token, and no code from the artifact ever runs in the job.

Before the first deploy, check by name that each environment holds both secrets and that both allow only protected branches. Then watch the first production deploy and one pull request's preview: the site should serve the book with the `_headers` values, and the preview should carry `X-Robots-Tag: noindex`.

**Custom-domain previews start with the next production deploy.** `previews_enabled` and `preview_urls: false` change the Worker's settings, and only `wrangler deploy` sends them; `wrangler preview` does not. Until the production job runs once with this config, previews deploy with no address on manual.buildanagent.fyi, the preview job warns, and no comment appears. To turn them on:

1. Give the production token Zone › Workers Routes › Write on `buildanagent.fyi`, if it was removed.
2. Set `BOOK_DEPLOY_ENABLED` to `true`, if it is not, and push to `main` or rerun the latest `book-deploy` run for `main`. The deploy prints a note that the previews' DNS and certificate may take a few minutes.
3. Open a pull request from a branch of this repository and check that the comment's two addresses serve the book with `X-Robots-Tag: noindex`.

The first preview on the custom domain, pull request #89's on 2026-11-19, served both of its addresses with `noindex`.

The same deploy turns off the old `workers.dev` previews. Any still listed stop serving there. A branch's old preview is deleted when its pull request closes, and a fork's, which the workflow no longer deletes, goes when Cloudflare's limit of previews per Worker removes the least recently deployed one.

**To pause production,** set `BOOK_DEPLOY_ENABLED` to anything other than `true`, or delete it. Pushes to `main` still build the book and pull requests still get previews; the `production` job is skipped until the variable is `true` again.
