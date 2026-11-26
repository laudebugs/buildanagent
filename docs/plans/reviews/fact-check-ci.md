# Fact-check: the CI plan's claims

This log checks claims [CI plan §3h](../ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) makes, from todo [X6](../../todos/done/X6-bun-runtime-compatibility.md). Checked 2026-11-26, on branch `todo/X6-bun-runtime-compatibility`, off `main` at `209e060d`. Todo [X11](../../todos/done/X11-bun-allowlisted-path-node.md) adds rows X11-1 to X11-5, checked 2026-11-26, on branch `todo/X11-bun-allowlisted-path-node`, off `main` at `1140ca71`.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| X6-1 | Bun `v1.4.4` was published 2026-10-22, more than a week before this measurement (2026-11-26) | ✅ | `gh api repos/oven-sh/bun/releases/tags/bun-v1.4.4 --jq .published_at` returns `2026-10-22T10:11:32Z` |
| X6-2 | ADR 0033 fixes exactly four deployment targets (local Node, Cloudflare, AWS, Vercel) and names Bun as a candidate for none of them | ✅ | [ADR 0033](../../decisions/0033-three-deployment-targets.md), "Decision": "The SDK and harness support four targets: local Node for development, Cloudflare (primary), AWS and Vercel." No other target is named |
| X6-3 | The portable-agents report's recommendation 7 proposed typing the stdio transport over Web streams specifically so Deno, Bun and Workers could reuse it later | ✅ | [`portable-agents.md`](../../research/deployment/portable-agents.md), the recommendations table, item 7: "Type `stdioTransport` over Web streams, and move the WebSocket transport from non-goal to a later round \| harness §1, §3.5, N29 \| Deno, Bun and Workers reuse; cloud clients need it". A proposal, not a change already made |
| X11-1 | Gap 5 said `tsc`'s own `#!/usr/bin/env node` shebang had nothing to run under Bun | ✏️ | Wrong. `node_modules/.bin/tsc` is pnpm's `#!/bin/sh` wrapper, and its line 20 is `exec node  "$basedir/../typescript/bin/tsc" "$@"`, so the wrapper looks `node` up on `PATH`. Gap 5 now says so, in place |
| X11-2 | Under Bun, `process.execPath` is `~/.bun/bin/bun`, so the test's allowlisted `PATH` held no `node` | ✅ | Measured 2026-11-26 on Bun 1.4.4: before the fix, `bun --bun x vitest run test/package.test.ts` in `packages/protocol` gave 1 failed and 1 passed, with `tsc: line 20: exec: node: not found` |
| X11-3 | `nodeDir()` keeps `dirname(process.execPath)` under Node and, under Bun, takes the first folder on the inherited `PATH` that holds a `node`; only that folder joins the allowlist | ✅ | `packages/protocol/test/package.test.ts` at commits `b64e645a` and `702c988c`: `process.versions.bun === undefined` returns `dirname(process.execPath)`; otherwise the `find` over `process.env.PATH` entries, with `no node found on PATH` as the error |
| X11-4 | After the fix, the test passes under Node and under Bun, and the protocol suite passes under Node | ✅ | Run 2026-11-26: `pnpm exec vitest run test/package.test.ts` 2/2; `bun --bun x vitest run test/package.test.ts` 2/2 in two runs; `pnpm --filter @buildanagent/protocol test` 57/57 in 8 files |
| X11-5 | AGENTS.md's "Running third-party code" allowlist rule is unchanged, and the test still spawns with an allowlisted environment, never the full `process.env` | ✅ | `git diff 1140ca71..HEAD -- AGENTS.md` is empty; the `env` object in `package.test.ts` still lists only `PATH`, `HOME`, `TMPDIR` and `LANG`, and `PATH` gains one folder under Bun |

**Totals:** 8 claims: 7 ✅, 1 ✏️, 0 ⚠️.
