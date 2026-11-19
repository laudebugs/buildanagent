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
- **MUST:** a code block of more than a few lines comes from a tested example file, which [examples.md](examples.md) governs, so the docs never show code that no longer runs.

## Reviewer checklist

- Could a newcomer follow this page from the one before it to the one after it?
- Does the first paragraph say what you'll build and why you'd want it?
- Is every term explained or linked where it first appears?
- Does any id, round or path leak into reader text?
