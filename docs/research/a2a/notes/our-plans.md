# What our repository already says about agent-to-agent protocols (as of November 2026)

Research notes, gathered 2026-11-19 from this repository on branch `todo/U19-research-a2a`, at `main` commit `b5fc4f2`. Every claim below cites a file in the repo; nothing was fetched from outside.

## The repo mentions A2A in passing, and never as a design input

### Takeaway
A2A appears in about a dozen research files, almost always as a feature of other people's software: ADK's Task API, Strands' SDK, UI adapters and the agent-UI comparison. One set of connector notes recommends it for the agent boundary. No plan, decision or todo outside the book plan names it, and the book plan's only checked claim about it is the latest released version.

### Cited findings
- Main report, SDK table, Google ADK row: "Graph execution, Task API with A2A, `adk eval`" — [main report, line 21](../../agent-sdks-and-harness-design.md).
- Strands comparison: "None; the CLI speaks ACP and the SDK speaks A2A", against our "One typed JSON-RPC 2.0 protocol (HD6)" — [Strands report, line 58](../../external-designs/strands-harness-sdk.md). The ACP there is the Agent Client Protocol (`@agentclientprotocol/sdk`), an editor-to-agent protocol, not IBM's Agent Communication Protocol — [Strands report, line 39](../../external-designs/strands-harness-sdk.md).
- Agent-UI report: "AG-UI and A2A end the run and start a new one that carries the answer", when a run waits for a human — [agent-UI report, line 54](../../agent-ui/agent-ui-research.md).
- assistant-ui ships adapters for "AI SDK, LangGraph, ADK, A2A, AG-UI" — [hashbrown report, line 126](../../agent-ui/hashbrown.md).
- Connector notes: "Use A2A at the agent boundary (delegating to other agents). Map its in-task auth onto the same vault and URL-elicitation-style out-of-band consent." The connectors report itself does not carry this recommendation (`grep -wi a2a` finds nothing in `agent-connectors.md`) — [connector notes, line 270](../../connectors/notes/protocol-auth-security.md).
- Sagas report: mentions MCP's tasks extension, not A2A; the `a2a` match there is part of another word — [sagas report](../../reversible-actions/sagas.md).
- Book plan fact-check row 107: "A2A's latest released version is 1.0.0", checked against the live spec page — [fact-check of the book plan, line 161](../../../plans/reviews/fact-check-build-book.md).
- Book plan §4.3: A2A gets "T37, a section of T21", because "A2A is an interoperability protocol beside MCP, so it belongs in the chapter that already explains MCP; one section keeps Chapter T21 from waiting on research" — [book plan, line 449](../../../plans/build-book.md).

## What T37 and T21 expect

### Takeaway
T37 is one section of Chapter T21, whose other sections cover the registry, deferred tools, MCP after 2026-07-28, skills and connector OAuth. T37 has an approved analogy (a standard purchase order) and no listing unless the research recommends an example.

### Cited findings
- T37 scope: "One section in `apps/manual/src/content/chapters/tools-at-scale.md`"; "Listings, if the report recommends an example and a later todo writes it" — [T37](../../../todos/ready/T37-section-a2a.md).
- T37 analogy: "A2A, as firms contracting through a standard purchase order. Where the analogy breaks: an A2A task can stream updates and ask for more input, which a purchase order never does." — [T37](../../../todos/ready/T37-section-a2a.md).
- T37 risk: "The research may show the topic needs a chapter after all; if so, propose it to the owner instead of overfilling the section." — [T37](../../../todos/ready/T37-section-a2a.md).
- T21 sections include "MCP after 2026-07-28: stateless requests, `server/discover`, multi round-trip requests (`input_required`), and the deprecation of Roots, Sampling, Logging and dynamic client registration" — [T21](../../../todos/ready/T21-chapter-tools-at-scale.md).

## Our harness speaks its own protocol and runs subagents in process

### Takeaway
The harness's wire protocol is a client-to-harness protocol (HD6), not an agent-to-agent one. Subagents are child sessions linked in the log. Nothing in the plans lets one of our agents call, or be called by, an agent in another process or organisation.

### Cited findings
- HD6: "Strict JSON-RPC 2.0 … Version 1 ships these client methods: `initialize`, `session/create`, … The server sends three requests: `approval/request`, `clarification/request` and `tool/call`" — [harness plan, HD6](../../../plans/build-harness.md#hd6-strict-json-rpc-20-with-the-jsonrpc-field-and-twelve-v1-methods).
- Subagents are log links: `{ type: "subagent_link"; childSession: string; spawningCallId?: string; stepId?: string }` — [harness plan, line 323](../../../plans/build-harness.md).
- The agent guide's fourth question: "Is the work broad, parallel, too large for one context and valuable enough to pay for it? Only then consider subagents." — [agent guide, line 30](../../../guides/agent.md).
- T42 will show "an orchestrator that calls a subagent as a tool. The subagent works in its own context and returns only a summary" — [T42](../../../todos/done/T42-example-subagent.md).
- The MCP client lands in Stage 5 (N24, N25) on `@modelcontextprotocol/client`, and must handle MCP 2026-07-28's `input_required` result by pausing the turn through N13 — [source-update report](../../source-update-2026-11-19.md), the table of proposed changes.

## Open questions for the report
- Whether a section in T21 is enough, or A2A needs more room (T37's risk).
- Whether our harness or platform should expose an A2A endpoint at all, and in which stage.
- How A2A's `TASK_STATE_INPUT_REQUIRED` and `TASK_STATE_AUTH_REQUIRED` map onto our approval and clarification requests.
