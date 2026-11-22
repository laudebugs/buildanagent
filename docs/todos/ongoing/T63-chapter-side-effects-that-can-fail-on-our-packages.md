# T63: Add our own packages to Chapter 16's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T63` |
| Status | `ongoing` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T23](../done/T23-chapter-side-effects-that-can-fail.md), [E1](../done/E1-safety-core-outcomes.md), [E2](../done/E2-effect-identity-crash-rule.md), [E3](../done/E3-signed-approvals-third-party.md), [E4a](../done/E4a-plan-approval-record.md), [E4b](../done/E4b-ordered-plan-execution.md), [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md) |
| Size | M |

## Goal

Chapter 16 ("Side effects that can fail") shows third-party listings only. This todo adds our own packages as the first tab of every listing they can show (ADR 0057, BK8) and keeps the third-party tabs unchanged.

## Scope

Chapter 16 has six listings, all third-party. Our packages can show all six: the SDK's tool pipeline carries write outcomes and signed pauses, and `@buildanagent/agent-safety` supplies `guardedWrite()` and the effect store. Its `package.json` is private and it has no `examples/` folder, so the examples live in `packages/sdk/examples/`, which already lists `@buildanagent/agent-safety` as a dev dependency and whose recorder the listing rule accepts. A tab's caption shows the SDK's version; the prose names agent-safety as the package that holds the write guard.

**In scope**

| Listing | Stays | Our tab, first |
| --- | --- | --- |
| `#write-tool` (replay) | `verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts`, region `write-tool` | A `defineTool()` charge tool with `effect: { kind: "write" }` whose `execute` calls `guardedWrite()`: the record is stored first, the server is asked under the effect key, and the outcome settles the record |
| `#effect-log` | same file, region `effect-log` | Reading one operation's state from its `EffectStore` record: none, `started` (so `unknown`) or `settled` with its outcome |
| `#crash` | same file, region `crash` | The first attempt's `settle()` never returns after the server's reply, which stands in for a process killed at that point; the record is left `started` and the server holds one write |
| `#resume` | same file, region `resume` | A second run after the lease lapsed: `guardedWrite()` calls `reconcile`, the server confirms, no second write |
| `#needs-approval` | `verify/cloudflare-agents/examples/06-tool-approval.ts`, region `needs-approval` | A `beforeToolCall` gate that returns `ask` when a refund's amount is above 100 |
| `#paused` | same file, region `paused` | The run ends `awaiting_approval` with a signed pending request, and the refund has not run |

- New examples in `packages/sdk/examples/`: a payment-server stand-in in `lib/`, the charge tool in its own file, `11-charge-crash-resume.ts` and `12-approval-gate.ts`, run offline by `test/book-examples.test.ts`, with their transcripts in `results/transcripts/`.
- The prose, notes and fact-check rows the tabs change.

**Out of scope, and why**

- A real `SIGKILL` of a child process, as the third-party tab does. A book example writes no file and may not hold a durable store of its own, so the tab stands in with a store whose `settle()` never returns. `packages/agent-safety/test/crash.test.ts` kills a real process, and the prose points to it.
- A listing of `runPlan()` and the signed plan approval. The chapter's last section has no listing of its own, because no third-party SDK models a plan. A new listing with no third-party tab belongs to its own todo; the prose names the package's plan approval.

## Tasks

- [x] Read the chapter, its log and the packages; write Scope and Tasks.
- [ ] Write the examples, with regions, notes, checks and transcripts.
- [ ] Turn each listing in the table into a tabs block with our tab first.
- [ ] Fact-check every changed claim into `apps/manual/fact-checks/side-effects-that-can-fail.md` as new rows, and update the tally.
- [ ] Update the plan's row and `apps/manual/README.md` if the listing rule needs a word.

## Acceptance criteria

- [ ] See the Scope section once written.
