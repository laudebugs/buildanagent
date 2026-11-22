---
title: "Tools at scale: the registry, deferred tools, MCP and skills"
summary: An agent with dozens of tools stays usable when one registry names and gates every tool and most definitions stay out of the request until the model asks. This chapter shows tool selection and deferral in checked listings, what MCP's 2026-07-28 revision changes for a client, and how skills load on demand, and it marks which parts of our harness are built.
opening: fact
sources: [anthropic-advanced-tool-use, claude-agent-sdk-tool-search, pi-mcp-servers, pi-sdk-docs, buildanagent-harness-readme, santra-acam]
glossary: [tool, mcp, tool-registry]
switchTo: [N11, N21, N22, N23, N24, N25]
---

Five MCP servers, 58 tools and about 55,000 tokens: that is what Anthropic counted in November 2025 for a setup with GitHub, Slack, Sentry, Grafana and Splunk, before the conversation had started [@anthropic-advanced-tool-use]. The figure is Anthropic's own estimate, but the arithmetic holds for any agent. Every tool you register puts its name, description and schema into every request, and the Claude Agent SDK's documentation says selection accuracy "degrades with more than 30-50 tools loaded at once" [@claude-agent-sdk-tool-search].

This chapter answers one question: how does an agent with dozens of tools stay usable, and how do MCP servers and skills fit after MCP's 2026-07-28 revision? Four mechanisms carry the answer. One registry names and gates every tool. Deferral keeps most definitions out of the request until the model asks for them. MCP brings in tools you did not write, and skills bring in procedures instead of tools. Each section shows its mechanism in a listing that CI runs, and says where our own harness is built and where it is still a design.

## One registry should name, defer and gate every tool, whatever its source

Suppose your agent ships with six built-in tools and you connect a GitHub server and a Slack server. By evening it holds dozens of tools from three origins, and three questions each need one answer. What is each tool called, so that a rule or a log line can point at it? Does the model receive the tool's whole definition, or only a hint that it exists? And may this call run?

The SDKs answer these separately, each in its own corner. Naming is the first corner. Pi calls an MCP tool `mcp__github__create_issue`{checked=row-4}, replaces every character other than letters, digits and underscores, and adds a hash suffix to the tools of a server whose cleaned names collide [@pi-mcp-servers]. [[ch:tools]] showed the Claude Agent SDK's version of the same prefix. Selection is the second corner. Pi lets you choose the tools the model may use, and [[lst:pi-active-tools]] shows the three ways to do it [@pi-sdk-docs].

:::listing[Pi chooses the tools a session offers: an allowlist, an exclusion, or none]{#pi-active-tools file="verify/pi/examples/03-tool-selection.ts" region="active-tools"}
::note[An allowlist replaces the default set, so this session can only read.]{#allowlist}
::note[An exclusion starts from the defaults and removes two tools, which leaves `read` and `edit`.]{#exclude}
::note[`noTools: "builtin"` leaves the model with none of the built-in tools.]{#none}
:::

An unlisted tool is not on the menu, so the model never sees its definition. A model can still ask for a tool by name, though, and what happens next is part of the gate. [[lst:pi-inactive-call]] scripts that request, and the answer is an error result the model can read, not a crash.

:::listing[A call to a tool outside the active set comes back as an error, and the loop continues]{#pi-inactive-call file="verify/pi/examples/03-tool-selection.ts" region="inactive-call"}
::note[Only `read` is active, but the scripted model asks for `ls`.]{#only-read}
::note[The call yields an error tool result, which the model reads on its next request.]{#error-result}
::note[The loop sends a second request instead of ending the run.]{#continues}
:::

The third corner, whether a call may run, lives in other code again, as [[ch:approvals-guardrails-and-injection]] showed. Three answers in three places drift apart, and a rule that names a tool one way while a log records it another way protects nothing. A harness that owns the loop can ask for one place, which our harness calls the tool registry. The registry, `createToolRegistry`{checked=row-8}, exists today in the private `@buildanagent/harness` package, as of November 2026 [@buildanagent-harness-readme]. It takes tools from four origins (built-in, extension, client and MCP server) and settles the three questions at registration, once.

:::figure[One registry names every tool once, sets what each request carries and feeds the permission pipeline]{#one-registry}
::svg{alt="Three boxes on the left, built-in tools, MCP server tools and extension tools, each with an arrow into one tall box labelled one registry. Inside it are three boxes: names it once, with the example mcp__github__x; sets exposure to direct, deferred or hidden; and marks trust, with MCP output untrusted. Two arrows leave the registry. One goes to a box saying each request carries direct tools plus tool_search. The other goes to a box saying the permission pipeline decides every call."}
:::

The registry answers the questions in this order. It gives each tool a canonical name of 1 to 64 characters, namespaces an MCP tool as `mcp__<server>__<tool>`{checked=row-10}, and throws a `DuplicateToolError`{checked=row-10} when a second tool takes a name. An extension may replace a built-in only by registering with `override: true`{checked=row-11}, and an MCP tool may never replace anything [@buildanagent-harness-readme]. It sets an exposure for each source, `direct`{checked=row-13}, `deferred`{checked=row-13} or `hidden`{checked=row-13}, and defaults MCP tools to `deferred`{checked=row-13} and every other source to `direct`{checked=row-13}. It marks an MCP tool's output untrusted, because the server wrote it and you did not. Finally it hands each run its definitions in registration order, so the cached prefix of a request does not move when a tool activates.

The permission pipeline reads the same description. It decides every call in one order, hooks first, then deny rules, ask rules, the mode, allow rules, the host callback and a default for what no rule settled. A deny at any step ends the decision, and a hook or callback that throws counts as a deny. Each verdict, allows included, becomes a `permission_decision`{checked=row-17} entry in the session log [@buildanagent-harness-readme]. Because the registry named the tool and marked its trust before the call reached the pipeline, a rule written for `mcp__github__create_issue`{checked=row-10} matches the tool that actually runs and a log reader finds it under the same name.

Two limits keep this honest. First, the built-in tools, the extension loader and both MCP transports are not built yet (todos N21 to N25 are open as of November 2026), so today you register such tools by hand and the chapter's MCP and skill sections describe a design. Second, a registry records where a tool came from and how far to trust its output, but it never reads the tool's code. ACaM, a November 2026 paper, calls the resulting gap Description-Code Inconsistency: "nothing enforces that the description and its implementation agree" [@santra-acam]. The authors injected hidden exfiltration paths into 14 variants of 10 real agents and left each tool's description unchanged, so each injected path is a laundered capability by construction. On the 43 unmodified agents they found hundreds of structurally vulnerable paths. The registry makes every tool visible in one place, and nothing in it yet checks that a tool does what its description says.

## Exercises

1. **Placeholder.** Replaced when the chapter is finished.
