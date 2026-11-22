# T63: Add our own packages to Chapter 16's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T63` |
| Status | `done` |
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
- [x] Write the examples, with regions, notes, checks and transcripts.
- [x] Turn each listing in the table into a tabs block with our tab first.
- [x] Fact-check every changed claim into `apps/manual/fact-checks/side-effects-that-can-fail.md` as new rows, and update the tally.
- [x] Update the plan's row and the todo table.

## Acceptance criteria

- [x] Each listing in the table is a tabs block whose first tab comes from `packages/` and whose other tab is unchanged: same file, region, notes and replay
- [x] Every API identifier in the chapter's inline code resolves, or carries a hand-checked marker citing a ✅ or ✏️ row (BK17)
- [x] `check:book`, the manual's `test` and `build` pass
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root, and the results-drift check reports no drift

## Tests

The new examples in `packages/sdk/test/book-examples.test.ts`, the listing-rule tests in `apps/manual/test/`, and the book's CI job.

## Docs to update

- [Book plan](../../plans/build-book.md): the §4.2 row for Chapter 16's examples, and the todo table
- The chapter's source register: two new entries for the package READMEs the prose cites

## Risks and open questions

- Our packages are alpha (a `0.1.0-alpha` release as of November 2026), and `@buildanagent/agent-safety` is private and not on npm. The type-check and the results-drift check catch an API change, but each one then needs a chapter update.
- The crash tab simulates the kill. A real kill needs a durable store and a second process, which a book example may not hold, so the chapter says so and points to `packages/agent-safety/test/crash.test.ts`.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The examples.** `packages/sdk/examples/charge-tool.ts` (regions `write-tool` and `effect-log`: a `defineTool()` charge tool whose `execute` calls `guardedWrite()`, and a reader of one operation's effect record), `11-charge-crash-resume.ts` (regions `crash` and `resume`) and `12-approval-gate.ts` (regions `needs-approval` and `paused`), with `lib/fake-payments.ts`, a loopback payment server. The examples import `@buildanagent/agent-safety`, a dev dependency of the SDK, because that package is private and has no `examples/` folder or listing-rule entry. Each numbered file runs offline through `test/book-examples.test.ts`, and its transcript is in `packages/sdk/results/transcripts/`.
- **The chapter.** All six listings are tabs blocks with our tab first, headed "Our SDK", and the earlier listing beside it with its file, region and notes unchanged. Their captions became the tab names (`Vercel AI SDK`, `Cloudflare Agents`). The prose says what differs: the record and the lease against a log file, the stand-in for the kill, the lookup that throws on anything but a 404, and the pause that ends the run instead of blocking.
- **Not replayed.** Our `#write-tool` tab has no replay, because a replay needs a transcript recorded for the listing's own file and the tool sits in an un-numbered file that the runner does not start. The Vercel AI SDK tab keeps its replay.
- **A correction.** The chapter said our plan scopes any key by tenant and session. The package scopes a business-keyed write by tenant alone and an un-keyed one by tenant, session, branch and call id; the sentence now says so (row 46).
- **Plan approval.** The chapter has no listing of `signPlan()` and `runPlan()`, because no other tab has the feature; one paragraph names the four functions (row 56). A listing of them can follow in its own todo.
- **Fact-check.** Rows 44 to 56 of `apps/manual/fact-checks/side-effects-that-can-fail.md`: twelve ✅ and one ✏️ (row 46); the tally reads 56 rows.
