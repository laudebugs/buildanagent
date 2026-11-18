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
| OpenAI Agents SDK | `@openai/agents` | — | Next |
| Vercel AI SDK | `ai` | — | Planned (agent-relevant core) |

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
