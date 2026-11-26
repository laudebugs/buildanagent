# N35: Harness triage capstone, second-process resume and the granularity test (HD1)

| Field | Value |
| --- | --- |
| ID | `N35` |
| Status | `done` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N29](../done/N29-stdio-transport.md), [N30](../done/N30-cli.md), [N34](../done/N34-ablation-switches.md), [B19](../done/B19-triage-capstone.md), [B20](../done/B20-versioning-docs.md) |
| Size | M |

## Goal

Run the SDK's triage capstone inside the harness end to end, resume its approval from a second process over stdio, replay it byte for byte, and settle HD1 by recording it at three granularities.

## Context

- [build-harness.md §5.4](../../plans/build-harness.md#54-the-harness-triage-capstone-checks-the-whole-stack-against-the-sdks-capstone): the capstone rows
- [SDK plan §5.3](../../plans/build-sdk.md#53-the-triage-capstone-checks-the-whole-sdk-against-the-reference-capstones): the SDK capstone
- [HD1](../../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-decided-by-n35): the decision and its evidence

## Scope

**In scope**

- `packages/harness/examples/triage-session.ts` using the B19 capstone's tools on the harness
- Approved, rejected and policy-changed-after-pause cases
- A second process (`buildanagent rpc`) resolving the pause
- Playback and the byte-identical check
- An HD1 note: file size, playback fidelity and resume code size at per-delta, per-block and per-message granularity
- Recorded sessions saved as offline replay fixtures for N36
- The final `initialize` capability list from B20

**Out of scope** (and which todo covers it)

- Real-model runs (N38)

## Tasks

- [x] Port B19's capstone tools into `packages/harness/examples/triage-session.ts` and register them with no built-ins.
- [x] Run the approved, rejected and policy-changed-after-pause cases on `ScriptedModel` through `runTurn()`.
- [x] Resolve the pause from a second process over `buildanagent rpc`, and check the call ran once.
- [x] Play the session back and compare the files byte for byte.
- [x] Scan every entry and span for the provider key and the injected credential.
- [x] Write the per-delta and per-message recorders as test-only observers; keep only per-block in the package, and write the HD1 note.
- [x] Save the recorded sessions as N36's replay fixtures, and check `initialize` against B20's `CAPABILITIES`.

## Acceptance criteria

- [x] All capstone rows in §5.4 pass on `ScriptedModel`
- [x] The second-process resolution runs the approved call once
- [x] Playback is byte-identical
- [x] No provider key or injected credential appears in any entry or span
- [x] The HD1 note exists and ADR 0013's status reflects its result
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/capstone.test.ts`.

## Docs to update

`packages/harness/README.md`: the capstone; ADR 0013 status. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

If B19's capstone changes shape, adapt the tools, not the rows.

## Revision (2026-11-18, SDK gaps)

The rewind report found that the capstone has no crash test, so "exactly once" in our plans means "once, if nothing crashes" ([rewind report](../../research/reversible-actions/rewind-vs-rollback.md#two-ledgers-and-the-first-fields-to-add)). Gap 2 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) adds:

- [x] Kill the harness process after a fake external system accepts a write and before its `tool_result` is appended; the resumed session reconciles to `applied` and sends nothing twice.

The rule under test comes from the [N7](../done/N7-rebuild-resume-replay.md) revision, which N35 already follows through its dependencies.

## Outcome

The harness runs the SDK's triage capstone end to end on `ScriptedModel`, and every row of the plan's §5.4 table has a test. Per-block log entries stay: the granularity test found nothing per-delta keeps that playback reads, so HD1 is decided and ADR 0013 is no longer provisional.

- **Files.** The agent is `packages/harness/examples/triage-session.ts` (the harness, `startTriage()` and `answerTriage()`) and `packages/harness/examples/triage-tools.ts` (the registry and the output tool). The rows are in `packages/harness/test/capstone.test.ts`, with helpers in `packages/harness/test/capstone/`. The second process is `packages/cli/test/capstone-rpc.test.ts`.
- **Two example files, not one.** The guideline caps an example file at 100 lines, and the ported tools with the harness came to 119, so the tools moved to `triage-tools.ts` beside `triage-session.ts`.
- **The second process lives in the CLI's tests.** `@buildanagent/harness` can't depend on `@buildanagent/cli`, which depends on it, and the binary's flags can't carry the capstone's tools or a scripted model. The test therefore spawns a child that calls `runCli(["rpc", …])` on its own standard streams, as `bin.ts` does, with an environment of `PATH`, a temp `HOME`, `TMPDIR` and `LANG` only. A first in-process `rpc` leaves the pause; the child lists it in `initialize`, asks on `session/open`, and runs the approved page once. The CLI test rebuilds the two tools in `capstone-tools.ts`, because a package can't import another's examples.
- **No `zod` in the example.** The harness doesn't depend on `zod`, so the output tool is a `defineTool()` with a JSON Schema and `terminate: true`, which is what `outputTool()` builds.
- **The secrets.** The fixture's environment object holds a fake provider key, never `process.env`, whose provider variables the offline setup refuses. The fake pager echoes the injected token and the key in its receipt, which reaches the log in `tool_result.details` only, so the model never sees it and the recorded pairs stay clean. A store wrapper applies `scrubSecrets()` before every append, as the README asks a host to. The test finds neither secret in the files, the entries, the spans projected with `content: "attributes"` and `toolArguments: true`, or the pairs.
- **The crash test** uses a file effect store and a file pager under `test/capstone/crash-systems.ts`, and `guardedWrite()` with `dedupe: "reconcile"`. The child is killed with SIGKILL once the pager has the page; the resume settles the crashed call as `unknown` with `reconcile_first`, the repeated call reconciles to `applied` once the attempt's lease runs out, and the pager still holds one page.
- **Fixtures for N36** are in `packages/harness/test/fixtures/capstone/`: each case's session file and its model pairs (`<case>.jsonl`, `<case>.pairs.json`), which replay through the harness to the same bytes, and the HD1 report (`granularity.json`). The comparison ignores the SDK version, the defaults hash and the capability list, so a release alone does not fail it. The model pairs carry an `expiresAt` of 2027-11-25, so someone re-records them by then. The fixture prices its own model, so the costs in the log never move with the gateway's catalog.
- **HD1** keeps one entry per content block. The plan's HD1 records the sizes, the transcript match, the 56 delta boundaries and the decoder lengths, and its heading and every link to it now say "decided by N35".
- **The preamble** of the capstone's two tools and system prompt is 148 tokens, against 2,052 with the six built-ins.
- **`initialize`** answers with the SDK's `CAPABILITIES` unchanged, and the session header records the same list.
- **No changeset.** Nothing under `packages/harness/src`, `package.json` or `tsconfig.build.json` changed.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
