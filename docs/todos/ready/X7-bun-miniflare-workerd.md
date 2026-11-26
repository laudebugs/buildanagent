# X7: Find why Miniflare doesn't work under Bun

| Field | Value |
| --- | --- |
| ID | `X7` |
| Status | `ready` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | X6 |
| Size | L (a day: split it if you can) |

## Goal

[X6](../done/X6-bun-runtime-compatibility.md) measured that Miniflare (Cloudflare's local Workers simulator) fails outright under Bun: every `ECONNREFUSED` in `verify/cloudflare-agents` (13 of 13 examples), most of `agent-safety`'s Cloudflare-backed tests (28 of 28), and `harness/test/cloudflare/cloudflare.test.ts` (1 failure), all passing under Node on the same machine. This is the largest gap by test count of the nine X6 found. This todo finds why, and either fixes it or records that it's an upstream Miniflare/Bun limitation the project can't work around.

## Context

- [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 1: the measured failures, with exact test counts.
- `.bun-version`: the exact Bun build (`1.4.4`) to reproduce against.
- Miniflare's own issue tracker and changelog, for any open Bun-compatibility report.

## Scope

**In scope**

- Reproduce one Miniflare `ECONNREFUSED` under Bun with verbose/debug logging on, and find the actual point of failure: a port Miniflare expects to bind that Bun's networking layer handles differently, a `workerd` child process Bun's `spawn`/`spawnSync` starts differently than Node's, or something else.
- Check whether Miniflare or `workerd` has a documented or open Bun-compatibility issue upstream.
- If a workaround exists (a Miniflare option, a Bun flag, a different way to start `workerd`), apply it to `verify/cloudflare-agents`, `agent-safety`'s Cloudflare-backed tests and `harness/test/cloudflare/cloudflare.test.ts`, and confirm all three pass under Bun.
- If no workaround exists, record the root cause and the upstream issue (filing one if none exists) in CI plan §3h, and say so plainly rather than leaving the gap unexplained.

**Out of scope** (and which todo covers it)

- Any other X6 gap (X8–X15).
- Adding Bun as a deployment target or package manager; both still need their own decision first (AGENTS.md, ADR 0033).

## Tasks

- [ ] Reproduce the `ECONNREFUSED` under Bun with Miniflare's debug logging enabled; capture the exact failing connection (host, port, protocol).
- [ ] Trace whether Miniflare's own process/network setup differs when started by Bun vs Node (strace/dtruss, or Miniflare's own internals, as needed).
- [ ] Search Miniflare's and `workerd`'s issue trackers for existing Bun reports; file one if none exists and a root cause is found.
- [ ] If a workaround exists, apply it and re-run `verify/cloudflare-agents`, `agent-safety`'s Cloudflare tests and `harness/test/cloudflare/cloudflare.test.ts` under Bun to confirm.
- [ ] Update CI plan §3h's gap 1 with the finding (fixed, or upstream-blocked with a link).

## Acceptance criteria

- [ ] CI plan §3h's gap 1 is replaced with either a fix (and the three affected suites pass under Bun) or a confirmed, cited root cause with no workaround available.
- [ ] If fixed, `pnpm check`, `pnpm typecheck` and `pnpm test` pass under both Node and Bun for the touched packages.

## Tests

No new tests; existing Cloudflare-backed suites are the evidence, re-run under Bun once any fix lands.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 1 and the per-package failure table.

## Risks and open questions

- This may be a genuine upstream limitation with no workaround, in which case Bun support stays blocked on Miniflare/`workerd` regardless of what the rest of X7–X15 fix.
- **Who decides.** The owner decides whether to file or follow an upstream issue, and how long to spend investigating before accepting the block.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
