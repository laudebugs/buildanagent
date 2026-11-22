# Fact-check: Agents people can watch: UIs, browsers and taking over

The claims log for [`agents-people-can-watch.md`](../src/content/chapters/agents-people-can-watch.md), checked section by section as each was drafted (BK21). Each row names the claim, the section it sits in, the verdict and the primary source. Pages were read on 2026-11-22 where a row says so, and otherwise rely on the cited report's own log. Package claims are checked against the harness pins of that date: `@openai/agents@0.21.0` and `ai@7.0.162`.

## The research question, answered before drafting

**Question.** How should a person see, steer and take over an agent, in a UI and in a browser, when prompt injection makes the network and the credential the boundary?

**Answer, from the todo's sources only.** Every agent UI is a set of views over one ordered event log, so the log should be the UI contract, with approvals stored as durable requests ([agent UI research](../../../docs/research/agent-ui/agent-ui-research.md)). Undo covers the edits an agent made, listed from what changed and reverted by inverse operations, and it cannot cover a send, a save or a deployment, which must be gated before they run ([undo report](../../../docs/research/agent-ui/undo-agent-edits.md)). A browser agent's default view of a page is an accessibility snapshot with element references, with screenshots as a fallback; a person can watch through a live view or a screencast and take over through input events, and the agent must pause and record the takeover ([browser use report](../../../docs/research/browser-use/browser-use.md)). Prompt injection stays unsolved, and the lethal trifecta says to cut the outbound leg, so the network and the credential are the boundary and a deterministic gate outside the model decides each consequential action.

**Gaps.** The report finds no controlled data on canvas versus chat or on inbox approval accuracy, and no source measures the takeover relay's frame budget. The computer-use example proves the SDK's loop and approval flow with an in-memory fake and a scripted model, not a real model or browser.

## Opening and "An agent UI is a set of views over one event log, and a chat is only one of them"

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 1 | Every agent UI keeps the agent behind a protocol and treats the UI as one client among several | § An agent UI | ✅ | [Agent UI research](../../../docs/research/agent-ui/agent-ui-research.md), "Every agent UI projects one sequenced event log", with the Codex app-server and OpenCode evidence the report cites; the chapter states the general shape and names ACP only |
| 2 | ACP is at stable version 1 and its `session/update` notifications carry message and thought chunks, tool calls with a kind and a status running pending → in_progress → completed or failed, and plan entries | § An agent UI | ✅ | [ACP README at v1.19.0](https://github.com/agentclientprotocol/agent-client-protocol/blob/v1.19.0/README.md), [agent UI log row 59](../../../docs/research/agent-ui/fact-check.md): the stable version, `PermissionOptionKind` and `ToolCallStatus` in the v1 schema |
| 3 | A separate `session/request_permission` request offers four options: allow once, allow always, reject once and reject always | § An agent UI | ✅ | Same row 59: four permission option kinds; `session/request_permission` is in `meta.json` |
| 4 | An approval an agent UI sends back is recorded in the log | § An agent UI | ⚠️ | The report's recommendation ("model every approval as a persisted request"); our design, not an ACP property |
| 5 | The AI SDK stream yields lifecycle parts (`start`, `start-step`, `finish-step`, `finish`) and `text-delta` parts | § An agent UI | ✅ | `verify/vercel-ai-sdk/examples/06-streaming.ts`, the `stream-parts` region and its check "result.stream yields lifecycle and text-delta parts" |
| 6 | A UI that stored the parts could draw the same run again later | § An agent UI | ⚠️ | Our reasoning from row 5; the example stores nothing |
| 7 | The harness plan treats the session log as the UI contract: transcript, tool cards, plan and approval inbox are projections of one ordered, append-only record, and the server must own the run apart from any connection, chunks need sequence numbers, and a pending approval must be a stored record | § An agent UI | ✅ | Agent UI research, "The session event log should be the UI contract": the paragraph and its four-step recommendation, which the report labels as its own recommendation |
| 8 | An election-results board shows one count in several forms and every form agrees | § An agent UI | ⚠️ | The analogy's own claim; the "where it breaks" entry says what a board lacks (events sent back) |
