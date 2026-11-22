---
title: "Agents people can watch: UIs, browsers and taking over"
summary: A person who watches an agent needs to see what it did, steer it and take over when it is about to act. This chapter shows an agent UI as views over one event log, what undo can and cannot cover, how a browser is described to a model, how a person watches and takes over, and why the network and the credential, not the model, are the browser's boundary.
opening: question
sources: [acp-readme, playwright-mcp-snapshots, cdp-browser-protocol, meta-rule-of-two, willison-lethal-trifecta, openai-agents-human-in-the-loop, claude-for-chrome, nist-agent-hijacking-evaluations, google-architecting-agentic-security]
glossary: [accessibility-snapshot, session-log]
switchTo: [N44]
---

What should you see when an agent has worked for twenty minutes and then asks to click Pay? A transcript of its thoughts will not do. You need to know what it did, what it is about to do, and how to stop it before the click lands. The answer this chapter gives has four parts. Every view of an agent, a chat, a plan or a review of changes, is drawn from one event log. Undo covers the edits an agent made and never the actions it sent. A browser agent sees a page as a list of labelled elements, and a person can watch it and take over, as long as the agent pauses when they do. And because a page can carry instructions the model will read, the browser's real boundary is the network it can reach and the credentials it can use.

## An agent UI is a set of views over one event log, and a chat is only one of them

Think of :analogy[an election-results board driven by the official count]{#election-results-board}. The board does not keep its own tally. It shows what the official count says, in several forms, a total here and a map there, and every form agrees because there is one count. An agent UI works the same way. The agent runs behind a protocol, and each surface, a terminal, an editor or a web page, is a client that draws the stream of events the run produces. A board only displays, though, and an agent UI can also send events back, such as an approval. In our design the log records it.

The Agent Client Protocol shows the shape. As of November 2026, at stable version 1, its `session/update` notifications carry message and thought chunks, tool calls with a kind and a status that runs from pending to in progress to completed or failed, and plan entries, while a separate `session/request_permission` request offers four choices: allow once, allow always, reject once and reject always [@acp-readme]. A chat view draws the messages and tool calls, a plan view draws the plan entries, and a review view draws what changed; the permission requests feed an approval the person answers. [[fig:one-log-three-views]] puts three views on one log.

:::figure[One event log feeding a chat view, a plan view and a review view: three views, one record]{#one-log-three-views}
::svg{alt="A box on the left labelled one event log, ordered and appended, in the accent. Three arrows lead to three boxes on the right: chat view, plan view and review view. Under them, small notes say messages and tool cards, steps and their status, and what changed, to keep or undo. A line below says three views, one record: an approval goes back in as an entry."}
:::

Your own SDK already emits such a stream. [[lst:ui-stream-parts]] reads the typed parts of an AI SDK run: lifecycle parts that mark a start and a finish, and a text delta for each piece of text. A UI that draws these parts as they arrive is a view of the stream, and a UI that stored them could draw the same run again later.

:::listing[A run as a stream of typed parts that a view can draw]{#ui-stream-parts file="verify/vercel-ai-sdk/examples/06-streaming.ts" region="stream-parts"}
:::

The harness plan applies the same idea one level down. Its session log is the contract: the transcript, the tool cards, the plan and the approval inbox are all projections of one ordered, append-only record. That is our recommendation and a plan, and the part that is hard is under the views. The server has to own the run apart from any connection, chunks need sequence numbers so a client can rejoin, and a pending approval has to be a stored record and not an in-memory promise.

## Undo covers the edits an agent made, and does not reach the actions it sent once they land

A person who watches an agent edit a document wants one more control: take that back. Our agent-UI research behind this chapter (the "report" below) found that agent undo is harder than it looks, and the design that fits the evidence has five parts, which are our recommendation and not a shipped feature.

Tag every write with its actor and a turn id, so that "undo the agent's last turn" is one query. Make the draft real, so that the agent's edits reach persistence only when the person presses Keep. List what changed and not what was asked for, because a request can report success while a cancel hid the change. Revert by inverse operations that keep later human edits, and report every key that could not be restored. And split actions by reversibility before they run. Saves, sends, deletes and deployments sit outside every undo layer the report surveyed, so they need a confirmation before they run, or a deferred commit with a visible countdown, as the report notes a mail client does with a delayed send.

The last part is the one that matters for the rest of the chapter. A review surface can show you what changed, and an undo button can restore it. Neither helps once a payment has gone out, so the click on Pay has to wait for a person before it happens.

## A browser agent sees a page as labelled elements, and a screenshot is the fallback

Describing a page to a model is like :analogy[describing a room by its labelled objects instead of sending a photo]{#labelled-room}. "A door on the left, a lamp on the table, a button labelled Save" carries what the agent can act on in a few words, where a photo makes it find the objects itself. That list is the accessibility snapshot, and by November 2026 it is the default page representation. Playwright MCP returns lines such as `- textbox "What needs to be done?" [ref=e5]`, and a ref stays valid "until the page changes" [@playwright-mcp-snapshots]. Chrome DevTools MCP tags nodes with a `uid`{checked=row-15} and tells the model to "Prefer taking a snapshot over taking a screenshot" (its tool reference, as the report's log records). Labels can be missing or wrong, so the report judges that a canvas, a video or a cross-origin frame still needs a screenshot, and it notes that Anthropic's browser tool tells the model to fall back to coordinates for what the tree does not describe.

A model also needs somewhere to run the browser. Every hosted browser the research covered hands out a Chrome DevTools Protocol URL, so the loop that decides what to do can stay outside the browser it drives. And the vendors' computer-use tools, which send screenshots and receive clicks and keystrokes, need one adapter in each SDK. The next section uses one of them.

## A person can watch and take over, if the agent pauses when they do

A driving instructor sits beside the learner with :analogy[dual controls]{#dual-controls}. The learner drives, the instructor can take the wheel at any moment, and the car has to know who is driving, or two sets of hands fight over one wheel. A browser agent needs the same arrangement. [[fig:dual-controls]] shows the two lessons side by side.

:::figure[A driving instructor's dual controls: the car must know who is driving, and a takeover is recorded]{#dual-controls analogy="dual-controls"}
::svg{alt="Two columns joined by the word like. On the left, a driving lesson in three steps: the learner drives, the instructor takes over, in the accent, and the learner lets go. On the right, an agent in a browser in three steps: the agent acts, a person takes over, in the accent, and the agent pauses. A line below says the car must know who is driving, and another says a takeover is recorded and the agent stops sending input."}
:::

Watching is the easy half. Chrome already streams itself: the DevTools Protocol's `Page.startScreencast`{checked=row-20}, still experimental as of November 2026, pushes each frame as a base64 image and waits for `Page.screencastFrameAck`{checked=row-20}, and its `maxFramesInFlight`{checked=row-20} parameter, 3 by default, caps how many unacknowledged frames Chrome sends, so a slow viewer slows the stream and does not grow a queue [@cdp-browser-protocol]. The same socket accepts the viewer's mouse and key input. Hosted browsers ship the feature already: Cloudflare's Browser Run has a Live View and a handoff command, and tells callers to treat a Live View URL as a credential, as the report's log records. For our own coding agent the research proposes a relay in the task's Durable Object. The loop holds the only connection that crosses the sandbox boundary, frames go out to viewers, and only a narrow input schema of mouse, key, text and scroll comes back, so a viewer cannot run script in the page or read its cookies. That relay is a design and not code.

Taking over is the hard half, and the agent's side of it is a pause. The OpenAI Agents SDK's computer tool gives a runnable picture of the pause. [[lst:computer-tool]] gives an agent the SDK's own `computerTool()` over an in-memory fake computer, with a scripted model that types an invoice number and then clicks Pay.

:::listing[A computer tool whose approval rule sees every action and pauses only the consequential one]{#computer-tool file="verify/openai-agents-sdk/examples/13-computer-use-approval.ts" region="computer-tool"}
::note[The rule asks whether the click lands on the Pay button. Typing runs at once; this click waits for a person.]{#consequential}
:::

The rule is asked about every action of every call, batched ones included, so a type and a keypress in one call each get the question. The run then pauses, with the Pay click not yet on the computer, and the paused state can be saved as a string and read back before a person decides [@openai-agents-human-in-the-loop].

:::listing[The run pauses at the Pay click and ends with one interruption]{#pause-run file="verify/openai-agents-sdk/examples/13-computer-use-approval.ts" region="pause" replay}
::note[The run ends at the Pay click with one interruption. The click has not reached the computer.]{#pause}
:::

:::listing[The saved state is read back, the person approves, and the run resumes]{#resume-run file="verify/openai-agents-sdk/examples/13-computer-use-approval.ts" region="resume"}
::note[The paused state is turned into a string and read back into a run state, which could happen in another process hours later.]{#save}
:::

After the pause, `approve()`{checked=row-27} lets the click through once, and `reject()`{checked=row-27} stops it for good: the computer receives nothing more. A rejected click is not silent to the model. The SDK sends it a fallback one-pixel image as the call's result with the rejection recorded only in the result's provider data, and then adds the assistant message "Tool execution was not approved." An action that throws gives the model an empty screenshot. These are the SDK's behaviours under 0.21.0, as of November 2026, where the tool is named `computer_use_preview` and the scripted model never sees a wire format.

The example shows the loop and the approval flow and nothing more. The computer is a list of what it was asked to do and the model is scripted, so it says nothing about how a real model or a real browser behaves. It also pauses a single call, which is not a takeover. A takeover needs more: the agent stops sending input while a person drives, the harness records that a person took over and when it handed back, and the next agent turn starts from the page the person left.

## The network and the credential are the browser's boundary, because the page can talk to the model

A browser is the textbook case of Willison's lethal trifecta: an agent that combines "private data, untrusted content, and external communication" [@willison-lethal-trifecta]. Any page load, form post or image request can carry data out, and any page can carry text the model reads as an instruction. Anthropic and OpenAI both say prompt injection is unsolved. Anthropic's Claude for Chrome pilot measured 23.6% attack success without mitigations and 11.2% with them across 123 test cases [@claude-for-chrome]. Attackers that adapt to the target do far better than a fixed baseline: NIST's evaluation institute found in January 2025 that the strongest baseline attack on AgentDojo reached 11% while attacks built for the target model reached 81% [@nist-agent-hijacking-evaluations]. The two figures come from different tests and do not compare directly.

So the designs that hold do not rely on the model to refuse. Meta's Rule of Two lets an agent combine at most two of untrusted input, sensitive access and external state change [@meta-rule-of-two], and its browsing assistant avoids sensitive access by running in a restrictive sandbox without preloaded session data. Google says its Chrome agent runs a deterministic check that restricts model-generated URLs to known, public ones [@google-architecting-agentic-security]. Logins belong to the host: Google also says Chrome's agent signs in through its password manager, with no direct model access to what is stored. The pattern is the one of the earlier chapter on sandboxes and credentials. A deterministic gate outside the model decides each consequential action, the credential is added outside the sandbox, and the egress allowlist refuses the metadata address and every private range before the browser reaches it.

That returns to the click on Pay. A person who watches sees the page, the plan and the pending approval, all drawn from one log. They steer by editing the plan or rejecting the call. They take over through a relay that the agent pauses for. And what the page says cannot widen what the agent may do, because the network it can reach and the credentials it can use were fixed before the page loaded.

## Exercises

1. **Replay a run's event log into two views, and show they agree.** In `verify/vercel-ai-sdk/examples/06-streaming.ts`, collect every part of `result.stream` into one array, the log. Build two views from that array alone: a chat view that joins the `text-delta` parts, and a step view that counts the `finish-step` parts. Before you run it, say what the chat view must equal and how many steps a one-answer run has. Then run `pnpm test` in `verify/vercel-ai-sdk` and check that the chat view equals `result.text` and the log replays to the same two views a second time.
2. **Ask about every click, and predict what pauses.** In `verify/openai-agents-sdk/examples/13-computer-use-approval.ts`, change the approval rule so that it returns true for every click, not only the click on Pay. Predict which calls pause, what `asked` holds when the first pause comes, and how many times you must approve before the invoice is paid. Run the example, change its checks to match your prediction, and say what a person watching would gain and lose by this rule.
3. **Design a takeover record.** Write the three log entries that record a takeover: the agent pausing, the person taking the controls, and the person handing back. Say what each carries, how the agent knows not to send input in between, and which view of the log would show a reviewer that a person, and not the agent, made a click.
