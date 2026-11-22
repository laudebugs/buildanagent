# Fact-check: the Vercel AI SDK write-crash example

This log checks the claims that `verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts` and its README section make on 2026-11-22 (todo T32), against the pinned `ai` 7.0.162 and the run itself.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| T32-1 | A tool's `execute` result reaches `result.toolResults[0].output`, and `isStepCount(5)` lets the loop make the second model call | ✅ | `ai`'s `index.d.ts` declares `isStepCount` and `StaticToolResult`; the example's checks read `toolResults[0]?.output` and the run passes |
| T32-2 | The AI SDK has no idempotency or effect-log feature | ✅ | `grep -i idempoten` over `ai/dist/*.d.ts` finds nothing; the example's key and log are its own |
| T32-3 | The five outcome names are `applied`, `not_applied`, `compensated`, `partial` and `unknown` | ✅ | `packages/agent-safety/src/outcome.ts` line 13, `OutcomeKind` |
| T32-4 | A process that is killed after the server's reply and before its log write leaves a key with no outcome, and a fresh run reconciles through the server and does not write again | ✅ | The example's checks: the child exits with `SIGKILL`, the log says `unknown`, the resume reports `applied` with `reconciled: true`, and the fake server holds one write for `charge:42` |
| T32-5 | A declined write is not a write | ✅ | The fake server answers 402 for order 13 without recording a write, and the example checks the count stays 1 |
| T32-6 | The child's transcript is not recorded, so the transcript holds the parent's model calls only | ✅ | `scripts/transcripts/record.mjs`: the recorder installs only when `$TRANSCRIPT_FILE` is set, and the child's allowlisted environment omits it |

**Totals:** 6 claims: 6 ✅, 0 ✏️, 0 ⚠️.
