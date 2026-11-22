# What our repository already says about fine-tuning and model choice (as of November 2026)

Research notes, gathered 2026-11-19 from this repository on branch `todo/U21-research-fine-tuning-vs-prompting`, off `main` at `b5fc4f2`. Every claim cites a file in the repo.

## Takeaway

The repo says almost nothing about fine-tuning. A search for "fine-tun", "finetun", "distill" and "reinforcement fine" over `docs/`, `packages/` and `apps/manual/src` finds only passing mentions: a Hacker News title in the practitioner corpus, a Zapier testimonial, a fine-tuned detector in the browser-use report, and the book plan's own lines about U21 and T39. The plan places the topic as one section of Chapter T11, whose model-choice section follows OpenAI's guide: start with the most capable model, then try smaller ones against evals. Our gateway already treats a tuned model as one more model id, priced only if a catalog entry exists for it.

## The book plan and its todos

- §4.3 row: "Fine-tuning versus prompting | U21 | T39, a section of T11 | The question arises the moment a reader chooses a model, which Chapter T11 teaches" — [book plan §4.3](../../../plans/build-book.md#43-four-topics-need-research-before-they-are-written)
- T11's sections include "Choosing a model: start with the most capable, then try smaller ones against evals (OpenAI guide)" and its exercise: "Price a recorded run from its usage, then rerun it with a smaller model and compare the cost and the checks." Its listings include the streaming-and-usage example from T28 — [T11](../../../todos/done/T11-chapter-talking-to-a-model.md)
- T39's analogy: "sending an employee on a year-long course versus handing a skilled contractor a clear brief. Where the analogy breaks: a fine-tuned model also needs the brief; tuning changes defaults, not the need for instructions." Its risk: "The research may show the topic needs a chapter after all" — [T39](../../../todos/done/T39-section-fine-tuning-vs-prompting.md)
- T28 writes `verify/vercel-ai-sdk/examples/` code whose final usage "reports input, cached-read, cached-write and output tokens, and a price computed from them" — [T28](../../../todos/done/T28-example-streaming-usage.md)
- The highest todo id is T44 (`docs/todos/*/`), so T45 is the next free one.

## The book plan's fact-check of MAP

- Row 105: MAP found that "70% rely on prompting off-the-shelf models instead of weight tuning", verdict ✅, "a secondary reading of the paper's abstract, so U21 rereads the paper" — [book plan fact-check](../../../plans/reviews/fact-check-build-book.md)
- Row 174 re-read the abstract of v4 with `curl` on 2026-11-19 and found the quote verbatim: "U21 still reads the paper's body for its method" — same file
- The U17 report quotes the same sentence and describes MAP as "built on 20 case studies and a survey of 86 practitioners across 26 domains" — [source-update report](../../source-update-2026-11-19.md)

## The gateway

- `createModel()` looks the model up with `findCatalogEntry(catalog, adapter.provider, id)` and prices every call with that entry; a caller may pass its own `catalog` — `packages/gateway/src/create-model.ts`
- "a model the catalog lacks has an unknown price, never a guessed zero" — `packages/gateway/src/cost.ts`, header comment
- Without an entry, caps fall back to the adapter's `defaultCaps`, and without those `createModel()` throws `missing_caps` — `packages/gateway/src/create-model.ts`, `resolveCaps`
- A `CatalogEntry` records `asOf` and `sources` for its rates — `packages/gateway/src/catalog.ts`

## Our SDKs

- None of the eight agent SDKs we document trains models; each consumes a model by id. The OpenAI REST client `openai` 7.49.0 (installed beside `@openai/agents` 0.21.0 in `verify/openai-agents-sdk`) types `client.fineTuning` and `method.type: 'supervised' | 'dpo' | 'reinforcement'` — `verify/openai-agents-sdk/node_modules/openai/resources/fine-tuning/jobs/jobs.d.ts`, lines 268 and 516
