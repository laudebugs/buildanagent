# Fact-check: the examples guideline's testing exception

This log checks the claims that the examples guideline's new section makes on 2026-11-22. Each row names the file it describes.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| docs/examples-guideline-testing-subject-1 | `packages/sdk/examples/offline-order-agent.ts` scripts two model answers, runs the order agent, checks that the script ran out and returns the answer | ✅ | The file: a `ScriptedModel` of a `lookup_order` call and a text reply, `answerOrderQuestion()`, `adapter.assertComplete()` and `return answer` |
| docs/examples-guideline-testing-subject-2 | The example asserts nothing about the agent's output, and a test runs it and checks what it returns | ✅ | The file has no assertion; `packages/sdk/test/examples.test.ts` checks `answerOffline()` returns "Order 42 has shipped." |
| docs/examples-guideline-testing-subject-3 | A scripted model's `assertComplete()` checks that the run used the script up | ✅ | `packages/sdk/src/testing/scripted-model.ts`: `assertComplete()` throws for an unused step or a call past the last step |

**Totals:** 3 claims: 3 ✅, 0 ✏️, 0 ⚠️.
