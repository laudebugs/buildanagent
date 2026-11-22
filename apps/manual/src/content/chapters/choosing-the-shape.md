---
title: "Choosing the shape: buy, adopt or build, how to plan, and when subagents pay"
summary: An agent's shape is three choices made before any prompt is written. This chapter sorts the SDKs by who owns the loop, says why to start planning with ReAct, separates workflows, routing and handoffs by who decides the next step, and runs one subagent to show what it keeps out of the parent's context and what it adds to the bill.
opening: fact
sources: [anthropic-multi-agent-research-system, claude-agent-sdk-hosting, claude-agent-sdk-overview, copilot-sdk-nodejs-readme, openai-agents-running-agents, pi-how-pi-works, ai-sdk-generate-text, cloudflare-agents-chat-agents, buildanagent-sdk-readme, liu-what-does-a-harness-buy]
glossary: [agent, agent-loop, harness]
switchTo: [B19b]
---

In Anthropic's own data, an agent typically uses about four times the tokens of a chat, and a system of several agents about fifteen times [@anthropic-multi-agent-research-system]. Those are two separate measurements, and each multiple is the price of a shape: the first of a loop, the second of dividing the work among several loops. A team that picks its shape by habit pays that price on every request.

Three choices fix an agent's shape before anyone writes a prompt: who owns the loop, how the work is planned, and how many agents share it. This chapter takes them in turn. It sorts the SDKs by who owns the loop, then starts planning from ReAct and says when a plan or a reflection earns its extra model calls. It separates workflows, routing and handoffs by who decides the next step, and runs one subagent to show what it keeps out of its parent's context and what it adds to the bill. It ends with an exercise that rewrites one handoff three ways and compares the calls.

## Who owns the loop decides between buying, adopting and building, and moving later costs a rewrite

You have a month to ship an agent that fixes failing tests in a customer's repository, and there are three ways to get its loop. :analogy[Renting a furnished flat, leasing an empty one or building a house]{#flat-lease-house} is the same choice in housing. The furnished flat is lived in this week with someone else's furniture, the empty lease lets you choose every piece, and the house gives you the foundations as well. The picture breaks at the exit. A tenant moves out with a van, but an agent's tools, hooks and prompts are written against one loop's vocabulary, so changing the loop costs a rewrite of whatever you built on top.

The precise question is who runs the loop. Buying means a vendor's program runs it and you configure it. When your code calls `query()`{checked=row-2}, the Claude Agent SDK starts a separate `claude`{checked=row-2} process, and that process owns the shell, the working directory and the session transcripts [@claude-agent-sdk-hosting]. The SDK is Claude Code as a library, with "the same tools, agent loop, and context management that power Claude Code" [@claude-agent-sdk-overview]. GitHub's Copilot SDK likewise controls the Copilot CLI over JSON-RPC [@copilot-sdk-nodejs-readme]. Adopting means a loop that runs in your own process. The OpenAI Agents SDK runs an agent with its `Runner`{checked=row-6} [@openai-agents-running-agents], Pi's TypeScript SDK creates and controls agent sessions in process [@pi-how-pi-works], and the Vercel AI SDK puts its tool loop inside `generateText`{checked=row-8} [@ai-sdk-generate-text]. LangChain.js and Google ADK also run in your process. Cloudflare Agents splits the work. The platform hosts each agent as a Durable Object, and the chat agent's loop is a call to the AI SDK's `streamText`{checked=row-9} that you write [@cloudflare-agents-chat-agents]. Building means the loop is yours to change, as the one this book builds is [@buildanagent-sdk-readme]. [[fig:three-tiers]] places the eight SDKs this book verifies, as of November 2026.

:::figure[Three tiers of loop ownership: a vendor runs the loop you buy, your process runs the one you adopt, and you change the one you build]{#three-tiers}
::svg{alt="Three columns. Buy, a vendor's program: Claude Agent SDK and Copilot SDK. Adopt, a library loop: OpenAI Agents SDK, Vercel AI SDK, LangChain.js, Google ADK, Pi and Cloudflare Agents. Build, a loop you own, drawn in the accent: the buildanagent SDK. Below the columns, a dashed line, and under it: the vendor runs it, your process runs it, you change it."}
:::

Three questions place a team in a tier. Do you need to control the loop, for example its compaction or its turn scheduling? Must you stay portable across model vendors? Does your agent look like a coding agent? The answers are our judgement, drawn from the vendors' documents, and [[tbl:shapes]] gives the starting point each one suggests.

:::table[Where each situation should start, our reading of the vendors' documents as of November 2026]{#shapes}
| If this describes you | Start with | Why |
| --- | --- | --- |
| A coding or filesystem agent, a small team and a fast start | Buy the Claude Agent SDK | The loop, the tools and the context management come tuned, and you configure them [@claude-agent-sdk-overview] |
| A chat or workflow agent, or several model vendors | Adopt a library loop | It runs in your process, so your tests drive it directly and your code decides what surrounds it |
| Custom compaction, routing, cost control or model portability is your product | Build the loop, and buy sandboxes and observability | None of the vendor loops we verified gives custom compaction, full loop control and portability across vendors together |
:::

The case for buying is weaker than a vendor's score table suggests. One study ran seven models through three production coding harnesses, Claude Code, mini-SWE-agent and OpenCode, and reran each setup unchanged. A harness swap changed the outcome of about as many tasks as a rerun of the same harness did: both changed 13% of the 45 tasks in its two hardest difficulty bands at the median. Cost was what differed between harnesses, from under 10% to three or four times, depending on the model [@liu-what-does-a-harness-buy]. That is no reason to buy a loop for a better score, though the time it saves and the work it was tuned for can still be reasons. Whatever the tier, keep your evaluations and your telemetry in your own hands, because they are what let you leave a tier when the numbers turn.

## Exercises

1. Placeholder exercise, to be written with the last section.
