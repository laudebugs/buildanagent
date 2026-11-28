# buildanagent

Research for building our own AI agent and agent harness/SDK, and eventually the code.

The repo is documentation only for now. The research compares vendor agent SDKs, open-source frameworks and open-source harnesses, and proposes a reference architecture for a custom harness.

## Key conclusions

- **Own the loop, rent the sandbox.** Build the thin, differentiating parts yourself: agent loop, tools, context policy and session log. Buy sandboxes, durable execution and observability backends.
- **Harness design matters, but mostly at the extremes.** Fixing a broken harness interface can move scores by 50+ points. Among mature harnesses, differences are mostly in **cost**, and pass-rate gaps are often within rerun noise.
- **Borrow designs rather than forking whole products,** unless you are building a coding agent with its own UI.

## Docs

| Doc | What it covers |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute: pnpm setup, exact pins, one pull request per change, the document review rule and the licence of contributions |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability privately, and what is in scope |
| [docs/guidelines/](docs/guidelines/README.md) | The coding and documentation rules for our packages (strict, portable TypeScript; one home per concept and small functions; offline, deterministic tests; plain-English docs and tested examples), plus guidelines for building and evaluating model-assisted workflows on structured data |
| [docs/plans/](docs/plans/) | The plans and roadmap: SDK references, comparison, skills, build guides, implementation plans, and the [personal cloud coding agent](docs/plans/build-coding-agent.md) that is the first agent to build, the multi-user [agent platform](docs/plans/build-agent-platform.md) that follows it, and the plan to [close seven SDK gaps](docs/plans/close-sdk-gaps.md) with a standalone safety package first |
| [docs/plans/build-book.md](docs/plans/build-book.md) | The plan for a public textbook on building an agent, at `apps/manual` and manual.buildanagent.fyi: two parts, checked listings from `verify/`, generated figures, and 52 todos |
| [apps/site/](apps/site/) | The website for buildanagent.fyi: a landing page and a page for the gateway and one for the SDK, with links to the docs and the repository |
| [apps/docs/](apps/docs/README.md) | The docs for the gateway and SDK, built with Astro Starlight for docs.buildanagent.fyi: start, concepts, guides, testing and reference pages, with code from tested example files |
| [docs/todos/](docs/todos/) | The todo board: every planned batch of work, by state |
| [docs/comparison/deep-comparison.md](docs/comparison/deep-comparison.md) | The same triage agent built on all eight SDKs, the design trade-offs, and lessons for our own SDK, harness and agent |
| [docs/comparison/typescript-gaps.md](docs/comparison/typescript-gaps.md) | What each TypeScript SDK lacks, has in weaker form, or has documented only for its primary language (Python, mostly), with sources on both sides |
| [docs/comparison/feature-table.md](docs/comparison/feature-table.md) | The eight SDKs side by side, one row per feature (including primary language and TypeScript parity), every cell linked to its verified or documented source |
| [docs/research/practitioners/practitioner-research.md](docs/research/practitioners/practitioner-research.md) | What 18 months of Hacker News threads (400 threads, 111,533 comments) say about building agents, set against the vendor and paper evidence |
| [docs/research/external-designs/](docs/research/external-designs/) | Outside agent designs read against our own: 12-factor agents and the Strands harness SDK, with what to change in our plans; notes, a report and a fact-check per round |
| [docs/research/deployment/](docs/research/deployment/) | Deploying our agents anywhere: the seams that make the harness portable, the storage-and-wake problem, hosted sandboxes, WebContainers, what a cloud coding agent needs, and the market for agent-building platforms; notes, reports and fact-checks |
| [docs/research/agents/](docs/research/agents/) | Research for agents we might build on our stack: how a job-search agent could automate finding roles, people and applications within LinkedIn's, Indeed's, Google's and email law's limits; notes, a report and a fact-check |
| [docs/research/browser-use/](docs/research/browser-use/) | Browser use for our agents: page representations and libraries, hosted browsers per deployment target, vendor computer-use tools and SDK support, prompt injection and login safety, browser evals, and proposed plan changes; notes, report and fact-check |
| [docs/research/connectors/](docs/research/connectors/) | Connectors for our agents and platform: how ten platforms offer them, MCP 2026-07-28 authorization and token custody, build-or-buy infrastructure, and a recommended design; notes, a report and a fact-check |
| [docs/research/memory/](docs/research/memory/) | Retrieval and long-term memory: when an agent should retrieve instead of carrying context, keyword, vector and hybrid search and their failure modes, how memory that outlives a task is written, recalled and forgotten, and what our eight SDKs offer in TypeScript; notes, a report and a fact-check |
| [docs/research/a2a/](docs/research/a2a/) | Agent-to-agent protocols: what A2A 1.0 standardizes, how it divides work with MCP, when an agent should call or expose another agent over A2A, which of our eight SDKs support it in TypeScript, and what the book's A2A section should teach; notes, a report and a fact-check |
| [docs/research/voice/](docs/research/voice/) | Voice and realtime agents: how the loop, turn detection, barge-in and tool calls differ from a text agent, transports, session limits and cost, and what our eight SDKs offer in TypeScript; notes, a report and a fact-check |
| [docs/research/book/](docs/research/book/) | The textbook site: what the deployed Worker already caches and what an offline service worker would add (`offline-reading-and-caching.md`), answering issue #175. |
| [docs/research/fine-tuning/](docs/research/fine-tuning/) | Fine-tuning versus prompting: when fine-tuning, distillation or reinforcement fine-tuning beats prompting plus tools for an agent, what it costs over a base model's life, the providers' offers as of November 2026 and what deployed agents show; notes, a report and a fact-check |
| [docs/research/model-routing/](docs/research/model-routing/) | Fast and slow model calls: what "System 1" and "System 2" mean for models, which decision models and fast models exist as of November 2026, when an agent should make a fast call or escalate, when a router beats a fixed model and how the prompt cache decides it; notes, a report and a fact-check |
| [docs/research/redesign-vs-ai/](docs/research/redesign-vs-ai/) | Redesign versus AI: when a redesign, plain code, one model call in a fixed workflow or an agent should solve a problem, the evidence on each, a before-and-after method with four arms for one workflow, and a decision rule for Chapter 1; a report and a fact-check |
| [docs/research/papers/](docs/research/papers/) | A survey of AI agent research papers as of November 2026: agent architectures and reasoning, evals and benchmarks, multi-agent systems, tool and skill security, provenance and verification, and self-improving harnesses, with proposed plan changes; notes, a report and a fact-check |
| [docs/research/reversible-actions/](docs/research/reversible-actions/) | Making agent actions safe to fail, retry or reverse: server-side rollback per tool call and sagas for multistep actions and rewind versus data rollback, with notes, a report and a fact-check per round |
| [docs/research/agent-ui/](docs/research/agent-ui/) | Deep research on agent UIs: protocols (AG-UI, A2UI, MCP Apps), web frameworks, terminal and editor UIs, patterns beyond chat, and the UI contracts of our eight SDKs, plus a report on Vercel Labs' UI SDK; notes, syntheses and a fact-check |
| [docs/research/agent-sdk/](docs/research/agent-sdk/), [agent-harness/](docs/research/agent-harness/), [agent/](docs/research/agent/) | Deep research on building an agent SDK, an agent harness and an agent: notes, a synthesis with design decisions, and a fact-check log each |
| [docs/guides/agent-sdk.md](docs/guides/agent-sdk.md) | Guide to building an agent SDK: the gateway, loop, tools, events, hooks, approvals, test model and API, a reference architecture, and the decisions left for the implementation plan |
| [docs/guides/agent-harness.md](docs/guides/agent-harness.md) | Guide to building an agent harness: the session log, context layers, tool registry and MCP, permissions, sandbox and credentials, extensions, one protocol under every interface, telemetry, evals and ablation, with a reference architecture and open decisions |
| [docs/guides/agent.md](docs/guides/agent.md) | Guide to building an agent, with the triage agent as the running example: scoping, tool contracts, prompt and skills, safety tiers and identity binding, pass^k evals, staged rollout and cost, with a reference architecture and open decisions |
| [docs/research/agent-sdks-and-harness-design.md](docs/research/agent-sdks-and-harness-design.md) | Main report: vendor SDKs vs OSS frameworks vs building our own; 8-layer reference architecture; build-vs-buy |
| [docs/research/harness-architectures.md](docs/research/harness-architectures.md) | Source-level teardown of Pi, Codex CLI, OpenAI Agents SDK sandbox agents and Cloudflare Agents/Think |
| [docs/research/fact-check-2026-11-18.md](docs/research/fact-check-2026-11-18.md) | Verification log: what was confirmed, corrected or is still secondary |
| [docs/research/source-update-2026-11-19.md](docs/research/source-update-2026-11-19.md) | Source update: fourteen owner-chosen sources, most of them seeds the first round could not fetch, read against the main report, with proposed plan changes; notes and a fact-check |
| [docs/research/notes/](docs/research/notes/) | Raw research notes (vendor SDKs, OSS frameworks, OSS harnesses, custom harness architecture, observability and evals) |

## SDK references

Each SDK gets a reference folder under `docs/reference/<sdk>/` (guide, fact-check, mirrored upstream docs) and a verification harness under `verify/<sdk>/` that type-checks and runs every doc example offline against a mock model.

| SDK | Pinned version | Reference | Status |
|---|---|---|---|
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk@0.3.327` | [docs/reference/claude-agent-sdk/](docs/reference/claude-agent-sdk/) | Done: 385 doc blocks type-checked, 87 run, 7 verified examples |
| Pi (agent harness) | `@earendil-works/pi-coding-agent@1.5.2` | [docs/reference/pi/](docs/reference/pi/) | Done: 334 sources type-checked, 20 run, 8 verified examples |
| OpenAI Agents SDK | `@openai/agents@0.21.0` | [docs/reference/openai-agents-sdk/](docs/reference/openai-agents-sdk/) | Done: 182 sources type-checked, 66 run, 9 verified examples |
| Vercel AI SDK | `ai@7.0.162` | [docs/reference/vercel-ai-sdk/](docs/reference/vercel-ai-sdk/) | Done: 741 doc blocks type-checked, 116 run, 9 verified examples (agent-relevant core) |
| LangChain.js | `langchain@1.6.6` | [docs/reference/langchain/](docs/reference/langchain/) | Done: 713 doc blocks type-checked, 34 run (+12 with a provider prefix), 11 verified examples |
| Cloudflare Agents | `agents@0.33.0` | [docs/reference/cloudflare-agents/](docs/reference/cloudflare-agents/) | Done: 1,927 doc blocks type-checked, 171 run in workerd, 9 verified examples |
| Google ADK | `@google/adk@2.5.0` | [docs/reference/google-adk/](docs/reference/google-adk/) | Done: [guide](docs/reference/google-adk/guide.md) and [fact-check](docs/reference/google-adk/fact-check.md); 304 sources type-checked, 109 run offline, 19 of 22 documented behaviors held |
| GitHub Copilot SDK | `@github/copilot-sdk@1.0.31` | [docs/reference/copilot-sdk/](docs/reference/copilot-sdk/) | Done: [guide](docs/reference/copilot-sdk/guide.md) and [fact-check](docs/reference/copilot-sdk/fact-check.md); 455 sources type-checked, 50 run against the real runtime with a mock model, 22 of 23 documented behaviors held |

## Development

The repo is a pnpm workspace (Node 22, pnpm 10.34.9). Our own packages live in `packages/`. Six of them publish to npm as alphas (`0.1.0-alpha.28` on 2026-11-22): `@buildanagent/gateway`, `sdk`, `agent-safety`, `protocol`, `harness` and `cli`. `@buildanagent/evals` stays private, an empty scaffold. Each SDK harness under `verify/` is also a workspace package. The textbook, `@buildanagent/manual` in `apps/manual`, is a private workspace package that builds a static Astro site with Pagefind search. `pnpm --filter @buildanagent/manual build` writes the site to `apps/manual/dist/`. The book needs Node 22.23.4 or later.

```bash
pnpm install        # install every package and harness
pnpm check          # Biome lint and format check
pnpm typecheck      # type-check every package
pnpm test           # run our packages' and the book's tests and every harness's verified examples offline
```

See [AGENTS.md](AGENTS.md#coding-standards) for the coding standards.

## Licence

You may use our code (scripts, our packages in `packages/`, the `verify/` harnesses and their examples, the book's code in `apps/manual/`, workflows and configs) under [Apache-2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), at your option. The book's files adapted from the owner's garment engineering textbook are Apache-2.0 only, and the book's fonts in `apps/manual/public/fonts/` keep the SIL Open Font License 1.1. Our documentation, the book's prose and figures included, is licensed under [CC BY 4.0](LICENSE-DOCS), and [LICENSE](LICENSE) says which files fall under which licence. The upstream docs mirrored under `docs/reference/*/source/` keep their own licences, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## For AI agents

See [AGENTS.md](AGENTS.md). `CLAUDE.md` is a symlink to it.
