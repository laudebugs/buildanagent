---
title: "Three containments: permissions, sandboxes and credentials, and the lethal trifecta"
summary: A permission pipeline, a sandbox and a credential boundary each contain a different failure of an agent that runs code. This chapter shows how three SDKs order their permission checks, what a sandbox does and does not stop, where a secret should be added, and why cutting the outbound leg is the cheapest way to contain prompt injection.
opening: incident
sources: [claude-agent-sdk-permissions, pi-run-pi-safely, owasp-llm06-excessive-agency, owasp-llm01-prompt-injection, willison-lethal-trifecta]
glossary: [permission-pipeline, sandbox, lethal-trifecta]
switchTo: [N12, N13, N14, N15, N16, N17, N18, N19, N20]
---

In November 2026 our own test runner handed a documentation example the whole environment of the machine it ran on. The example was harmless and so was the machine, and the Claude CLI that the example started still offered tools we had never chosen and sent a request to the host's agent-proxy endpoint. A private config directory and an empty list of settings sources had not stopped either. Only an environment built from an allowlist did. An earlier example had gone further: inherited credentials sent it to a real provider, which is why the repository now bans `...process.env` for third-party code.

Nobody attacked us. A permission list, a config directory and good intentions did not contain the run, because each of them judges what the agent asks to do and none of them limits what the process around it can reach. That gap is the subject of this chapter. An agent that runs code needs three separate containments, one for each way it fails: a permission pipeline for a call that should not run, a sandbox for a command that runs and misbehaves, and a credential boundary for a secret that must not be in the room. The three together make prompt injection something you contain instead of something you hope to prevent, and the chapter ends on the cheapest cut: the leg through which stolen data leaves.

## A permission pipeline reads its rules top to bottom, and a deny anywhere ends the call

Picture :analogy[a club's door list]{#club-door-list}. The doorman reads it from the top: a banned name is turned away whatever invitation the guest holds, a guest on the list walks in, and a name the list does not settle goes to the manager at the door. A permission pipeline has the same shape. Every tool call the model asks for passes through the rules in a fixed order, and the first step that decides the call ends the check. It differs from a door list in one way that matters: the rules are code that runs in order, and the manager at the door is a callback in your program or a person it asks.

The Claude Agent SDK, pinned here at 0.3.327 as of November 2026, documents six steps: hooks, deny rules, ask rules, the permission mode, allow rules and the `canUseTool` callback [@claude-agent-sdk-permissions]. The order carries the rule that makes a pipeline worth having. A deny rule sits before the mode, so no mode can switch it off. [[lst:deny-wins]] sets `permissionMode: "bypassPermissions"`, the mode that approves everything it reaches, and a call to the one tool the example denies still never runs.

::::tabs
:::listing[Claude Agent SDK]{#deny-wins file="verify/claude-agent-sdk/examples/03-permission-order.ts" region="deny-wins"}
::note[A deny rule for the tool, passed as `disallowedTools`.]{#deny}
::note[The mode that approves every call it reaches. It is last in the order, after the deny rules.]{#bypass}
::note[The handler, which stands for the tool's real work, never ran.]{#blocked}
::note[The `canUseTool` callback was never asked either: the deny at step 2 ended the check before step 6.]{#not-asked}
:::
:::listing[Copilot SDK]{#reject-handler file="verify/copilot-sdk/examples/03-permission-deny.ts" region="reject-handler"}
::note[Copilot has no rule list in this example. Every call goes to one callback, `onPermissionRequest`.]{#callback}
::note[`reject` stops the call and carries a feedback string for the model.]{#reject}
:::
:::listing[Pi]{#gate file="verify/pi/examples/07-extension-gate.ts" region="gate"}
::note[Pi has no permission system. An extension subscribes to the `tool_call` event, which fires before each call.]{#event}
::note[Returning `{ block: true }` stops the call and gives the model the reason.]{#block}
::note[Returning nothing lets the call through.]{#pass}
:::
::::

The three tabs are three designs. Claude evaluates declared rules first and asks a callback last. Copilot asks one callback about everything, so the rule is whatever your function returns. Pi ships no rules at all: its safety documentation says it "does not ask for approval before every tool call" and can read, change and execute files with the permissions of the account that started it [@pi-run-pi-safely], so a gate is an extension you write. A gate you write can be as strict as a rule list, but you must write it, and nothing in the SDK notices when you forget.

An allow can arrive from places that must not be trusted to override a deny. [[lst:hook-allow]] adds a hook that approves the same call the deny rule blocks. The call still does not run, because the SDK evaluates deny rules whatever a hook returned [@claude-agent-sdk-permissions].

:::listing[A hook's allow does not undo a deny rule]{#hook-allow file="verify/claude-agent-sdk/examples/03-permission-order.ts" region="hook-allow"}
::note[The same deny rule as before.]{#rule}
::note[The hook says allow.]{#allow}
::note[The handler still never ran: the deny rule is evaluated regardless of what the hook returned.]{#still-denied}
:::

A refusal is only useful if you can see it later. When no rule allows a call and no callback exists to ask, the Claude SDK refuses the call and records it, and [[lst:refusal]] shows what the run keeps.

:::listing[A refused call is an error result for the model and a record for you]{#refusal file="verify/claude-agent-sdk/examples/10-refusals-are-recorded.ts" region="refusal" replay}
::note[The prompt asks for a tool that sends mail.]{#prompt}
::note[No `allowedTools` entry and no `canUseTool` callback: nothing allows the call and nobody can be asked.]{#no-rule}
:::

The checks after the run say what the refusal left behind. The run still ends in a `success` result, because a refusal is not an error. The result's `permission_denials` list holds the call with its tool name and input, and the model's next request carries the refusal as an error result, so the model can explain or try something else. That list is the authoritative record of what the pipeline stopped. Do not rebuild it from the model's text.

Our own harness uses the same order and adds a few rules of its own, which its README documents: hooks, deny rules, ask rules, the mode, allow rules, a host callback and a default for a call nobody settled. A hook there cannot return an allow at all, so a classifier hook can only restrict. An allow rule that would make the callback unreachable fails at startup instead of silently, and every decision is written to the session log with the rule that made it. The pipeline reads a shell command the way a shell would and refuses to allow one it cannot read, so `git status && rm -rf /` is not covered by a rule for `git status`. It does not decode escapes or follow aliases or variables, and its README says to run untrusted commands in a sandbox as well.

That caveat leads to the next section. A pipeline judges a call by what it says it will do. It cannot see what the command does once it runs, and that is the sandbox's job.

## A sandbox limits what a command can reach, and each backend names the failures it does not stop

A chemist who handles something hazardous works through :analogy[a lab glovebox]{#lab-glovebox}. The hands go in through the gloves, the work stays behind the glass, and whatever goes wrong inside the box stays inside it. A sandbox does that for a command. The agent's shell call still runs, but it runs in a space whose files, processes and network the host has chosen in advance, so a wrong command can break only what the box holds. Our sandbox filters in both directions. A glovebox keeps things in, and a sandbox also decides which network hosts a command may reach, as [[fig:glovebox]] shows.

:::figure[A lab glovebox: the work happens behind the glass, and only chosen things pass through the port]{#glovebox analogy="lab-glovebox"}
::svg{alt="Two panels joined by the word like. On the left, a lab glovebox: a sealed box with two gloves reaching in, a sample inside, and a small port on the side with one labelled item passing through. On the right, a sandbox: a box labelled sandbox holding a command, a workspace folder it may write and a read-only folder, with a single narrow door labelled allowed hosts on its side and everything else outside the box marked out of reach."}
:::

The glovebox has a limit that matters more than the comparison. Its glass stops a spill and a splash, and it was never built to stop someone smashing it. A sandbox is the same, and each of our backends says which of three failures it stops. `mistakes` are the agent's own errors, such as a write outside the workspace. `exfiltration` is sending data to a host the policy does not allow. A `hostile_process` is a program that is trying to break out. No backend claims to stop that last one, because a sandbox that shares the host's kernel cannot promise it.

:::table[Our three sandbox tiers and the failures each claims to stop]{#sandbox-tiers}
| Tier | Backend | Stops | What it is |
| --- | --- | --- | --- |
| `none` | `noneSandbox({ unsafe: true })` | Nothing | A command runs as the user with the machine's files and network, for a machine that is already disposable |
| `os` | `srtSandbox()` | Mistakes and exfiltration | An operating-system sandbox on Linux that shares the host's kernel; it wraps Anthropic's `srt` runtime, a beta research preview as of November 2026 |
| `container` | `dockerSandbox()` | Mistakes and exfiltration, as far as its setup allows | A container with every capability dropped, a read-only root file system and no network, on Linux only |
:::

The first sandbox costs nothing, because it is a shorter list of tools. A model cannot ask for a shell that is not offered. [[lst:offered]] strips Copilot's default coding tools down to the one custom tool.

:::listing[Narrow the toolset first: what the model is offered]{#offered file="verify/copilot-sdk/examples/04-restrict-builtins.ts" region="offered"}
::note[`availableTools` with only custom tools offers `ping` and nothing else.]{#custom-only}
::note[`excludedTools` removes the shell and the file editors and leaves the rest.]{#excluded}
::note[When both lists name a tool, the exclusion wins.]{#exclude-wins}
:::

A shorter list prevents a call, though, and a sandbox contains one that already ran. Both are needed, because a tool you keep, such as a test runner, can still run any code in the repository. The sandbox then decides what that code reaches. Pi's safety page ranks the choices: running the whole agent inside a container, virtual machine or sandbox is "usually the strongest practical option", and running Pi outside with only its built-in tools inside is "a narrower form of isolation" [@pi-run-pi-safely]. It also says that credentials and network services stay reachable inside the sandbox when you make them available, which is where the next section starts.

The network is the part of a sandbox that people forget to test. Our test runner proves its own network is closed before it runs an example, and [[lst:network-check]] is that check. It is a harness self-check, not a feature of Copilot or any other SDK.

:::listing[Our harness checks that the example cannot reach the internet]{#network-check file="verify/copilot-sdk/examples/00-sandbox.ts" region="network-check"}
::note[A raw TCP connection to a public address fails with `ENETUNREACH`: the namespace has no route out.]{#raw}
::note[Name lookups fail too, so a name cannot be turned into an address.]{#dns}
::note[Loopback still works, which is how the example reaches its mock model.]{#loopback}
:::

The container backend goes further than the others on the network. Each command runs with `--network none`, and a command reaches a host only through a Unix socket that the host mounts and a credential proxy listens on. Without that socket, no host is reachable, including the hosts the policy allows. Only the policy's folders are mounted, so a path outside them does not exist inside the container. The README names what the backend does not do: it shares the host's kernel, a protected file that is missing when the container starts is not protected, and only a rootful daemon on Linux was tested. A limit stated that plainly is the reason to read a backend's claim before relying on it.

[[fig:permission-pipeline]] puts the pipeline and the sandbox on one page: the call passes the pipeline's steps, a command that survives runs in the sandbox, and the one narrow door out of the sandbox leads to the proxy, which the next section describes.
