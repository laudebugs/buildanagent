# Fact-check: the CI plan's claims

This log checks claims [CI plan §3h](../ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) makes, from todo [X6](../../todos/done/X6-bun-runtime-compatibility.md). Checked 2026-11-26, on branch `todo/X6-bun-runtime-compatibility`, off `main` at `209e060d`.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| X6-1 | Bun `v1.4.4` was published 2026-10-22, more than a week before this measurement (2026-11-26) | ✅ | `gh api repos/oven-sh/bun/releases/tags/bun-v1.4.4 --jq .published_at` returns `2026-10-22T10:11:32Z` |
| X6-2 | ADR 0033 fixes exactly four deployment targets (local Node, Cloudflare, AWS, Vercel) and names Bun as a candidate for none of them | ✅ | [ADR 0033](../../decisions/0033-three-deployment-targets.md), "Decision": "The SDK and harness support four targets: local Node for development, Cloudflare (primary), AWS and Vercel." No other target is named |
| X6-3 | The portable-agents report's recommendation 7 proposed typing the stdio transport over Web streams specifically so Deno, Bun and Workers could reuse it later | ✅ | [`portable-agents.md`](../../research/deployment/portable-agents.md), the recommendations table, item 7: "Type `stdioTransport` over Web streams, and move the WebSocket transport from non-goal to a later round \| harness §1, §3.5, N29 \| Deno, Bun and Workers reuse; cloud clients need it". A proposal, not a change already made |

**Totals:** 3 claims: 3 ✅, 0 ✏️, 0 ⚠️.
