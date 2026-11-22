---
title: "Tools at scale: the registry, deferred tools, MCP and skills"
summary: An agent with dozens of tools stays usable when one registry names and gates every tool and most definitions stay out of the request until the model asks. This chapter shows tool selection and deferral in checked listings, what MCP's 2026-07-28 revision changes for a client, and how skills load on demand and when to delegate to another agent over A2A. It runs our harness beside the others and marks which parts of it are built.
opening: fact
sources: [anthropic-advanced-tool-use, claude-agent-sdk-tool-search, pi-mcp-servers, pi-sdk-docs, buildanagent-harness-readme, buildanagent-harness-alpha, santra-acam, anthropic-model-context-protocol, mcp-tools-spec, mcp-changelog-2026-07-28, mcp-deprecated-features, mcp-versioning, mcp-server-discover, mcp-multi-round-trip-requests, ai-sdk-mcp-tools, cloudflare-agents-mcp-client, copilot-sdk-nodejs-readme, mcp-authorization, a2a-spec, a2a-releases, adk-a2a-intro, claude-multi-agent-guidance, a2a-js-sdk, guirao-agent-cards, kumar-name-collision, ms-agent-framework-a2a, anthropic-agent-skills-overview, claude-agent-sdk-skills, pi-skills, wang-voyager, ruan-skillcfi]
glossary: [tool, mcp, a2a, agent-card, tool-registry, deferred-tool, skill]
switchTo: [N11, N21, N22, N23, N24]
---

Five MCP servers, 58 tools and about 55,000 tokens: that is what Anthropic estimated in November 2025 for a setup with GitHub, Slack, Sentry, Grafana and Splunk, before the conversation had started [@anthropic-advanced-tool-use]. The post gives no method for the figure, but the arithmetic holds for any agent. Every tool you register puts its name, description and schema into every request, and the Claude Agent SDK's documentation says selection accuracy "degrades with more than 30-50 tools loaded at once" [@claude-agent-sdk-tool-search].

This chapter answers one question: how does an agent with dozens of tools stay usable, and how do MCP servers and skills fit after MCP's 2026-07-28 revision? The answer starts with one registry that names and gates every tool, and with deferral, which keeps most definitions out of the request until the model asks for them. MCP then brings in tools you did not write, A2A hands whole tasks to agents someone else owns, and skills bring in procedures instead of tools. Each section shows its mechanism in a listing that CI runs, and says where our own harness is built and where it is still a design.

## One registry should name, defer and gate every tool, whatever its source

Suppose your agent ships with six built-in tools and you connect a GitHub server and a Slack server. By evening it holds dozens of tools from three origins, and three questions each need one answer. What is each tool called, so that a rule or a log line can point at it? Does the model receive the tool's whole definition, or only a hint that it exists? And may this call run?

The SDKs answer these separately, each in its own corner. Naming is the first corner. Pi calls an MCP tool `mcp__github__create_issue`{checked=row-4}, replaces every character other than letters, digits and underscores, and adds a hash suffix to the tools of a server whose cleaned names collide [@pi-mcp-servers]. [[ch:tools]] showed the Claude Agent SDK's version of the same prefix. Selection is the second corner. Our harness, `@buildanagent/harness`, and Pi each let you choose the tools the model may use, and [[lst:select-ours]] and [[lst:pi-active-tools]] show both [@pi-sdk-docs]. Our tab comes first wherever a listing has one.

::::tabs
:::listing[Our harness]{#select-ours file="packages/harness/examples/04-tool-selection.ts" region="active-tools"}
::note[`scripted` puts our SDK's test model behind the gateway's `createModel()`, so the turns need no key and send nothing over the network. A real run passes a model from `createModel()` and nothing else changes.]{#scripted}
::note[A turn's `tools` list names the registered tools its requests may send, by name or alias, and the requests send them in registration order. This turn can only read and search.]{#allowlist}
::note[A turn has no exclusion option, so this list is every registered tool except `bash` and `write`, which leaves `read`, `edit`, `grep` and `glob`.]{#exclude}
::note[An empty list sends no tool at all. Leaving `tools` out offers every registered tool, and deferred tools still wait for a search.]{#none}
:::
:::listing[Pi]{#pi-active-tools file="verify/pi/examples/03-tool-selection.ts" region="active-tools"}
::note[An allowlist replaces the default set, so this session can only read.]{#allowlist}
::note[An exclusion starts from the defaults and removes two tools, which leaves `read` and `edit`.]{#exclude}
::note[`noTools: "builtin"` leaves the model with none of the built-in tools.]{#none}
:::
::::

An unlisted tool is not on the menu, so the model never sees its definition. A model can still ask for a tool by name, though, and what happens next is part of the gate. [[lst:inactive-ours]] and [[lst:pi-inactive-call]] script that request, and in both the answer is an error result the model can read, not a crash.

::::tabs
:::listing[Our harness]{#inactive-ours file="packages/harness/examples/04-tool-selection.ts" region="inactive-call"}
::note[The scripted model asks for `glob`, which the registry holds but this turn does not offer.]{#scripted-glob}
::note[Only `read` is offered.]{#only-read}
::note[The call yields an error tool result. The text the model reads says that no tool has that name and lists the tools on offer.]{#error-result}
::note[The loop sends a second request instead of ending the run.]{#continues}
:::
:::listing[Pi]{#pi-inactive-call file="verify/pi/examples/03-tool-selection.ts" region="inactive-call"}
::note[Only `read` is active, but the scripted model asks for `ls`.]{#only-read}
::note[The call yields an error tool result, which the model reads on its next request.]{#error-result}
::note[The loop sends a second request instead of ending the run.]{#continues}
:::
::::

The third corner, whether a call may run, lives in other code again, as [[ch:approvals-guardrails-and-injection]] showed. Three answers in three places drift apart, and a rule that names a tool one way while a log records it another way protects nothing. A harness that owns the loop can ask for one place, which our harness calls the tool registry. As of November 2026, `@buildanagent/harness` ships the registry, `createToolRegistry`{checked=row-8}, as an alpha that npm serves under the `alpha`{checked=row-160} tag [@buildanagent-harness-alpha]. It takes tools from four origins (built-in, extension, client and MCP server) and settles the three questions at registration, once.

:::figure[One registry names every tool once, sets what each request carries and feeds the permission pipeline]{#one-registry}
::svg{alt="Four boxes on the left, built-in tools, MCP server tools, extension tools and client tools, each with an arrow into one tall box labelled one registry. Inside it are three boxes: names it once, with the example mcp__github__x; sets exposure to direct, deferred or hidden; and marks trust, with MCP output untrusted. Two arrows leave the registry. One goes to a box saying each request carries direct tools plus tool_search. The other goes to a box saying the permission pipeline decides every call."}
:::

The registry answers the questions in this order. It gives each tool a canonical name of 1 to 64 characters, namespaces an MCP tool as `mcp__<server>__<tool>`{checked=row-10}, and throws a `DuplicateToolError`{checked=row-10} when a second tool takes a name. An extension may replace a built-in only by registering with `override: true`{checked=row-11}, and an MCP tool may never replace anything [@buildanagent-harness-readme]. It sets an exposure for each source, `direct`{checked=row-13}, `deferred`{checked=row-13} or `hidden`{checked=row-13}, and defaults MCP tools to `deferred`{checked=row-13} and every other source to `direct`{checked=row-13}. It marks an MCP tool's output untrusted, because the server wrote it and you did not, and it hands each run its definitions in registration order, so the cached prefix of a request does not move when a tool activates.

The permission pipeline reads the same description. It decides every call in one order, hooks first, then deny rules, ask rules, the mode, allow rules, the host callback and a default for what no rule settled. A deny at any step ends the decision, and a hook or callback that throws counts as a deny. Each verdict, allows included, becomes a `permission_decision`{checked=row-17} entry in the session log [@buildanagent-harness-readme]. Because the registry named the tool and marked its trust before the call reached the pipeline, a rule written for `mcp__github__create_issue`{checked=row-10} matches the tool that actually runs and a log reader finds it under the same name.

Our harness builds its tools as of November 2026 (todo `N21`{checked=row-161}). `builtinTools()`{checked=row-161} returns `read`, `write`, `edit`, `bash`, `grep` and `glob`, plus `fetch` once you give it an egress proxy. Each reaches files, commands and the web only through the sandbox or the proxy. Two limits keep this honest. First, our MCP client lacks the HTTP and legacy SSE transports (todo `N25`{checked=row-165}), so it reaches a server only over stdio or in this process. Second, a registry records where a tool came from and how far to trust its output, but it never reads the tool's code. ACaM, a November 2026 paper, calls the resulting gap Description-Code Inconsistency: "nothing enforces that the description and its implementation agree" [@santra-acam]. Across 43 unmodified real-world agents, its tool surfaced 123 code-execution and credential-exposure paths that the authors checked by hand [@santra-acam].

## Deferring a tool keeps its definition out of the request until the model asks for it

Ask a hardware-store clerk for a hole saw, and the clerk walks to the back room, because :analogy[a hardware store shelves the common tools and fetches the rest from the back room]{#hardware-store-back-room}. Hammers and tape measures hang in plain sight, while the hole saw and the pipe die set wait out of sight. A deferred tool follows the same plan. The request carries a name for it, with no description and no schema, and the model receives the definition only after it searches for the tool and the SDK loads the match [@claude-agent-sdk-tool-search].

:::figure[A hardware store that shelves the common tools and fetches the rest from the back room: the shelf is the tools every request carries]{#back-room analogy="hardware-store-back-room"}
::svg{alt="Two panels side by side. The left panel, the shelf in plain sight, holds a hammer, a tape measure and screws, and a note says it is like the tools every request carries. The right panel, the back room where tools are asked for, holds a hole saw, a pipe die set and a tile cutter, and a note says it is like the tools a search loads on the next step. An arrow labelled asks runs from the shelf to the back room, and an arrow labelled brings runs back."}
:::

The saving is large once the shelf holds dozens of tools. Anthropic estimates 50 or more MCP tools at about 72,000 tokens of definitions, about 77,000 tokens in all before any work, against about 8,700 tokens with its tool search tool, which loads about 500 tokens up front and three to five discovered tools at about 3,000 [@anthropic-advanced-tool-use]. In the same post, Anthropic reports that Opus 4 improved from 49% to 74% on its MCP evaluations with tool search, and Opus 4.5 from 79.5% to 88.1%. Both are Anthropic's own internal tests, published in November 2025, and the post gives no eval size, so treat them as a direction and not a rate.

[[lst:deferred-server-ours]] and [[lst:deferred-server]] show how little code the choice takes in our harness and in the Claude Agent SDK. In each, three tools sit in one server, the server is deferred by default, and a second copy of it opts out.

:::::tabs
:::listing[Our harness]{#deferred-server-ours file="packages/harness/examples/05-deferred-tools.ts" region="deferred-server"}
::note[An MCP server is deferred by default: no request carries its tools, or even their names, until tool search finds one.]{#deferred-default}
::note[`exposure: "direct"` puts every definition of this copy into every request, so no search is needed.]{#always-load}
:::
:::listing[Claude Agent SDK]{#deferred-server file="verify/claude-agent-sdk/examples/08-deferred-tools.ts" region="deferred-server"}
::note[A deferred server: the model sees these tools' names, not their schemas, until it searches.]{#deferred-default}
::note[`alwaysLoad: true` puts every definition into the first request, so no search is needed.]{#always-load}
:::
:::::

[[lst:deferred-checks-ours]] and [[lst:deferred-checks]] hold what each example asserts about the first request and the one after it, and each replay steps through the run with a mock model standing in for the choice. In the Claude Agent SDK, the first request offers a search tool, `ToolSearch`, and no weather definition. The model still knows each tool's name, because the CLI behind the SDK lists the names in a message, but it has no description or schema to read. It calls `ToolSearch` for one tool by name, and the next request carries that single definition. The other two never reach the model in any request, and the eager server from [[lst:deferred-server]] sends all three at once and never offers `ToolSearch` at all. Our harness differs in one way: its first request names no deferred tool, because the registry sends a name only with its definition, so the model finds a tool by describing what it needs.

:::::tabs
:::listing[Our harness]{#deferred-checks-ours file="packages/harness/examples/05-deferred-tools.ts" region="deferred-checks" replay}
::note[The scripted model asks `tool_search` for "forecast", then calls the tool the search found.]{#scripted}
::note[The first request holds no definition of the deferred server's tools.]{#no-definition}
::note[It does not name them either, so the model must describe what it needs. The Claude Agent SDK's request lists the names.]{#names-hidden}
::note[The eager copy's three tools are in the first request, beside `tool_search`.]{#eager-sent}
::note[The search matched the words of one tool's name and description, and it recorded that tool in the `activated` set.]{#select-one}
::note[One of the three definitions reached the model after the search.]{#one-loaded}
:::
:::listing[Claude Agent SDK]{#deferred-checks file="verify/claude-agent-sdk/examples/08-deferred-tools.ts" region="deferred-checks" replay}
::note[The model is offered the search tool and no weather definition.]{#no-definition}
::note[Names stay visible, so the model knows what to search for.]{#names-only}
::note[The mock model asks `ToolSearch` for one tool by name.]{#select}
::note[One of the three definitions reached the model after the search.]{#one-loaded}
:::
:::::

The analogy stops at the customer. A shopper who never asks for the pipe die set never learns the store has one, and a model finds a deferred tool only when its search words match the tool's name or description. The back room also costs a model more than minutes. Each search adds one round trip, and the Claude Agent SDK's documentation says that with fewer than about ten tools whose definitions fit comfortably, loading everything upfront is typically faster [@claude-agent-sdk-tool-search]. A loaded definition also stays in the context for later turns, until the SDK compacts the messages where the model found it. So the shelf should hold the tools your agent uses on most runs, and `alwaysLoad` is the setting that puts them there. Finding the rest depends on words: the search matches a query against tool names and descriptions, and the SDK's documentation notes that `search_slack_messages`{checked=row-28} surfaces for a wider range of requests than `query_slack`{checked=row-28} [@claude-agent-sdk-tool-search]. Pi sends the same signal at the server level, because it lists a server's `description`{checked=row-34} in the system prompt and ranks the server's tools by it when `tool_search`{checked=row-33} runs [@pi-mcp-servers].

Our harness builds the same mechanism into its registry, as of November 2026, and [[lst:deferred-checks-ours]] runs it. MCP tools default to `deferred`{checked=row-13}, and `tool_search`{checked=row-35} is a registered tool that matches the words of a query against the names, aliases and descriptions of deferred tools, ignores common words and words under three letters, and records up to five matches in an `activated`{checked=row-35} set [@buildanagent-harness-readme]. An interceptor then sets each request's `activeTools`{checked=row-37} to the run's tools, the activated names and `tool_search`{checked=row-35}, so a deferred tool is absent from one request and present in the next.

A `hidden`{checked=row-13} tool never appears in a search, because hiding a tool means the model should not learn it exists. The registry also estimates the tokens that `direct`{checked=row-13} tools add before any message, which makes the saving visible at session start. Pi's four exposure levels, `codemode`{checked=row-33}, `deferred`{checked=row-33}, `direct`{checked=row-33} and `hidden`{checked=row-33}, rest on the same split: sending a tool, finding a tool and denying a tool are different decisions, and a registry that keeps them apart lets you change one without touching the others.

## MCP's 2026-07-28 revision makes every request stand alone and turns a server's questions into results

Anthropic announced MCP in November 2024 as an open standard that replaces fragmented integrations with a single protocol [@anthropic-model-context-protocol], so any client that speaks it can use any server's tools, much like :analogy[a USB port: one plug shape for many devices]{#usb-port}. The comparison stops at trust. A mouse only moves a cursor, while an MCP server is closer to installed software. It chooses its tools' names, descriptions and results, and the specification tells clients to treat a tool's annotations as untrusted unless the server is trusted, and to keep a human able to deny tool calls [@mcp-tools-spec]. That is why the registry from the first section marks MCP output untrusted.

Connecting takes little code, and each of the four clients below puts it in a different place. Our harness's `createMcpManager()` connects each server in a list and registers its tools in the tool registry. The AI SDK converts a server's tools into its own and hands them to `generateText`. Cloudflare's `Agent` class connects and holds the connection for you. The Copilot SDK starts the server inside its runtime and renames each tool `<server-key>-<tool-name>`{checked=row-66}, here `orders-order_status`. [@ai-sdk-mcp-tools; @cloudflare-agents-mcp-client; @copilot-sdk-nodejs-readme]. Our harness names the same tool `mcp__orders__order_status`.

::::tabs
:::listing[Our harness]{#mcp-ours file="packages/harness/examples/06-mcp-client.ts" region="mcp-client"}
::note[The server runs in this process, over a channel from the server library's in-memory transport. A stdio server takes `{ kind: "stdio", command, args }` here instead, and the harness starts it with a cleared environment. No HTTP transport is built.]{#connect}
::note[The client sent `server/discover` first, and this server answered, so it connects in the 2026-07-28 era. A server that refuses the probe connects as `legacy`{checked=row-169} after an `initialize`{checked=row-61}.]{#era}
::note[The registry names the tool `mcp__orders__order_status`.]{#name}
::note[An MCP tool is deferred by default, so a model finds it only through tool search.]{#exposure}
::note[`setExposure()` sends this server's tools in every request, so the loop below needs no search.]{#direct}
::note[`scripted` puts our SDK's test model behind the gateway's `createModel()`, so the run needs no key. A real run passes a model from `createModel()`.]{#scripted}
::note[The gate is the harness's permission pipeline. This rule allows the orders server's tools, and a call that no rule allowed would be denied, because nobody can answer.]{#gate}
::note[`runTurn()` runs the turn through the harness, so the call goes through the gate and the registry's tools reach the model.]{#loop}
::note[The pipeline decided the call, and the session's log recorded the decision.]{#decided}
::note[The server wrote this result, not you, so the registry marks its output untrusted.]{#untrusted}
:::
:::listing[AI SDK]{#mcp-ai file="verify/vercel-ai-sdk/examples/08-mcp-tools.ts" region="mcp-client"}
::note[The transport here is an in-process server. A real one is HTTP or stdio.]{#connect}
::note[`client.tools()` turns the server's tools into AI SDK tools, keyed by name.]{#convert}
::note[The tools go straight into the normal loop.]{#loop}
::note[This server answers an `initialize`{checked=row-61} handshake, so the example shows the legacy path, not the stateless one.]{#handshake}
:::
:::listing[Cloudflare Agents]{#mcp-cloudflare file="verify/cloudflare-agents/examples/07-mcp.ts" region="mcp-client"}
::note[`addMcpServer` connects and returns the connection's state and id.]{#add}
::note[Each listed tool records the id of the server it came from.]{#list}
::note[`getAITools` hands the tools to an AI SDK model call.]{#ai-tools}
:::
:::listing[Copilot SDK]{#mcp-copilot file="verify/copilot-sdk/examples/07-mcp-server.ts" region="mcp-config"}
::note[The runtime starts this server as a subprocess; `tools: ["*"]` offers all its tools, and `[]` would offer none.]{#server}
::note[Every MCP call asks the permission callback, as any other tool does.]{#permission}
::note[The model sees the tool as `orders-order_status`.]{#name}
::note[The request kind is `mcp`, so your callback can tell an MCP call from a file edit.]{#kind}
:::
::::

These listings show connecting, not the revision. The AI SDK example speaks the legacy handshake, the Cloudflare example does not show which era its client chose, and ours reports the era its probe found without showing what that era changes. What the 2026-07-28 revision changes is the conversation behind these calls, and [[tbl:mcp-changes]] sets the old and new designs side by side [@mcp-changelog-2026-07-28; @mcp-deprecated-features].

:::table[What the 2026-07-28 revision changes for an MCP client]{#mcp-changes}
| Concern | Before 2026-07-28 | In 2026-07-28 |
| --- | --- | --- |
| Opening a connection | An `initialize`{checked=row-41} handshake, then a session id header | No handshake and no session: every request carries its version and capabilities in `_meta`{checked=row-41} |
| Learning what a server offers | The handshake's reply | An optional `server/discover` call, which every server must answer |
| A server needing the user | The server sends its own request mid-call | The call returns an `input_required`{checked=row-49} result, and the client retries with the answers |
| Roots, Sampling, Logging | Active features | Deprecated, still working, removable from the first revision on or after 2027-07-28 |
| Registering a client with an authorization server | Dynamic client registration | Deprecated in favor of Client ID Metadata Documents |
:::

The first change makes a request self-contained. There is no handshake and no session id, and every request names the protocol version and the client's capabilities in `_meta`{checked=row-41}. A server that supports a different version answers with `UnsupportedProtocolVersionError`{checked=row-41}, which lists the versions it does support, and the client retries with one of them [@mcp-changelog-2026-07-28; @mcp-versioning]. A server that needs state across calls hands out an explicit handle, and the handle travels as an ordinary tool argument. No instance needs the memory of an earlier request, and the specification says the retry flow described below needs no shared storage layer across server instances and no stateful load balancing [@mcp-multi-round-trip-requests].

The second change gives clients a way to ask first. Every server must implement `server/discover`, which reports its supported versions, capabilities and identity, and a client may call it before anything else, though it need not [@mcp-server-discover]. It matters most on stdio, where there is no HTTP status to react to. A client that wants to work with old and new servers probes with `server/discover` and falls back to `initialize`{checked=row-41} on any error that is not a recognized modern one. On HTTP it sends a modern request and inspects the body of a 400 reply before falling back, and in both cases it remembers the answer for the server process or origin [@mcp-versioning]. A client built only for the new revision fails against an old server, so the dual-era client is the safe default for as long as you connect to servers you do not control. The AI SDK documents exactly this behavior for its stdio transport, and Cloudflare Agents negotiates for every connection [@ai-sdk-mcp-tools; @cloudflare-agents-mcp-client].

The third change moves the server's questions into its answers. Suppose a tool needs your GitHub username before it can run. In the old design the server sent a request of its own in the middle of the call. In the new one the call returns an `input_required`{checked=row-49} result, with `inputRequests`{checked=row-49} that name what it needs, and the client gathers the answers and retries the same request with `inputResponses`{checked=row-49} [@mcp-multi-round-trip-requests]. The server keeps nothing between the two requests. It folds what it needs into an opaque `requestState`{checked=row-50} string, and the client echoes it back unchanged. Every result now carries a `resultType`{checked=row-53} of `complete`{checked=row-53} or `input_required`{checked=row-49}, and a client treats a missing one as `complete`{checked=row-53}.

For an agent, this means a tool call can come back asking for a person. Your loop must be able to pause there and resume, which is the job of [[ch:approvals-guardrails-and-injection]]. Cloudflare Agents handles it for you: the SDK invokes your elicitation handler, sends the answer and continues the original call, which stays pending in memory while the person answers. A hibernation or isolate restart loses that call, and the caller retries [@cloudflare-agents-mcp-client]. Where a call must survive such a restart, [[ch:durable-and-portable-agents]] returns to the problem. The specification also repeats a warning from the approvals chapter. A server must treat `requestState`{checked=row-50} as attacker-controlled input, because the client holds it between the two requests, and when it influences authorization or business logic the server must protect its integrity with an HMAC or authenticated encryption and reject state that fails verification [@mcp-multi-round-trip-requests].

The fourth change is a set of deprecations. The revision deprecates Roots, Sampling and Logging, and the dynamic client registration protocol. They keep working through a deprecation window of at least twelve months, and the earliest revision that may remove them is the first one released on or after 2027-07-28, so the dates are a floor and not a schedule [@mcp-deprecated-features; @mcp-changelog-2026-07-28]. The migrations point away from the protocol. Pass directories and files as tool parameters instead of Roots, call model providers directly instead of using Sampling, and log to stderr or send OpenTelemetry instead of using Logging. The revision also removes `ping`{checked=row-56}, `logging/setLevel` and the roots change notification, and a client sets the log level on each request in `_meta`{checked=row-41}. In short, build nothing new on the deprecated features.

Our own MCP client connects to servers over stdio and in this process as of November 2026, and [[lst:mcp-ours]] connects one in this process. It probes each server with `server/discover` and falls back to `initialize`{checked=row-157}, registers each server's tools as deferred tools by default, and sends every call through the permission pipeline. It refuses `input_required`{checked=row-158}: a server's request for input fails the call, because the owner chose to keep it failing until a pause has a safe form. A proposal in our source-update report would instead turn each input request into a pause that a person answers through a signed approval, but it is not adopted. Todo N25 adds the HTTP transports, so treat them as intent, not behavior.

## A2A hands a task to an agent whose plan someone else owns

Your support agent gets the question "Is invoice inv-7 paid?", and the billing team that can answer it runs its own agent, with its own model, tools and database. You cannot read that agent's tool list or its plan. You can only ask. The setup resembles :analogy[firms that contract through a standard purchase order]{#purchase-order}: the buyer says what it wants and not how to make it, the supplier owns the process, and the delivery note stands for what comes back. A2A, the Agent2Agent protocol, is that standard form for agents, and this section describes it as of November 2026, at version 1.0.

The Linux Foundation's A2A project tagged 1.0.0 on 12 March 2026 and patched it as 1.0.1 on 28 May 2026 [@a2a-releases]. Patch numbers do not affect compatibility, so both mean protocol 1.0 [@a2a-spec]. The supplier publishes an Agent Card, a JSON document usually served at `/.well-known/agent-card.json`, that names the agent, describes its skills in prose and lists the addresses and bindings it answers on. The caller sends `SendMessage`{checked=row-111}, and the reply is either a direct message or a `Task`{checked=row-111}. A task has nine state values: four are final (completed, failed, canceled and rejected), and two are pauses, input required and auth required. Results come back as artifacts, because the specification says messages should not carry task outputs. The caller can wait for the answer, poll the task, stream its updates or hand the server a webhook [@a2a-spec].

The purchase-order picture fails in two places. A purchase order is filed and forgotten, while an A2A task can stream updates and stop to ask for more input, which a purchase order never does. And a firm vets a supplier before it signs, whereas an Agent Card is unvetted self-description that your model reads as prose.

The MCP section above ended on `input_required`{checked=row-49}, a tool call that stops to ask for input, and MCP 2026-07-28 also moved long-running tasks into an extension that a client polls and can send input to [@mcp-changelog-2026-07-28]. Long, pausable tasks therefore no longer set A2A apart, so the line between the two protocols is who plans the work. In MCP, your model picks a named tool and fills in its input schema, and the plan stays with the caller. In A2A, the caller sends a goal, and the remote agent decides how to reach it; its card lists skills as prose with tags and examples, not as input schemas [@a2a-spec]. The rule that follows is ours and not the specification's: a capability whose inputs you know is a tool, and a capability whose plan someone else owns is an agent. Even so, the remote agent reaches your model looking like a tool: Google's ADK documentation says it "feels just like interacting with a local tool or function" [@adk-a2a-intro].

Delegation has to pay before any protocol matters. Anthropic's January 2026 guidance names three situations where several agents beat one (context pollution, parallel work and specialization) and says that outside them the coordination costs typically exceed the benefits, at "3-10x more tokens" [@claude-multi-agent-guidance]. The figure is Anthropic's own. So choose the cheapest option that works, from the first rung down. We drew the order up from these sources; none of them states it:

1. A function or a workflow step, when code can do the work.
2. A tool, over MCP when someone else hosts it, when you know the inputs.
3. An in-process subagent, when you own the agent and want a separate context or parallel branches.
4. An A2A call, when another team, company or framework owns the agent, and the task may run long or pause for input.
5. An A2A server, only when an outside caller needs to delegate to your agent.

An A2A server costs the most: it must publish and version a card, authenticate every request and scope every task to its caller before it touches storage [@a2a-spec].

As of November 2026, one of our eight SDKs ships A2A in its TypeScript package. Google's ADK serves an agent with `toA2a` and calls one with `RemoteA2AAgent`, on protocol 0.3, built on `@a2a-js/sdk` 0.3.14. The official `@a2a-js/sdk` 1.3.0 speaks 1.0, and its `legacyCompat`{checked=row-122} option lets a 1.x client call 0.3 agents [@a2a-js-sdk].

If your caller runs 1.x and the agent speaks 0.3, send the `A2A-Version`{checked=row-123} header, because it keeps the two apart. A server reads an empty value as 0.3, and a server with no 0.3 interface answers a 0.3 client with `VersionNotSupportedError`{checked=row-123}. Version 1.0 also renamed `message/send` to `SendMessage`{checked=row-124} and moved the card's `protocolVersion`{checked=row-124} into `supportedInterfaces`{checked=row-124}. Every listing below therefore shows protocol 0.3, because that is what ADK speaks, and none of it shows 1.0 behavior. The book adds a 1.0 listing once a harness we pin runs one.

[[lst:a2a-serve]] serves a "billing" agent, whose two tools look up an invoice and ask a human to approve a refund. Everything runs offline on the loopback address, with a mock model behind each agent.

:::listing[Serving the billing agent over A2A, behind a bearer token]{#a2a-serve file="verify/google-adk/examples/09-a2a-delegation.ts" region="serve"}
::note[Set `basePath` yourself: ADK's typings say the default is "a2a", but the code mounts at the root when it is empty.]{#base-path}
::note[`toA2a` refuses to mount without authentication, unless you pass `allowUnauthenticated: true`{checked=row-126}.]{#auth}
:::

The server publishes its card at `/.well-known/agent-card.json`, with JSON-RPC and HTTP+JSON interfaces and no gRPC, and the card says protocol 0.3.0.

[[lst:a2a-delegate]] is the caller. The `RemoteA2AAgent` goes into the parent's `subAgents` list as a local subagent would, the parent hands over by name with `transfer_to_agent`, and the remote agent's reply arrives as an event of the parent's run, authored by `billing`.

:::listing[A parent delegates to the remote agent as it would to a local subagent]{#a2a-delegate file="verify/google-adk/examples/09-a2a-delegation.ts" region="delegate" replay}
::note[`agentCard` is a base URL, not the card's URL: the SDK resolves `.well-known/agent-card.json` against it.]{#card}
::note[The remote agent sits in `subAgents` beside any local one.]{#same-as-local}
:::

The run found three details that the typings and the documentation do not say, and one that ADK documents but that still surprises. First, the card string resolves like a relative URL, so a server under the base path `/a2a` needs `http://host/a2a/` with its trailing slash, or the card request fails with a 404. Second, ADK's default client sends no bearer token, so a protected server needs a `clientFactory` that authenticates both the JSON-RPC and the HTTP+JSON transport, a factory that also drops ADK's trace-propagating fetch. Third, the transfer tool's argument is `agent_name`, not `agentName`{checked=row-131}. The documented surprise is that a refused request comes back as `HTTP 500`{checked=row-130} and not 401, and never reaches the agent.

When the billing agent calls a long-running tool, its A2A task ends in `input-required`, and the pending call reaches the parent's events marked long-running, so your loop can ask a person, as [[ch:approvals-guardrails-and-injection]] describes.

Distrust three things. First, the card's prose: your model reads a card's names and skill descriptions before it calls anyone. A study collected 310 deployed cards; on a separate set of 260 synthetic manipulated cards, nine LLM judges caught between 25.8% and 92.3% of the manipulations [@guirao-agent-cards]. A firm would never sign with a supplier it had not vetted, yet an Agent Card asks your model to do that on the card's word alone. Second, the card's name, which the protocol treats as descriptive metadata and not as an identity: in a controlled test of seven open-source projects, six client-style integrations sent a request meant for a trusted peer to an attacker-controlled peer that shared its name, an implementation flaw and not a protocol exploit [@kumar-name-collision]. Pin each peer by its card URL, and by a verified signature where one exists, and never by display name; no source states that advice. Third, every reply: Microsoft's documentation tells callers to "Treat responses from the remote agent as untrusted application input" [@ms-agent-framework-a2a]. Our harness's registry marks the output of a tool registered with `remoteAgent: true`{checked=row-137} as untrusted by default, as it does for MCP tools, and the value a registration declares wins [@buildanagent-harness-readme]. You will have to write the A2A client yourself for now: as of November 2026 the harness gives you only that flag. Call another agent over A2A when someone else owns its plan, and treat what comes back as you treat an MCP server's output.

## Skills cost a name and a description until the model opens one

A mechanic does not read every service manual before each job, because :analogy[service manuals open only when that model of car comes in]{#service-manuals}. The shelf lists each manual by make and year, and the mechanic pulls the one for the car on the lift. A skill is a folder with a `SKILL.md` file, and it works the same way: the file's name and description go into the prompt at startup, at about 100 tokens per skill, and its body, under 5,000 tokens by Anthropic's guidance, enters the context only when the model decides the task matches [@anthropic-agent-skills-overview; @claude-agent-sdk-skills]. Bundled reference files load when the model reads them, and a bundled script runs through a shell, so only its output enters the context.

A skill adds instructions, not an interface. Pi's documentation draws the line: use a skill when a workflow needs more context than a prompt template but no new executable integration point [@pi-skills]. A tool lets the model do something new. A skill tells it how your team does something it can already do, such as report the weather in one city's format. [[lst:skills-run-ours]] and [[lst:skills-run]] set up that case in our harness and in the Claude Agent SDK, each with two skills and one of them listed for the run.

:::::tabs
:::listing[Our harness]{#skills-run-ours file="packages/harness/examples/07-skills.ts" region="skills-run"}
::note[Our harness has no option that enables a skill: the list you pass is the list the prompt shows, so this run passes one of its two. Here `skillOf()` parses a file held in memory. On a real project, `discoverSkills()`{checked=row-173} returns the list from the trusted project's `.agents/skills` folders.]{#enabled}
::note[`withSkills()` adds a section to the system prompt that lists each skill's name, description and path, and never its body.]{#listing}
::note[Passing `skills` also lets each turn record a load. `env.cwd` is where a relative path in a `read` call starts when the turn matches the call to a skill.]{#record}
:::
::listing[Claude Agent SDK]{#skills-run file="verify/claude-agent-sdk/examples/09-skills.ts" region="skills-run"}
:::::

[[lst:skills-checks-ours]] and [[lst:skills-checks]] show what the model receives. In each, the first request lists the enabled skill's name and description and carries no body. In the Claude Agent SDK, the skill left out of the `skills` option never reaches the model, though it stays on disk, because the option is "a context filter, not a sandbox" [@claude-agent-sdk-skills]. Its mock model then calls the `Skill` tool, and from that request on, the body sits in every request of the run. Our scripted model instead reads the skill's file with the ordinary `read` tool.

:::::tabs
:::listing[Our harness]{#skills-checks-ours file="packages/harness/examples/07-skills.ts" region="skills-checks" replay}
::note[The first request holds the name and the description, in the system prompt.]{#listed}
::note[It does not hold the body.]{#body-withheld}
::note[The scripted model reads the skill's `SKILL.md` with the `read` tool, so the next request carries the body in the tool's result.]{#body-arrives}
::note[The skill left out of the list reaches neither request, though its file is in the workspace.]{#unlisted}
::note[The turn also wrote a `skill_loaded` entry, which names the skill and its path.]{#logged}
:::
:::listing[Claude Agent SDK]{#skills-checks file="verify/claude-agent-sdk/examples/09-skills.ts" region="skills-checks" replay}
::note[The first request holds the name and the description.]{#listed}
::note[It does not hold the body.]{#body-withheld}
::note[After the call, every request carries the body.]{#body-stays}
:::
:::::

The manual leaves the bay when the car does, and a skill's body does not. It stays in the context and costs its tokens in every later request of the run. The listing has a cost of its own: Anthropic's figure of about 100 tokens per skill comes to about 1,000 tokens for ten skills and about 20,000 for two hundred. Finding the right skill depends on the description, which Anthropic says must name what the skill does and when to use it [@anthropic-agent-skills-overview]. Even a good description can miss. Pi's documentation says "A model might fail to load a relevant skill", and gives a command, `/skill:name`, that forces one [@pi-skills]. No source measures how often a model misses, so treat loading as likely and not as guaranteed.

Our harness uses the same layout, built in todo N23 as of November 2026, and [[lst:skills-checks-ours]] runs it. It lists each skill's name, description and path in the system prompt. It loads the body through the ordinary `read`{checked=row-172} tool, which todo N21 built, and records a `skill_loaded`{checked=row-172} entry in the session log when a successful `read` opens a listed skill's whole `SKILL.md`. It discovers skills in `.agents/skills` from the working directory up to the repository root, as Pi does [@pi-skills], but lists a project's skills only when the host trusts the project. One part is still missing: nothing helps you write a skill. The layout is a file-based cousin of Voyager, an agent that played Minecraft with GPT-4 and kept each skill as executable code in a vector database, keyed by an embedding of the skill's description and retrieved five at a time [@wang-voyager]. Voyager added a skill only after the program had run and passed the environment's feedback. A skill folder you download has run nowhere.

That gap matters, because the permission pipeline checks one call at a time and a skill steers a sequence of calls. SkillCFI, a November 2026 paper, tested 53 public skill packages and accepted none as written [@ruan-skillcfi]. On the authors' abnormal tasks its runtime check blocked every violating request that used only the skill's own vocabulary, while a permission-style allowlist let all 80 of them take effect [@ruan-skillcfi]. ACaM's finding from the first section applies as well, because a description can omit what the code does [@santra-acam]. No current todo of ours checks a skill's steps or a tool's code at run time, so the pipeline and the sandbox remain the only limits on what a loaded skill can make the agent do. A skill you did not write deserves the review you would give a script you did not write.

## Signing in to a remote MCP server is a credential problem, so it belongs after the credential boundary

Everything above assumed the connection already worked. A remote server such as GitHub's must first learn who you are, and the specification answers with OAuth. Authorization is optional. An HTTP server that implements it acts as an OAuth resource server. A stdio server, such as a GitHub server you start on your own machine, is told not to follow the flow and to take its credentials from the environment [@mcp-authorization].

That GitHub token now sits in a process's environment, so the questions that follow are credential questions. Where does the token live, and which process may read it? How does a client register itself with the authorization server now that dynamic client registration is deprecated? What may a hostile server's metadata make your client fetch? Each depends on the boundary between the model and its credentials, which [[ch:permissions-sandboxes-and-credentials]] builds, so this chapter stops at the door. One rule carries over from the first section: an MCP server's tools and output stay untrusted, whatever token signed you in.

## Exercises

1. **Defer half the tools and measure the first request before and after.** Work in `verify/claude-agent-sdk/examples/08-deferred-tools.ts`.

   (a) Add three tools to `stationTools` so that the server holds six. Build three configurations from the same six: one server with `alwaysLoad`, one deferred server, and two servers, one eager with three tools and one deferred with the other three.

   (b) Run the same prompt against each configuration, and predict the order of the three first-request sizes before you run anything.

   (c) Compare `JSON.stringify(first.tools).length` for the first request of each run, add two `check`{checked=row-93} calls that assert your prediction and run `pnpm test` in `verify/claude-agent-sdk`. A wrong prediction makes the example fail, so read which check broke. Which size surprised you?

   (d) Lengthen each tool's description to a paragraph and find out whether the order changes. Then say what that tells you about the SDK's advice to load everything upfront below about ten tools.

   (e) Restore the folder with `git checkout -- examples results` when you are done.
2. **Sort forty tools into the registry's three exposures on paper.** An agent holds an orders lookup that nearly every run uses, eleven Slack tools that one run in twenty touches, a refund tool, a delete-account tool and twenty-six read-only reporting tools from a vendor's MCP server. Using [[fig:one-registry]], give each group one of `direct`{checked=row-13}, `deferred`{checked=row-13} or `hidden`{checked=row-13}, and say which group's output you mark untrusted and which calls you send through an approval. After a week of logs shows that the reporting tools are used on one run in ten, which group do you move, and in which direction? Which of your choices depends on the model finding the tool by its name and description alone?
3. **Plan the pause for an `input_required`{checked=row-49} result.** An MCP tool call returns `input_required`{checked=row-49} and asks for a GitHub username, and your agent runs in a process that can restart before the person answers. Write down what you store, who signs it, and what the second request carries back. Then go through the four things a safe SDK does in [[ch:approvals-guardrails-and-injection]] and mark which ones the MCP specification's rules for `requestState`{checked=row-51} already cover and which are still yours. What does your agent do when the person never answers?
