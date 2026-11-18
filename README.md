# agent-speak

Research for building our own AI agent and agent harness/SDK, and eventually the code.

The repo is documentation only for now. The research compares vendor agent SDKs, open-source frameworks and open-source harnesses, and proposes a reference architecture for a custom harness.

## Key conclusions

- **Own the loop, rent the sandbox.** Build the thin, differentiating parts yourself: agent loop, tools, context policy and session log. Buy sandboxes, durable execution and observability backends.
- **Harness design matters, but mostly at the extremes.** Fixing a broken harness interface can move scores by 50+ points. Among mature harnesses, differences are mostly in **cost**, and pass-rate gaps are often within rerun noise.
- **Borrow designs rather than forking whole products,** unless you are building a coding agent with its own UI.

## Docs

| Doc | What it covers |
|---|---|
| [docs/plans/](docs/plans/) | The plans and roadmap for this phase: SDK references, comparison, skills, build guides and implementation plans |
| [docs/todos/](docs/todos/) | The todo board: every planned batch of work, by state |
| [docs/comparison/deep-comparison.md](docs/comparison/deep-comparison.md) | The same triage agent built on all five SDKs, the design trade-offs, and lessons for our own SDK, harness and agent |
| [docs/comparison/feature-table.md](docs/comparison/feature-table.md) | The five SDKs side by side, one row per feature, every cell linked to its verified or documented source |
| [docs/research/practitioners/practitioner-research.md](docs/research/practitioners/practitioner-research.md) | What 18 months of Hacker News threads (400 threads, 111,533 comments) say about building agents, set against the vendor and paper evidence |
| [docs/research/agent-sdk/](docs/research/agent-sdk/), [agent-harness/](docs/research/agent-harness/), [agent/](docs/research/agent/) | Deep research on building an agent SDK, an agent harness and an agent: notes, a synthesis with design decisions, and a fact-check log each |
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
| Google ADK | `@google/adk@2.4.0` | — | Planned (S7, added 2026-11-18; Python-first, with a TS parity check) |
| GitHub Copilot SDK | `@github/copilot-sdk@1.0.28` | — | Planned (S8, added 2026-11-18) |

## Development

The repo is a pnpm workspace (Node 22, pnpm 10.28.0). Each SDK harness under `verify/` is a workspace package.

```bash
pnpm install        # install every harness
pnpm check          # Biome lint and format check
pnpm typecheck      # type-check every package
pnpm test           # run every harness's verified examples offline
```

See [AGENTS.md](AGENTS.md#coding-standards) for the coding standards.

## For AI agents

See [AGENTS.md](AGENTS.md). `CLAUDE.md` is a symlink to it.
