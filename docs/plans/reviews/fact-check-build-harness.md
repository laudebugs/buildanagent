# Fact-check: the harness plan's U18 changes

This log checks the claims that the owner's U18 decisions added to [build-harness.md](../build-harness.md), [ADR 0056](../../decisions/0056-file-based-memory-and-log-purge.md), todos [N21](../../todos/ready/N21-builtin-tools.md) and [N52](../../todos/ready/N52-memory-extension.md), and owner action 5 of [plan review 2](plan-review-2.md). The harness plan's earlier claims were checked in the [P4 review](plan-review.md) and in [plan review 2's log](fact-check-plan-review-2.md). Claims were checked on 2026-11-19. Repo claims were read on branch `docs/u18-decisions`, off `main` at `0c51291`. SDK claims come from the pinned typings in `verify/*/node_modules`, and research claims from the [retrieval and memory report](../../research/memory/retrieval-and-memory.md) and its [fact-check](../../research/memory/fact-check-retrieval-and-memory.md). Anthropic's memory tool page was fetched on 2026-11-19.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ a number or design left to a todo, or our own inference.

## Owner decision and ids

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 1 | The owner approved all twelve of U18's proposed changes on 2026-11-19, among them changes 5–8 | Status, HD11, HD17, ADR 0056, N21, N52, plan review 2 | ✅ | Owner's answers, 2026-11-19: every option chosen in three multi-select questions |
| 2 | N52 was free, and N51 is the connectors report's proposed vault todo | Intro, §4.5 | ✅ | `ls docs/todos/*/` at `0c51291`: the highest N id is N50; [agent connectors report](../../research/connectors/agent-connectors.md), change 3, names "New todo (N51)" |
| 3 | HD16 exists only as a proposal in plan review 2, and HD17 was free | §2, HD17 | ✅ | `grep -rn HD16 docs` finds it only in plan review 2's owner action 5 and the U18 report; no `HD16` or `HD17` heading in the plan |
| 4 | 0056 is the next free ADR number | ADR 0056 | ✅ | `docs/decisions/` at `0c51291` ends at `0055-name-the-book-app-manual.md` |
| 5 | The plan now has 55 todos: 41 from P2 and P4, 12 for portability, N50 and N52 | Title, intro, plans index | ✅ | 41 + 12 + 1 + 1 = 55; the §4 tables list each id once |
| 6 | N52's **Depends on** (N21, N23, N33) matches its §4.5 row | §4.5 | ✅ | The table check over every plan: 0 mismatches in 209 rows |

## HD17 and N52: the memory extension

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 7 | Anthropic's memory tool has the commands `view`, `create`, `str_replace`, `insert`, `delete` and `rename`; HD17 keeps five of them, without `insert` | HD17, ADR 0056, N52 | ✅ | [Claude, memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool), "Tool commands", fetched 2026-11-19; U18 change 5 lists the same five |
| 8 | "Your implementation must validate every path in every command to prevent directory traversal attacks" | HD17, N52 | ✅ | Same page, "Path traversal protection", verbatim; the page also lists URL-encoded traversal (`%2e%2e%2f`), which N52's task names |
| 9 | The handler should refuse a `delete` or `rename` of the memory directory itself | N52 | ✅ | Same page, under `delete` and `rename`: "reject a `delete` whose path is the memory root" |
| 10 | The index cap of 200 lines or 25 KB is the one Claude Code uses for `MEMORY.md` | HD17, ADR 0056, N52 | ✅ | U18 report, Recall ¶1, quoting [Claude Code, memory](https://code.claude.com/docs/en/memory): "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first"; U18 fact-check row 24 |
| 11 | Copilot expires memories after 90 days by default, and "Simply retrieving a memory does not reset this period" | HD17 | ✅ | U18 report, Forget ¶2, from [GitHub Docs, Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory); U18 fact-check rows 85 and 123 |
| 12 | The 90-day figure was 28 days in January 2026 | N52, risks | ✅ | U18 report, Forget ¶2, citing the GitHub changelog of 15 January 2026; U18 fact-check row 85 |
| 13 | Project facts expire 90 days after the last validation, task records at session end, preferences when the user changes them | HD17, ADR 0056, N52 | ✅ | U18 report, "Our rule for forgetting", matched word for word; the rule is the report's own synthesis (its row 90, ⚠️ inferred), which the owner approved |
| 14 | The record fields: subject, fact, source, type, created, validated, expiry and trust | HD17, §3.5, N52 | ✅ | U18 report, "Our rule for writing" (subject, fact, source, type, created date, last-validated date, low-trust marking) and change 5 (expiry); the three type values are ours, taken from the three expiry classes |
| 15 | MINJA planted records through queries alone, and later sessions obeyed them in 76.8% of attempts | HD17, ADR 0056 | ✅ | U18 fact-check row 4, at arXiv 2503.03704v5 |
| 16 | Zep warns that deleted episode data "may still exist" in shared nodes, and Claude Code's transcript sweep leaves memory files alone | HD11 amendment | ✅ | U18 report, Forget ¶3, quoting [Zep, deleting data](https://help.getzep.com/v4/deleting-data-from-the-graph.md) ("This episode information may still exist within these nodes") and [Claude Code, memory](https://code.claude.com/docs/en/memory); U18 fact-check rows 86 and 87 |
| 17 | None of our eight SDKs expires a memory inside the process | HD17, ADR 0056 | ✅ | U18 fact-check row 6 |
| 18 | `RegisteredTool.outputTrust` takes `"untrusted"` and defaults to it for `mcp:*` tools | HD17 | ✅ | The plan's own §3.3, `outputTrust?: "trusted" \| "untrusted"` with that comment (agent AH10) |
| 19 | CoALA warns that writing procedural memory is riskier than writing episodic or semantic memory | HD17 (procedural paths) | ✅ | U18 fact-check row 61, at arXiv 2309.02427v3 |
| 20 | A `formatVersion` migration writes a new file, the model for the targeted purge | HD11 amendment, ADR 0056 | ✅ | HD11's choice: "a `formatVersion` bump, which arrives with a migration that writes a new file (HD2)" |
| 21 | The low-trust expiry period and the renewal rule are not yet set | HD17, N52 | ⚠️ | Left to N52 by design; neither the report nor the owner's answer gives a number |
| 22 | A targeted purge breaks a byte-for-byte replay of the session it rewrites | N52 risks, ADR 0056 | ⚠️ | Our inference: replay compares bytes from the log (§1, Round N's close), and the purge changes those bytes |
| 23 | A fact may survive in a compaction summary that the purge marks do not cover | N52 risks | ⚠️ | Our inference from layer 3's summaries (N9); not tested |

## N21: read-only `grep` and `glob`

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 24 | Before this change the built-ins were `read`, `write`, `edit`, `bash` and `fetch`, and N21 put `grep` and `glob` out of scope | §3.1, §3.3, N21 | ✅ | The plan at `0c51291`, §3.1 and the `builtinTools` comment; N21's out-of-scope line "Search tools (grep, glob): P3 or later, if evals show the need" |
| 25 | Claude's SDK ships `Grep` and `Glob`, Pi ships `grep` and `find`, and Copilot's runtime ships `grep` and `glob` | N21 | ✅ | `claude-agent-sdk/sdk.d.ts:232` (`BUILTIN_TOOL_NAMES` includes `'Glob'` and `'Grep'`); the U18 SDK table rows for Pi 1.5.2 and Copilot 1.0.31, U18 fact-check rows on the SDK table |
| 26 | The sandbox policy has `readRoots`, against which `grep` and `glob` check paths | N21 | ✅ | §3.4: `interface SandboxPolicy { readRoots: string[]; writeRoots: string[]; … }` |

## Plan review 2: HD16's widened scope

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 27 | HD16 is plan review 2's owner action 5, on defaults for untrusted-source tools | Plan review 2 §6, HD17 | ✅ | [Plan review 2](plan-review-2.md#6-eleven-owner-actions-are-still-open-and-only-one-a-test-project-for-n50-touches-waves-15), row 5 |
| 28 | The widened scope: memory writes from a session that read untrusted content are low-trust and expire fastest, and no untrusted input writes procedural memory | Plan review 2 §6, HD17 | ✅ | U18 change 8, word for word |

## Writing-review fixes, re-checked

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 29 | Zep's warning concerns nodes shared with other episodes | HD11 amendment | ✏️ | The draft said "derived nodes". Zep's page says deleting an episode "does not regenerate the names or summaries of nodes shared with other episodes" (U18 report, Forget ¶3; U18 fact-check row 86). **Now:** "in nodes shared with other episodes" |
| 30 | The index cap matches the one Claude Code applies to `MEMORY.md` | HD17, Recall | ✅ | Reworded only; row 10's source still holds |

**Totals:** 30 claims: 26 ✅, 1 ✏️, 3 ⚠️.
