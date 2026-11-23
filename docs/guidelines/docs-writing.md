# Docs people enjoy reading: plain English, a real task, an early result

Our docs exist so people can build agents with our packages. These rules apply to every page a user of the packages reads: each package's `README.md` today, and a docs site once we have one. Contributor documents under `docs/` (plans, ADRs, todos, research) follow [AGENTS.md](../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges) instead, because their readers are contributors and agents who need the ids and citations these rules ban. The rules adapt Lamina PDF's `docs-writing.md`.

Draft with `/anthropic-skills:writing` and review with `/anthropic-skills:writing-review`, as AGENTS.md requires for all copy. Where a writing finding conflicts with a rule here, the rule here wins; say so in the fix commit.

## Tell a story

- **MUST:** open every page with one paragraph of at most 50 words that says what the reader will build and when they would need it. Show the code next, then the details.
- **SHOULD:** end a page with a link to the page a reader needs next.

## Make it a pleasure to read

- **SHOULD:** build something a reader recognises, such as an agent that looks up an order and asks before it refunds, not `foo` and `bar`.
- **SHOULD:** show the result early: the events a run streams, the answer it returns or the error it prevents.
- **SHOULD:** talk to the reader as "you", in the present tense, the way a colleague explains something at their desk.
- **SHOULD:** keep each code block short enough to read without scrolling. Longer code belongs in an example file.

## Write in plain English

- **MUST:** keep every sentence to 40 words or fewer, and **SHOULD** keep it to 30.
- **MUST:** keep paragraphs to 100 words or fewer.
- **MUST NOT:** mention ADR numbers, decision ids (`D3`), todo ids (`B4`), round names, CI or repository paths in reader text. Contributors find those in `docs/`.
- **MUST:** use one term per thing. A model call that fails ends in an "error terminal" on every page; the strict test model is "`ScriptedModel`", never "the mock".
- **MUST:** explain a term where it first appears on a page, or link it to where it is explained.
- **MUST:** write headings in sentence case.
- **MUST NOT:** use "simply", "just", "easy", "obviously", "note that", "please", "etc.", "via", "utilize", or exclamation marks.

## Show code only from tested files

- **MUST:** put a sentence that says what the code does before every code block.
- **MUST:** a code block of more than five lines comes from a tested example file, which [examples.md](examples.md) governs, so the docs never show code that no longer runs. Until the first `examples/` folder exists, a README may show a longer block; [Known gaps](README.md#known-gaps) tracks it.

## Draw a diagram where a picture answers faster

The docs' figure pipeline checks three of these rules: the build fails on a figure without alt text or a caption, and a test fails on a colour that isn't a theme token ([apps/docs/README.md](../../apps/docs/README.md#draw-a-figure-with-a-script-and-the-build-inlines-it)). A reviewer applies the others by hand.

- **MUST:** add a figure only where a picture answers the reader's question faster than prose, and give each figure one idea. A point that needs "and" means two figures.
- **MUST:** write alt text that states the figure's point, such as "The loop calls tools until the model answers", never "Diagram of the loop". A reviewer reads the alt text alone.
- **MUST:** give every figure a caption. A reviewer checks that no figure on the page lacks one.
- **MUST:** set every label at 12 px or larger at the size the page shows it. A reviewer reads the rendered page on a phone.
- **MUST:** take every colour from the theme tokens, never a colour attribute or a hex value, so the figure follows light and dark mode.
- **MUST:** state in the page's text every fact a figure shows. A reviewer covers the figure and checks that the page still says it.
- **SHOULD:** add a text description beside a figure with more than five nodes. Five is our threshold for "more than a few".

## Use a callout for an aside, never for the point

Starlight's four kinds are note, tip, caution and danger. The docs test does not check callouts.

- **MUST:** use each kind for one job. A note adds skippable context. A tip gives a faster or safer way. A caution warns of a mistake that wastes time. A danger warns of an action that loses data, spends money or exposes a secret.
- **SHOULD:** keep a page to three callouts or fewer. A reviewer counts them.
- **MUST NOT:** put the page's main point in a callout. A reviewer deletes every callout and rereads the page.
- **MUST NOT:** nest a callout inside a callout. A reviewer looks for a callout block within a callout block.

## Use code tabs only for one task in two forms

The docs app has no tabs component. Its long-block test already fails any fence of more than five lines that lacks an examples file, so the tab-code rule is enforced today; a reviewer checks the rest by hand.

- **MUST:** use tabs only for the same task in different languages or runtimes, or for code and its output. A reviewer checks that each tab does what the others do.
- **SHOULD:** put the tab most readers need first. A reviewer checks that the first tab is the one the page's own examples use most.
- **MUST:** take every code tab of a page from its own example file, as [examples.md](examples.md) requires, and put a sentence before the tabs that says what the code does.

## Reviewer checklist

- Could a newcomer follow this page from the one before it to the one after it?
- Does the first paragraph say what you'll build and why you'd want it?
- Is every term explained or linked where it first appears?
- Does any id, round or path leak into reader text?
- Does each figure make one point in its alt text, carry a caption and leave no fact only in the picture?
- Is each callout an aside, and does the page teach its task without them?
- Do the tabs show one task in different forms, each from a tested file?
