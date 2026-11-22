---
title: "Retrieval and long-term memory"
summary: An agent should carry a small, stable core in every request and fetch everything else through a search tool when a step needs it. This chapter shows why keyword search comes first, why the tenant filter must run before the ranking, how to measure a retriever, and how memory that outlives a task is written as sourced records, checked before use and forgotten by expiry, while its copies in the session log stay until the harness removes them.
opening: scenario
sources: [anthropic-effective-context-engineering, modarressi-nolima, anthropic-pricing, anthropic-prompt-caching, buildanagent-harness-plan]
glossary: [retrieval, context-window, prompt-cache, tool]
switchTo: [N23]
---

Your support agent now serves two customers, Acme and Globex, from one knowledge base of fourteen short articles. Three questions reach it in one week. On Monday an Acme admin pastes an error code, E4021, and asks what it means. On Tuesday another Acme user writes "I forgot my login credentials", in words that appear in no article. A month later someone asks whether deploys freeze on Fridays, a fact the agent stored thirty days earlier from a runbook that may have changed since. The first question needs the one article that holds the code. The second needs an agent that notices nothing matches, and the third needs a memory that knows when it has gone stale.

This chapter answers two questions with those three in mind. When should an agent fetch text instead of carrying it in every request, and how should memory that outlives a task be written, recalled and forgotten? Every listing runs offline against a scripted model, so each shows what reaches the model and never what a real model would do with it. The chapter's answer comes in four parts: carry a small, stable core and fetch the rest through a tool; rank with keywords first, filter by tenant before ranking and measure the retriever on labelled queries; store each lasting fact as a record with its source and an expiry, and check it before acting on it; and keep that memory in files until one of three signals says a service will pay for itself.

## Carry a small, stable core, and fetch everything else through a tool when a step needs it

You ask a reference librarian how to fix a failed export. Ten minutes later two books sit on your desk, chosen from a hundred thousand, and you never see the rest. :analogy[A reference librarian who fetches the few books you need]{#reference-librarian} is what retrieval does for an agent. Retrieval means fetching text into a model request only when a step needs it, through a tool call or a search the harness runs. Carrying means the opposite: putting text into every request, whether the step needs it or not. Anthropic calls the first approach "just in time": agents "maintain lightweight identifiers (file paths, stored queries, web links, etc.) and use these references to dynamically load data into context at runtime using tools" [@anthropic-effective-context-engineering].

:::figure[A reference librarian who fetches the few books you need: the stacks stay out of sight, and the librarian's choice decides what reaches your desk]{#reference-librarian analogy="reference-librarian"}
::svg{alt="On the left, a box labelled the stacks holds rows of small book shapes, with notes under it: 100,000 books, like the corpus. In the middle, a box labelled the librarian, ranks the stock, receives an arrow from above marked question: failed export, and a note under it reads like the search tool and its ranking. An arrow runs from the stacks into the librarian, and another from the librarian to a box on the right labelled your desk, which holds two books numbered 1 and 2, with the notes two books and like the request."}
:::

Why not carry the whole stock? [[ch:the-session-log-and-context]] treated the context window as a desk with limited space, and a crowded desk costs more than room. Long inputs lose quality well before the window fills. NoLiMa tested 13 models that each claim at least 128K tokens of context, and at 32K tokens 11 of them scored half or less of their short-input score [@modarressi-nolima]. GPT-4o, the strongest of the thirteen, fell from 99.3% at short lengths to 69.7% at 32K. The test is a hard case on purpose. Each question shares almost no words with the sentence that answers it, so the model has to make an association rather than match a word, and the authors say models "often rely on surface-level cues in longer contexts". A long input that hands the model the exact words it needs is easier, which is no comfort for the questions users actually write.

Carrying is cheap only while the carried text stays the same. A prompt cache stores the front of earlier requests, and as of November 2026 Anthropic bills a cache hit at 0.1 times the base input price on most models, and at 0.05 times on Claude Opus 5.5 and Claude Sonnet 5.5 [@anthropic-pricing]. Any edit spoils the saving, because "Modifications to cached content can invalidate some or all of the cache", and a change to the tools or the system prompt invalidates every level after it [@anthropic-prompt-caching]. A cache also lowers the price of carried tokens, not their cost to the model's attention, which the NoLiMa result measures.

Our rule follows from those two facts. It is our synthesis, and no source states it whole. Carry a body of text in every request only when all four conditions hold:

1. it stays unchanged for the cache's lifetime;
2. it is small, well under the 32K tokens where NoLiMa's losses are large;
3. most requests need much of it, as when every answer compares several documents;
4. requests reuse it often enough to repay the cache write.

Fetch everything else, and keep a pointer to it in the request instead of the text. Claude Code is Anthropic's own example of the split: "CLAUDE.md files are naively dropped into context up front, while primitives like glob and grep allow it to navigate its environment and retrieve files just-in-time, effectively bypassing the issues of stale indexing and complex syntax trees" [@anthropic-effective-context-engineering]. The same page names the price, since "runtime exploration is slower than retrieving pre-computed data". A fetch costs a model call and a tool call, and you pay that only for the steps that need the text.

Our harness plan already keeps pointers in three places, each from an earlier chapter. Its first context layer caps a tool result at 64 KiB and spills the rest to a file that the agent can reread by path. Its tool registry can mark a tool `"deferred"`, so the request carries the tool's name and the definition arrives only after a search, and MCP tools start that way. Skills appear in the prompt as a name, a description and a path, and their bodies load through the ordinary read tool [@buildanagent-harness-plan]. [[ch:tools-at-scale]] covered the last two. A search tool over documents is the fourth pointer: the request carries the tool, and the documents stay in the stacks until a query asks for them.

[[lst:search-tool]] is that tool in the AI SDK. It searches the fourteen articles from this chapter's opening with BM25, a keyword ranking that the next section explains, written by hand in the same file so that no search package or embedding service is involved.

:::listing[A search tool for one tenant: the model writes the query, and the session decides whose documents it searches]{#search-tool file="verify/vercel-ai-sdk/examples/17-keyword-retrieval.ts" region="search-tool" replay}
::note[The tenant filter runs on the documents before they are ranked, and the next section shows why the order matters. The tenant comes from `searchTool(tenant)`, which your code calls with the signed-in session's tenant; the schema gives the model only `query`.]{#filter-first}
:::

The replay's first run is Monday's question. The scripted model calls `search_docs` with "What does E4021 mean?", and the tool returns one article, kb-01, "Export failed with E4021", with a score of 2.54. kb-01 is the only Acme article that holds the code, and a rare word such as an error code is exactly what keyword ranking rewards. The model's next request carries that one result, and its answer repeats the article's text, because the script tells it to repeat the first result. The model never sees the other thirteen articles, Globex's copy of the same error page included. The librarian's choice decides what reaches the desk, and the next section is about how that choice can go wrong.

## Exercises

1. **Search for a question in its own words, then in yours.** In `verify/vercel-ai-sdk/examples/17-keyword-retrieval.ts`, add a run of the file's ask helper with "my export stopped, quota full" for Acme. Before you run it, predict which articles the tool returns and in what order, and write the prediction as a check on the last recorded search. Run `pnpm test` in `verify/vercel-ai-sdk`, read the new run in `results/transcripts/17-keyword-retrieval.json`, and restore the folder with `git checkout -- examples results` when you are done.
