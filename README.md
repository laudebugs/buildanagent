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
| [docs/guidelines/](docs/guidelines/README.md) | The coding and documentation rules for our packages: strict, portable TypeScript; one home per concept and small functions; offline, deterministic tests; plain-English docs and tested examples |
| [docs/plans/](docs/plans/) | The plans and roadmap: SDK references, comparison, skills, build guides, implementation plans, and the [personal cloud coding agent](docs/plans/build-coding-agent.md) that is the first agent to build, the multi-user [agent platform](docs/plans/build-agent-platform.md) that follows it, and the plan to [close seven SDK gaps](docs/plans/close-sdk-gaps.md) with a standalone safety package first |
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
| [docs/research/reversible-actions/](docs/research/reversible-actions/) | Making agent actions safe to fail, retry or reverse: server-side rollback per tool call and sagas for multistep actions and rewind versus data rollback, with notes, a report and a fact-check per round |
| [docs/research/agent-ui/](docs/research/agent-ui/) | Deep research on agent UIs: protocols (AG-UI, A2UI, MCP Apps), web frameworks, terminal and editor UIs, patterns beyond chat, and the UI contracts of our eight SDKs, plus a report on Vercel Labs' UI SDK; notes, syntheses and a fact-check |
| [docs/research/agent-sdk/](docs/research/agent-sdk/), [agent-harness/](docs/research/agent-harness/), [agent/](docs/research/agent/) | Deep research on building an agent SDK, an agent harness and an agent: notes, a synthesis with design decisions, and a fact-check log each |
| [docs/guides/agent-sdk.md](docs/guides/agent-sdk.md) | Guide to building an agent SDK: the gateway, loop, tools, events, hooks, approvals, test model and API, a reference architecture, and the decisions left for the implementation plan |
| [docs/guides/agent-harness.md](docs/guides/agent-harness.md) | Guide to building an agent harness: the session log, context layers, tool registry and MCP, permissions, sandbox and credentials, extensions, one protocol under every interface, telemetry, evals and ablation, with a reference architecture and open decisions |
| [docs/guides/agent.md](docs/guides/agent.md) | Guide to building an agent, with the triage agent as the running example: scoping, tool contracts, prompt and skills, safety tiers and identity binding, pass^k evals, staged rollout and cost, with a reference architecture and open decisions |
| [docs/research/agent-sdks-and-harness-design.md](docs/research/agent-sdks-and-harness-design.md) | Main report: vendor SDKs vs OSS frameworks vs building our own; 8-layer reference architecture; build-vs-buy |
| [docs/research/harness-architectures.md](docs/research/harness-architectures.md) | Source-level teardown of Pi, Codex CLI, OpenAI Agents SDK sandbox agents and Cloudflare Agents/Think |
| [docs/research/fact-check-2026-11-18.md](docs/research/fact-check-2026-11-18.md) | Verification log: what was confirmed, corrected or is still secondary |
| [docs/research/notes/](docs/research/notes/) | Raw research notes (vendor SDKs, OSS frameworks, OSS harnesses, custom harness architecture, observability and evals) |

## SDK references

Each SDK gets a reference folder under `docs/reference/<sdk>/` (guide, fact-check, mirrored upstream docs) and a verification harness under `verify/<sdk>/` that type-checks and runs every doc example offline against a mock model.

| SDK | Pinned version | Reference | Status |
|---|---|---|---|
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk@0.3.327` | [docs/reference/claude-agent-sdk/](docs/reference/claude-agent-sdk/) | Done: 385 doc blocks type-checked, 87 run, 7 verified examples |
| Pi (agent harness) | `@earendil-works/pi-coding-agent@1.5.2` | [docs/reference/pi/](docs/reference/pi/) | Done: 334 sources type-checked, 20 run, 8 verified examples |
| OpenAI Agents SDK | `@openai/agents@0.21.0` | [docs/reference/openai-agents-sdk/](docs/reference/openai-agents-sdk/) | Done: 182 sources type-checked, 66 run, 9 verified examples |
| Vercel AI SDK | `ai@7.0.162` | [docs/reference/vercel-ai-sdk/](docs/reference/vercel-ai-sdk/) | Done: 741 doc blocks type-checked, 116 run, 9 verified examples (agent-relevant core) |
| LangChain.js | `langchain@1.6.1` | [docs/reference/langchain/](docs/reference/langchain/) | Done: 713 doc blocks type-checked, 33 run (+12 with a provider prefix), 10 verified examples |
| Cloudflare Agents | `agents@0.33.0` | [docs/reference/cloudflare-agents/](docs/reference/cloudflare-agents/) | Done: 1,927 doc blocks type-checked, 171 run in workerd, 9 verified examples |
| Google ADK | `@google/adk@2.5.0` | [docs/reference/google-adk/](docs/reference/google-adk/) | Done: [guide](docs/reference/google-adk/guide.md) and [fact-check](docs/reference/google-adk/fact-check.md); 304 sources type-checked, 109 run offline, 19 of 22 documented behaviors held |
| GitHub Copilot SDK | `@github/copilot-sdk@1.0.31` | [docs/reference/copilot-sdk/](docs/reference/copilot-sdk/) | Done: [guide](docs/reference/copilot-sdk/guide.md) and [fact-check](docs/reference/copilot-sdk/fact-check.md); 455 sources type-checked, 50 run against the real runtime with a mock model, 22 of 23 documented behaviors held |

## Development

The repo is a pnpm workspace (Node 22, pnpm 10.34.9). Our own packages live in `packages/`: `@buildanagent/gateway` and `@buildanagent/sdk`, which are scaffolds as of November 2026. Each SDK harness under `verify/` is also a workspace package.

```bash
pnpm install        # install every package and harness
pnpm check          # Biome lint and format check
pnpm typecheck      # type-check every package
pnpm test           # run our packages' tests and every harness's verified examples offline
```

See [AGENTS.md](AGENTS.md#coding-standards) for the coding standards.

## Licence

You may use our code (scripts, our packages in `packages/`, the `verify/` harnesses and their examples, workflows and configs) under [Apache-2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), at your option. Our documentation is licensed under [CC BY 4.0](LICENSE-DOCS), and [LICENSE](LICENSE) says which files fall under which licence. The upstream docs mirrored under `docs/reference/*/source/` keep their own licences, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## For AI agents

See [AGENTS.md](AGENTS.md). `CLAUDE.md` is a symlink to it.
