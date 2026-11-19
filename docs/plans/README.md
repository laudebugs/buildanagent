# Plans

Roadmaps and design docs for upcoming work. Name files `kebab-case.md`, and start each with a status line: `Draft`, `In progress`, `Done` or `Abandoned`. Each plan lists its todos, and the todos live on the [todo board](../todos/README.md).

| Plan | Status |
| --- | --- |
| [Roadmap](roadmap.md): the order of every round across the plans, and the milestones | In progress |
| [SDK references](sdk-references.md): a verified reference for each agent SDK, built with the same eight-step process (Round S) | Done (eight SDKs); S10 adds voice sections to three references (2026-11-19) |
| [SDK comparison](sdk-comparison.md): a feature table, a deep comparison and a TypeScript gap report for the eight SDKs, plus a refresh of the research report (Round C) | Done |
| [Agent skills](agent-skills.md): one skill per SDK in `.agents/skills`, symlinked to `.claude/skills` (Round K) | Done (eight skills) |
| [Build guides](build-guides.md): deep research, then a guide each, for building an agent SDK, an agent harness and an agent (Round G) | Done |
| [Implementation plans](implementation-plans.md): the build guides turned into detailed, reviewed plans for our own SDK, harness and agent (Round P) | Done (P1–P4; [review](reviews/plan-review.md)) |
| [Build our SDK](build-sdk.md): two workspace packages, a gateway and a loop, in 24 todos tested offline against a scripted model (Round B: 22 from P1, and two price-catalog todos, B21 and B22, from the fine-tuning research) | Reviewed in P4; ready to build |
| [Build our harness](build-harness.md): four packages (protocol, harness, CLI, evals) on the SDK's seams, in 55 todos (Round N: 41 from P2 and P4, 12 portability todos, N50 and the memory extension N52) | Reviewed in P4 and plan review 2; being built |
| [Build our agent](build-agent.md): the support-triage agent as one package on the harness, in 24 todos with an offline release gate (Round A, P3's output) | Deferred (owner, 2026-11-18; [ADR 0032](../decisions/0032-personal-coding-agent-first.md)) |
| [Build the coding agent](build-coding-agent.md): a personal cloud coding agent on our SDK and harness, on Cloudflare first, with the harness made portable to AWS and Vercel, in 12 todos (W1–W12) plus portability todos N41–N50 (Round W) | Draft (2026-11-18); M7, on hold until the owner says go |
| [Build the agent platform](build-agent-platform.md): a multi-user platform that turns a description into an agent on a verified SDK, gates it with type-checks, mock-model tests and hidden-grader evals, and deploys it into the user's own Cloudflare or Vercel account under the user's own key, in 18 todos (Round F) | Draft (2026-11-18); M8 and M9 |
| [Close the SDK gaps](close-sdk-gaps.md): seven gaps the pinned SDKs leave open, closed first as a standalone safety package on `agents` 0.33.0 and `ai` 7.0.162 and then folded into our SDK and harness, in 8 new todos (E1–E7) and revisions to 11 existing ones (Round E) | Approved; being built (2026-11-19): the owner lifted the hold for all of Round E ("Lift hold on all of E") |
| [Publish and docs](publish-and-docs.md): npm releases of the gateway and SDK, from 0.1.0 once a model call works, and the docs and website on Cloudflare at `docs.buildanagent.fyi` and `buildanagent.fyi` | Ready |
| [Build the book](build-book.md): a public two-part textbook on building an agent, at `apps/manual` and manual.buildanagent.fyi, with numbers, citations, glossary links and listings checked at build time, in 52 todos: eleven tooling, sixteen examples, four research rounds (U18–U21), eighteen chapters and three sections (Round T) | Approved (2026-11-19); MT |
| [CI](ci.md): lint, type-check and offline tests on every push, and a nightly full verify with drift and audit gates (Round X) | Done |
