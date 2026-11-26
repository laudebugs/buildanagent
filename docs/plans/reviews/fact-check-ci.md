# Fact-check: the CI plan's claims

This log checks claims [CI plan §3h](../ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) makes, from todo [X6](../../todos/done/X6-bun-runtime-compatibility.md) (rows X6-1 to X6-3), and the note on gap 8 that todo [X13](../../todos/done/X13-fact-check-log-string-raw-fixture.md) added (rows X13-1 to X13-5). Checked 2026-11-26; the X6 rows on branch `todo/X6-bun-runtime-compatibility`, off `main` at `209e060d`, and the X13 rows on branch `todo/X13-fact-check-log-string-raw-fixture`.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| X6-1 | Bun `v1.4.4` was published 2026-10-22, more than a week before this measurement (2026-11-26) | ✅ | `gh api repos/oven-sh/bun/releases/tags/bun-v1.4.4 --jq .published_at` returns `2026-10-22T10:11:32Z` |
| X6-2 | ADR 0033 fixes exactly four deployment targets (local Node, Cloudflare, AWS, Vercel) and names Bun as a candidate for none of them | ✅ | [ADR 0033](../../decisions/0033-three-deployment-targets.md), "Decision": "The SDK and harness support four targets: local Node for development, Cloudflare (primary), AWS and Vercel." No other target is named |
| X6-3 | The portable-agents report's recommendation 7 proposed typing the stdio transport over Web streams specifically so Deno, Bun and Workers could reuse it later | ✅ | [`portable-agents.md`](../../research/deployment/portable-agents.md), the recommendations table, item 7: "Type `stdioTransport` over Web streams, and move the WebSocket transport from non-goal to a later round \| harness §1, §3.5, N29 \| Deno, Bun and Workers reuse; cloud clients need it". A proposal, not a change already made |
| X13-1 | Bun 1.4.4 rewrites a non-ASCII character inside a `String.raw` template into the six-character text `\u2705` before `String.raw` reads it | ✅ | Run, 2026-11-26: a one-line script ``String.raw`✅` `` prints `"\\u2705"` under Bun 1.4.4 |
| X13-2 | `fact-check-log.test.mjs` lines 91 and 102 now hold ordinary double-quoted strings with doubled backslashes, and under Node each equals its old `String.raw` value | ✅ | [`fact-check-log.test.mjs`](../../../scripts/ci/fact-check-log.test.mjs) lines 91 and 102; commit `b0fff06a`; `===` against the old value, run under Node, 2026-11-26 |
| X13-3 | `fact-check-log.test.mjs` passes 24 of 24 under `node --test` and under `bun test` (three runs, Bun 1.4.4) | ✅ | Runs, 2026-11-26; before the change `bun test` gave 22 pass, 2 fail |
| X13-4 | `fact-check-log.mjs`'s `RANGE_SEP` is at line 45, uses `String.raw` with `–` and `—`, and `fact-check-log.mjs` is unchanged | ✅ | [`fact-check-log.mjs`](../../../scripts/ci/fact-check-log.mjs) line 45; `git show b0fff06a --stat` touches only the test file |
| X13-5 | `RANGE_SEP` still works under Bun because the string goes to `RegExp`, which reads the rewritten escapes as the same dashes | ✅ | Run, 2026-11-26: `new RegExp(s).test(" – ")` is true under both Node and Bun |

**Totals:** 8 claims: 8 ✅, 0 ✏️, 0 ⚠️.
