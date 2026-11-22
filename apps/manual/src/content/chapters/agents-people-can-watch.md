---
title: "Agents people can watch: UIs, browsers and taking over"
summary: A person who watches an agent needs to see what it did, steer it and take over when it is about to act. This chapter shows an agent UI as views over one event log, what undo can and cannot cover, how a browser is described to a model, how a person watches and takes over, and why the network and the credential, not the model, are the browser's boundary.
opening: question
sources: [acp-readme, playwright-mcp-snapshots, cdp-browser-protocol, meta-rule-of-two, willison-lethal-trifecta, openai-agents-human-in-the-loop]
glossary: [accessibility-snapshot, event-log]
switchTo: [N44]
---

What should you see when an agent has worked for twenty minutes and then asks to click Pay? A transcript of its thoughts will not do. You need to know what it did, what it is about to do, and how to stop it before the click lands. The answer this chapter gives has four parts. Every view of an agent, a chat, a plan or a review of changes, is drawn from one event log. Undo covers the edits an agent made and never the actions it sent. A browser agent sees a page as a list of labelled elements, and a person can watch it and take over, as long as the agent pauses when they do. And because a page can carry instructions the model will read, the browser's real boundary is the network it can reach and the credentials it can use.

## An agent UI is a set of views over one event log, and a chat is only one of them

Think of :analogy[an election-results board driven by the official count]{#election-results-board}. The board does not keep its own tally. It shows what the official count says, in several forms, a total here and a map there, and every form agrees because there is one count. An agent UI works the same way. The agent runs behind a protocol, and each surface, a terminal, an editor or a web page, is a client that draws the stream of events the run produces. A board only displays, though, and an agent UI can also send events back, such as an approval, which the log then records.

The Agent Client Protocol shows the shape. At stable version 1, its `session/update` notifications carry message and thought chunks, tool calls with a kind and a status that runs from pending to in progress to completed or failed, and plan entries, while a separate `session/request_permission` request offers four choices: allow once, allow always, reject once and reject always [@acp-readme]. A chat view draws the messages and tool calls, a plan view draws the plan entries, and an approval inbox draws the permission requests. [[fig:one-log-three-views]] puts three of them on one log.

:::figure[One event log feeding a chat view, a plan view and a review view: three views, one record]{#one-log-three-views}
::svg{alt="A box on the left labelled one event log, ordered and appended, in the accent. Three arrows lead to three boxes on the right: chat view, plan view and review view. Under them, small notes say messages and tool cards, steps and their status, and what changed, to keep or undo. A line below says three views, one record: an approval goes back in as an entry."}
:::

Your own SDK already emits such a stream. [[lst:stream-parts]] reads the typed parts of an AI SDK run: lifecycle parts that mark a start and a finish, and a text delta for each piece of text. A UI that draws these parts as they arrive is a view of the stream, and a UI that stored them could draw the same run again later.

:::listing[A run as a stream of typed parts that a view can draw]{#stream-parts file="verify/vercel-ai-sdk/examples/06-streaming.ts" region="stream-parts"}
:::

The harness plan applies the same idea one level down. Its session log is the contract: the transcript, the tool cards, the plan and the approval inbox are all projections of one ordered, append-only record. That is our recommendation and a plan, and the part that is hard is under the views. The server has to own the run apart from any connection, chunks need sequence numbers so a client can rejoin, and a pending approval has to be a stored record and not an in-memory promise.
