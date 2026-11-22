# T60: Add our own packages to Chapter 6's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T60` |
| Status | `ongoing` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T14](../done/T14-chapter-approvals-guardrails-and-injection.md), [B15](../done/B15-signed-pauses.md), [E3](../done/E3-signed-approvals-third-party.md), [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md) |
| Size | M |

## Goal

Chapter 6 ("Asking before acting") shows third-party listings only. This todo adds our own packages as the first tab of every listing they can show (ADR 0057, BK8) and keeps the third-party tabs unchanged.

## Scope

Chapter 6 has twelve listings. Our SDK, `@buildanagent/sdk`, can show the first three groups, and the rest stay single.

| Listing | Decision | Our tab, first |
| --- | --- | --- |
| `#policy-ai`, `#policy-openai`, `#policy-langchain` | Tabs | A tool and a `beforeToolCall` gate that returns `ask`, from a new `packages/sdk/examples/11-approval-resume.ts`, region `gate` |
| `#resume-ai`, `#resume-openai`, `#resume-langchain`, and `#approval-replay` | Tabs | The same file, region `resume`: the run ends `awaiting_approval`, the context goes through JSON, and `continueRun()` resumes it with an allow or a deny. The replay becomes a tabs block with our transcript first |
| `#tamper-ai`, `#tamper-openai` | Tabs | A new `12-approval-tamper.ts`: an edited saved input fails its signature check, the run asks again and nothing runs. Our SDK signs every pause without a setting, so the chapter's "depends on one setting" paragraph gains our case |
| `#guardrails-input`, `#guardrails-output`, `#injection-check` | Single | Our SDK has no guardrail feature: no input, output or tool guardrail objects, no tripwire exception and no parallel mode. Its checks are the six interceptors of [Chapter 10](../../../apps/manual/src/content/chapters/events-and-hooks.md), and the chapter says so plainly |

`packages/agent-safety` is private and has no `examples/` folder, and `apps/manual/src/data/harnesses.json` lists only the gateway and the SDK, so a listing cannot come from it. It does not need to: the SDK carries byte-identical copies of the signers and the pending record, and its tabs run that code (`packages/sdk/src/vendor/agent-safety/README.md`). The chapter says which package a claim rests on. A tab on the AI SDK adapter that agent-safety ships stays out, because the AI SDK tab already shows the signed case.

No package source changes. The new files are examples, their transcripts and their registration in the existing book-example runner.

## Tasks

- [x] Read the chapter, its log and the packages; write Scope and Tasks.
- [ ] Write `11-approval-resume.ts` and `12-approval-tamper.ts` with regions, notes and checks that can fail; run them offline and commit their transcripts.
- [ ] Turn the five listings above into tabs blocks with our tab first; update the prose and notes; say why the guardrail listings stay single.
- [ ] Fact-check every changed claim into the chapter's log as new rows, and update the tally.
- [ ] Move this file to `done/`, add an Outcome section and repoint the todo links.

## Acceptance criteria

- [ ] Each listing the Scope marks as tabs is a tabs block whose first tab comes from `packages/sdk` and whose other tabs are unchanged
- [ ] The guardrail and injection listings stay single, and the chapter states why
- [ ] Every API identifier in the chapter's new inline code resolves or cites a hand-checked row
- [ ] `check:book`, the manual's `test` and `build`, `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline, and the results-drift check reports no drift
