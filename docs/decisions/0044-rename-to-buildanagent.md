# 0044. Rename the project, its npm scope and every name derived from it from agent-speak to buildanagent

- **Status:** Accepted (owner, 2026-11-19)
- **Date:** 2026-11-19
- **Plan:** the owner's decision on 2026-11-19, made in [#27](https://github.com/laudebugs/buildanagent/pull/27); the [roadmap](../plans/roadmap.md) and every plan now use the new names

## Context

The owner renamed the repository from `laudebugs/agent-speak` to `laudebugs/buildanagent`, chose `@buildanagent/` as the npm scope, and then chose to rename the project itself. Six accepted records name things after the old project: ADRs 0001, 0012, 0015, 0017, 0030 and 0043. The decisions README forbids rewriting an accepted record, so this record carries the rename and those six keep their text.

## Decision

Every name derived from the project changes as the table shows. Where an earlier record uses a name in the left column, read it as the name in the right column.

| Old name | New name | Where it is decided |
| --- | --- | --- |
| `@agent-speak/<package>` (gateway, sdk, harness, protocol, cli, evals, triage-agent, agent-safety, platform, coding-agent) | `@buildanagent/<package>` | ADRs 0001, 0012, 0030, 0043 |
| the `agent-speak` CLI binary | `buildanagent` | ADR 0012 |
| `$XDG_STATE_HOME/agent-speak/keys.json`, the default key ring | `$XDG_STATE_HOME/buildanagent/keys.json` | ADR 0015 (superseded by 0035; the local file implementation keeps the path) |
| `agent_speak.*`, our OTel attribute namespace (`cost.usd`, `cost.basis`, `semconv.genai.commit`, `usage.cache_read_tokens`) | `buildanagent.*` | ADR 0017 |
| the project name agent-speak, the root package `agent-speak`, the LICENSE holder "The agent-speak contributors" | buildanagent, `buildanagent`, "The buildanagent contributors" | none |

Nothing has shipped under the old names: the packages are private, no release exists, and no key ring or span has been written. So the rename needs no migration.

## Consequences

- ADRs 0001, 0012, 0015, 0017, 0030 and 0043 keep their text. Their Status lines point here, and the decisions index lists the new names.
- Plans, todos, research reports, skills, READMEs, AGENTS.md and the code use the new names from #27 on.
- Historical records keep the old names as written: fact-check logs, plan reviews and raw research notes. Where a reviewed report changed, its fact-check log gains a corrected row.
- The LICENSE and LICENSE-MIT holder lines say the project was named agent-speak until 2026-11-19, so earlier attributions stay traceable.
