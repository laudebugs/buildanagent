# Fact-check: the examples guideline's testing exception

This log checks the claims that the examples guideline's new section makes on 2026-11-22. Each row names the file it describes.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| docs/examples-guideline-testing-subject-1 | `packages/sdk/examples/offline-order-agent.ts` scripts two model answers, stubs the order store, runs the order agent, checks that the script ran out and returns the answer | ✅ | The file: a `ScriptedModel` of a `lookup_order` call and a text reply, a stub `findOrder`, `answerOrderQuestion()`, `adapter.assertComplete()` and `return answer` |
| docs/examples-guideline-testing-subject-2 | The example asserts nothing about the agent's output, and a test runs it and checks what it returns | ✅ | The file has no assertion; `packages/sdk/test/examples.test.ts` checks `answerOffline()` returns "Order 42 has shipped." |
| docs/examples-guideline-testing-subject-3 | A scripted model's `assertComplete()` checks that the run used the script up | ✅ | `packages/sdk/src/testing/scripted-model.ts`: `assertComplete()` throws for an unused step or a call past the last step |


## The book-example exception (docs/examples-guideline-book-exception, 2026-11-22)

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| docs/examples-guideline-book-exception-1 | `packages/gateway/examples/01-text-stream.ts`, `02-stream-usage.ts` and the numbered SDK files 01 to 09 import `check`/`scripted` from `./lib/check.js` | ✅ | grep of the `from "./lib/check.js"` lines in those files: 11 files import it; the other imports are `@buildanagent/gateway`, `@buildanagent/sdk` and `@buildanagent/sdk/testing`. `04-scripted-model.ts` builds its own `ScriptedModel` and imports `check` only |
| docs/examples-guideline-book-exception-2 | The `lib/` files import the shared recorder from `scripts/transcripts/events.js` | ✅ | `packages/gateway/examples/lib/transcript.ts` line 24 and `packages/sdk/examples/lib/transcript.ts` line 25; no example file imports it |
| docs/examples-guideline-book-exception-3 | A chapter's `::listing` directive names these files with a `region`; `06-tool-failures.ts` and `triage-agent.ts` are not listed | ✅ | grep of `file="packages/` in `apps/manual`: the listed files are gateway 01 and 02 and SDK 01, 02, 03, 04, 05, 07-identity-tool, 07-stop-step-cap, 08, 09; `06-tool-failures.ts` has no `// #region` and no listing |
| docs/examples-guideline-book-exception-4 | The package's `test/book-examples.test.ts` runs the numbered files, each in its own process, and fails on a non-zero exit | ✅ | `packages/sdk/test/book-examples.test.ts`: `BOOK_EXAMPLES` filters `/^\d{2}-[a-z0-9-]+\.ts$/`, and each runs through `spawn` with `tsx`; `packages/gateway/test/book-examples.test.ts` header describes the same |
| docs/examples-guideline-book-exception-5 | The book shows only the listed region and calls a listing verified code | ✅ | [build-book.md](../build-book.md) BK9: the example file marks a region and the build cuts it; goal paragraph: "Every code listing comes from a file that CI type-checks and runs"; ADR 0057 keeps listings beside ours |
| docs/examples-guideline-book-exception-6 | `maxSteps: 5, // book:note cap` appears in `03-tool-loop.ts` | ✅ | `packages/sdk/examples/03-tool-loop.ts` line 35 |
| docs/examples-guideline-book-exception-7 | The longest book example, `07-identity-tool.ts`, has 88 lines | ✅ | `wc -l`: 88; every numbered example and gateway 01 and 02 is at most 88 |
| docs/examples-guideline-book-exception-8 | `lib/check.ts` loads `@buildanagent/gateway/testing/setup`, which blocks non-loopback `fetch` and fails when a provider key is set | ✅ | `packages/gateway/examples/lib/check.ts` line 7 imports it; the setup's behaviour is stated in AGENTS.md (Layout, `packages/`) and `packages/sdk/examples/lib/check.ts` imports the gateway's setup in the same way |
| docs/examples-guideline-book-exception-9 | The recorder only reads each request and answer | ✅ | `packages/sdk/examples/lib/transcript.ts` header lines 3-4: "The recorder only reads the request and the stream's events, so the model answers as it would without it" |
| docs/examples-guideline-book-exception-10 | A `scripted()` call carries a `// book:note` marker in the listed regions | ✏️ | Not universal: `02-workflow.ts` lines 12-13 have none. Written as SHOULD, not MUST, and flagged to the owner |

**Totals:** 13 claims: 12 ✅, 1 ✏️, 0 ⚠️.
