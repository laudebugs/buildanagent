# agent-speak

Research and (eventually) code for building an AI agent and our own agent harness/SDK.

## Docs

- [docs/research/agent-sdks-and-harness-design.md](docs/research/agent-sdks-and-harness-design.md) — main research report: vendor SDKs vs. OSS frameworks vs. building our own harness, reference architecture, build-vs-buy.
- [docs/research/notes/](docs/research/notes/) — underlying research notes:
  - `vendor-sdks.md` — Claude Agent SDK, OpenAI Agents SDK, Cloudflare Agents, Google ADK, Microsoft Agent Framework, Strands
  - `oss-frameworks.md` — LangGraph, Pydantic AI, CrewAI, Mastra, Agno, smolagents, etc.
  - `oss-harnesses.md` — OpenHands SDK, OpenCode, DeepSeek harness, Codex, Goose, Aider, mini-swe-agent, Cline, OpenClaw
  - `custom-harness-architecture.md` — agent loop, tools, MCP, memory, planning, context, sandboxing, long-running patterns
  - `observability-evals.md` — OTel GenAI semconv, tracing tools, Inspect AI, SWE-bench & other benchmarks
