# Plans

Roadmaps and design docs for upcoming work. Name files `kebab-case.md`, and start each with a status line: `Draft`, `In progress`, `Done` or `Abandoned`. Each plan lists its todos, and the todos live on the [todo board](../todos/README.md).

| Plan | Status |
| --- | --- |
| [Roadmap](roadmap.md): the order of every round across the plans, and the milestones | In progress |
| [SDK references](sdk-references.md): a verified reference for each agent SDK, built with the same eight-step process (Round S) | Done (eight SDKs) |
| [SDK comparison](sdk-comparison.md): a feature table, a deep comparison and a TypeScript gap report for the eight SDKs, plus a refresh of the research report (Round C) | Done |
| [Agent skills](agent-skills.md): one skill per SDK in `.agents/skills`, symlinked to `.claude/skills` (Round K) | Done (eight skills) |
| [Build guides](build-guides.md): deep research, then a guide each, for building an agent SDK, an agent harness and an agent (Round G) | Done |
| [Implementation plans](implementation-plans.md): the build guides turned into detailed, reviewed plans for our own SDK, harness and agent (Round P) | In progress (P1 done) |
| [Build our SDK](build-sdk.md): two workspace packages, a gateway and a loop, in 20 todos tested offline against a scripted model (Round B, P1's output) | Draft, reviewed in P4 |
| [CI](ci.md): lint, type-check and offline tests on every push, and a nightly full verify with drift and audit gates (Round X) | Done |
