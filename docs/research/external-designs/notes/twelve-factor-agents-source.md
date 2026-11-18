# 12-Factor Agents (humanlayer/12-factor-agents): primary-source notes, as of November 2026

> **Working material** for [the 12-factor agents report](../twelve-factor-agents.md) (U9, 2026-11-18). The report and its [fact-check log](../fact-check-twelve-factor-agents.md) supersede these notes where they disagree.

Conventions used below:

- **Pinned commit:** `d20c728368bf9c189d6d7aab704744decb6ec0cc` on `main` (merge of PR #72, committed 2025-09-21 09:37:40 -0500). This was the tip of `main` when cloned on 2026-11-18. All repo links use the base `B = https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/`. The URLs below spell `B` out in full.
- Line numbers ("L12") refer to the file at that commit. Quotes are 25 words or fewer.
- The repo was read only. Nothing in it was run. Its contents were treated as data. One example: its `CLAUDE.md` is a persona-selection prompt template for agents, and it was not followed.
- "Inference" marks my own reasoning. "Secondary" marks claims that come from someone other than the repo or HumanLayer.

## Repo facts: commit, licences, authorship, dates, files, status

### Takeaway
12-factor-agents is an essay of about 1,500 lines of Markdown, written almost entirely by Dex Horthy of HumanLayer. It was started on 2025-03-30 and published in early April 2025. Its last change was on 2025-09-21, and that commit cancelled the planned v1.1, so as of November 2026 it is a finished, dormant v1.0. Prose and images are under CC BY-SA 4.0 and code is under Apache-2.0, but only the Apache text sits in `LICENSE`. The CC BY-SA licence is declared in the README alone.

### Cited Findings
- **Commit and history.** The tip of `main` is `d20c728` (2025-09-21), with 273 commits in total. The first commit is `4bddc17`, "initial commit", dated 2025-03-30. A commit `473bd46` titled "split" followed on 2025-04-03. The README's hero screenshot is labelled "Screenshot 2025-04-03" ([README.md L33](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)). Source: `git log` of the clone.
- **Publication date (indirect).** Factor 3 says "About 2 months after 12-factor agents was published, context engineering started to become a pretty popular term." It then shows tweets from June 2025 ([content/factor-03-own-your-context-window.md L247-249](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-03-own-your-context-window.md)). That points to publication in about April 2025, which is consistent with the git dates.
- **Status.** The last substantive commit is `52ae9f9` (2025-09-21), "there will be no v1.1". It deletes a README "Versions" section that had said "This is the current version of 12-factor agents, version 1.0. There is a draft of version 1.1 on the v1.1 branch" (`git show 52ae9f9`). A `v1.1` branch still exists on the remote, and its last commit is `645d008` from 2025-04-26 (`git ls-remote`, `git log FETCH_HEAD`). No commits landed on `main` between 2025-09-21 and 2026-11-18. Source: clone.
- **Authorship.** Of the 273 commits, 248 are by Dex Horthy under two git identities ("dexhorthy" with 144 and "Dex" with 104). The rest come from about ten contributors with one to six commits each, such as Sypherd, kyu08 and Andrew Churchill (`git log --format=%an | sort | uniq -c`). The README is written in the first person: "Hi, I'm Dex. I've been hacking on AI agents for a while." Its links point to humanlayer.dev ([README.md L36](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)). It thanks @iantbutler01, @tnm, @hellovai, @stantonk and others "for early feedback" ([README.md L53](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)).
- **Licences.** The README badges read "Code-Apache 2.0" and "Content-CC BY-SA 4.0". The licence section states "All content and images are licensed under a CC BY-SA 4.0 License" and "Code is licensed under the Apache 2.0 License" ([README.md, License section, near the end](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)). [`LICENSE`](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/LICENSE) holds only the Apache-2.0 text. Commit `0a32435` ("license stuff", 2025-05-25) replaced a CC BY-SA 4.0 summary in `LICENSE` with the Apache text and updated the README (`git show 0a32435`). The repo has no NOTICE file and no CC BY-SA licence file.
- **Main files.**
  - `README.md` holds the overview, the short "How we got here" summary, the factor list, the related resources and the licence section.
  - `content/brief-history-of-software.md` is the long motivation essay.
  - `content/factor-01-…md` through `factor-12-…md` hold the factors, and `content/appendix-13-pre-fetch.md` holds "Factor 13".
  - `content/factor-1-…md` through `factor-9-…md` are one-line stubs reading "[Moved to factor-01-natural-language-to-tool-calls.md]" and so on. They date from the renumbering commit `9760a21` (2025-04-29), "added 00. number notation to factors files". Source: clone.
  - `img/` holds diagrams and GIFs/MP4s numbered 010–220.
- **Code folders.**
  - `packages/create-12-factor-agent/template/` is a TypeScript and BAML starter agent with `src/agent.ts`, `state.ts`, `server.ts`, `a2h.ts` and `cli.ts`, plus `baml_src/agent.baml`, `clients.baml` and `tool_calculator.baml`.
  - `packages/walkthroughgen/` is a TypeScript tool that generates step-by-step walkthrough Markdown and folders from YAML ([packages/walkthroughgen/readme.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/walkthroughgen/readme.md)).
  - `workshops/2025-05/` is a TypeScript workshop titled "Building the 12-factor agent template from scratch". It has chapters 0–11 plus "Chapter XX - HumanLayer Webhook Integration" ([workshops/2025-05/walkthrough.yaml](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/workshops/2025-05/walkthrough.yaml)).
  - `workshops/2025-07-16/` is a Python port of the same walkthrough, generated as a Colab `.ipynb` ([workshops/2025-07-16/walkthrough.yaml](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/workshops/2025-07-16/walkthrough.yaml)).
  - `drafts/a2h-spec.md` is an "Agent-to-Human Protocol" draft of 367 lines. Next to it, `drafts/ah2-openapi.json` is empty (0 bytes).
  - `hack/contributors_markdown/` is a Python script that builds the contributor avatar grid.
- **Workshop chapter titles (TS).** The chapters are: Hello World; CLI and Agent Loop; Add Calculator Tools; Process Tool Calls in a Loop; Add Tests to agent.baml; Multiple Human Tools; Customize Your Prompt with Reasoning; Customize Your Context Window; Adding API Endpoints; In-Memory State and Async Clarification; Adding Human Approval; Human Approvals over email ([workshops/2025-05/walkthrough.yaml L29-632](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/workshops/2025-05/walkthrough.yaml)).
- **`create-12-factor-agent` is not published.** The README invites people to "contribute to `npx/uvx create-12-factor-agent`" through discussion #61 ([README.md L28](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)). The npm registry returns "Not found" for `create-12-factor-agent` ([registry.npmjs.org/create-12-factor-agent](https://registry.npmjs.org/create-12-factor-agent), fetched 2026-11-18).
- **Telemetry.** The README embeds a Scarf tracking pixel (`static.scarf.sh/a.png?x-pxid=…`) ([README.md L31](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)).

### Inferences
- When we quote or adapt text and images, CC BY-SA 4.0 share-alike applies, based on the README statement. When we copy code snippets, Apache-2.0 applies. Because the CC licence appears only in the README, a downstream mirror should record both licences explicitly.
- The guide is a frozen v1.0. Its examples reflect early-2025 practice, such as an OpenAI-style messages format and `gpt-4o` in the template.
- The renumbered `factor-NN` files are canonical. Cite those, not the `factor-N` stubs.

### Gaps
- GitHub star and fork counts: the github.com HTML page returned HTTP 403 through the proxy, and the REST API is blocked. The counts are not reported here.
- The contents of discussion #61 and of issues: these need the API or the HTML pages, and both were blocked.
- What the abandoned `v1.1` branch changed: only the diff size was checked (24 files, +876/−924 against `main`). On that branch the README factor titles match v1.0.

## Each factor in order: claim, reasoning, code pattern, evidence

### Takeaway
The README orders and titles twelve factors, then adds a "Factor 13" under "Honorable Mentions". Almost all of them are variations on one idea: own the loop, the prompt, the context serialization and the state yourself, so you can pause, approve, compact and recompose. Factor 6 and Factor 11 have no code. Factor 12 has no prose at all, only two images. The evidence throughout is the author's experience and anecdote (deploybot, conversations with founders), plus quotes from other practitioners. The guide offers no measurements or benchmarks.

### Cited Findings

**Order and titles.** The README lists the factors as follows ([README.md "The Short Version: The 12 Factors"](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)):
1. Natural Language to Tool Calls
2. Own your prompts
3. Own your context window
4. Tools are just structured outputs
5. Unify execution state and business state
6. Launch/Pause/Resume with simple APIs
7. Contact humans with tool calls
8. Own your control flow
9. Compact Errors into Context Window
10. Small, Focused Agents
11. Trigger from anywhere, meet users where they are
12. Make your agent a stateless reducer

"Factor 13: Pre-fetch all the context you might need" sits under "Honorable Mentions / other advice" and is stored as an appendix.

**Factor 1: Natural Language to Tool Calls** ([content/factor-01-natural-language-to-tool-calls.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-01-natural-language-to-tool-calls.md))
- **Claim:** converting natural language into a structured tool call is "One of the most common patterns in agent building" (L5).
- **Example:** "create a payment link for $750 to Terri…" becomes a JSON `create_payment_link` object with Stripe-like IDs (L11-29).
- **Code:** Python-ish pseudocode in which `nextStep = await llm.determineNextStep("…")` is followed by an `if nextStep.function == 'create_payment_link': stripe.paymentlinks.create(...)` / `elif` / `else` dispatch (L35-54).
- **Design choice:** it deliberately skips feeding the result back into a loop (L56-60). The point is that one atomic NL→JSON step is useful on its own.
- **Evidence:** a pointer to the author's own "mailcrew" agent and its demo video (L31). The prose says "Terri" while the memo says "Hey Jeff" (L11, L25), a minor inconsistency.

**Factor 2: Own your prompts** ([content/factor-02-own-your-prompts.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-02-own-your-prompts.md))
- **Claim:** "Don't outsource your prompt engineering to a framework." (L5)
- **Contrast:** it sets a "black box" `Agent(role=…, goal=…, personality=…, tools=[…])` / `Task(...)` / `agent.run(task)` API (L15-29), which is CrewAI-style by inference, against a BAML function `function DetermineNextStep(thread: string) -> DoneForNow | ListGitTags | DeployBackend | DeployFrontend | RequestMoreInformation` with an inline Jinja-like prompt (L35-66).
- **Tooling:** BAML is named, with the hedge "you can do this with any prompt engineering tool you want, or even just template it manually" (L69).
- **Listed benefits:** full control, tests and evals, iteration, transparency, and "role hacking", including "model gaslighting" techniques (L79-83).
- **Evidence:** a link to Hamel Husain's post "this is far from novel advice" (L9) and a screenshot. There is no data.

**Factor 3: Own your context window** ([content/factor-03-own-your-context-window.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-03-own-your-context-window.md), the longest factor at 260 lines, edited repeatedly June–July 2025)
- **Claim:** "You don't necessarily need to use standard message-based formats for conveying context to an LLM." (L5) The pull quote: the input is always "here's what's happened so far, what's the next step" (L7). "Everything is context engineering." (L12)
- **What context is:** the prompt and instructions, retrieved documents (RAG), past state, tool calls and results, memory from other threads, and output-format instructions (L16-20).
- **Out of scope:** sampling parameters, training and fine-tuning (L27-31).
- **Pattern:** the standard role/tool_calls message array (L39-67) is compared with packing the whole history into one user message as XML-ish tagged events (`<slack_message>`, `<list_git_tags>`, `<list_git_tags_result>`, `<error>`, `<human_response>`) with YAML bodies (L73-112, L146-210).
- **Code:** a `Thread { events: List[Event] }` holds `Event { type: Literal[...], data: ... }`. `event_to_prompt` renders `<{type}>\n{yaml}\n</{type}>`, and `thread_to_prompt` joins the events (L120-140).
- **Benefits:** information density; error handling, including "Consider hiding errors and failed calls from context window once they are resolved"; safety (filtering sensitive data); flexibility; token efficiency (L229-233).
- **Evidence:** a screenshot showing the same message in fewer tokens (L240-242). Tweets from Karpathy and Tobi Lütke and a "Context Engineering Cheat Sheet" by @lenadroid are offered as validation that the term took off (L245-253). There is no quantitative evaluation of the custom format against the standard one.

**Factor 4: Tools are just structured outputs** ([content/factor-04-tools-are-structured-outputs.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-04-tools-are-structured-outputs.md))
- **Claim:** tools are "just structured output from your LLM that triggers deterministic code" (L5).
- **Code:** `class CreateIssue { intent: "create_issue"; issue: Issue }` and `class SearchIssues { intent: "search_issues"; query; what_youre_looking_for }` (L11-27). The tool is a discriminated union keyed on `intent`.
- **Key point:** "The LLM decides what to do, but your code controls how it's done." A tool call need not map one-to-one onto a function (L34). The "next step" need not be atomic (L50).
- **Out of scope:** the tradeoff between plain prompting, tool calling and JSON mode. It defers to BoundaryML's "Schema Aligned Parsing" post, Vellum and LlamaIndex (L48).
- **Evidence:** none beyond reasoning. The numbered list in L29-32 skips "2".

**Factor 5: Unify execution state and business state** ([content/factor-05-unify-execution-state.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-05-unify-execution-state.md))
- **Definitions:** execution state is "current step, next step, waiting status, retry counts". Business state is "What's happened in the agent workflow so far" (L11-12).
- **Claim:** "If possible, SIMPLIFY - unify these as much as possible." (L14) "you can engineer your application so that you can infer all execution state from the context window" (L26).
- **Exceptions:** keep things like session IDs and "password contexts" out of the context window, and minimise them (L28).
- **Benefits:** a single source of truth, trivial serialization, debugging, adding state as new event types, resuming by loading the thread, forking by copying a subset of the thread, and rendering the thread for humans (L32-38).
- **Hedge:** separation "may be worthwhile, but may be overkill for your use case" (L5).
- **Code:** none beyond an animation.

**Factor 6: Launch/Pause/Resume with simple APIs** ([content/factor-06-launch-pause-resume.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-06-launch-pause-resume.md), 28 lines, no code)
- **Claim:** "Agents are just programs" that should be easy to launch, query, resume and stop (L5).
- **Launch:** users, apps, pipelines and other agents should be able to launch an agent with a simple API (L17).
- **Pause:** agents and their orchestrating code should be able to pause for long-running operations (L19).
- **Resume:** webhooks should resume an agent "without deep integration with the agent orchestrator" (L21).
- **Key note:** "often AI orchestrators will allow for pause and resume, but not between the moment of tool selection and tool execution" (L27).

**Factor 7: Contact humans with tool calls** ([content/factor-07-contact-humans-with-tools.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-07-contact-humans-with-tools.md))
- **Claim:** LLM APIs force a "HIGH-STAKES token choice" between plaintext and structured output on the first token (L5-15). It might be better to "*always* output json" and express human contact as intents like `request_human_input` or `done_for_now` (L17). It is hedged: "you might not get any performance boost from this, but you should experiment" (L19).
- **Code (agent side):** `class RequestHumanInput { intent: "request_human_input"; question; context; options: Options{urgency: low|medium|high, format: free_text|yes_no|multiple_choice, choices} }` (L23-33). In the loop, append a `human_input_requested` event, `thread_id = await save_state(thread)`, `await notify_human(nextStep, thread_id)`, then `return` to break the loop (L36-45).
- **Code (resume side):** a `@app.post('/webhook')` handler loads the thread by `threadId`, appends a `response_from_human` event, and calls `determine_next_step(thread_to_prompt(thread))` again (L52-67). It also shows an XML-ish context with `<request_human_input>` and `<human_response approved: true …>` before `<deploy_backend>` (L73-112).
- **Benefits:** clear instructions; inner versus outer loop, where agents start from a cron or event and the flow is `Agent->Human`; multiple humans; `Agent->Agent` requests; and durability when combined with factor 6 (L117-121). It links the author's "Outer Loop Agents" Substack (L123).

**Factor 8: Own your control flow** ([content/factor-08-own-your-control-flow.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-08-own-your-control-flow.md))
- **Claim:** build control structures for your use case, because certain tool calls should break the loop and wait for a human or a long-running job (L10).
- **Custom hooks it lists:** summarization or caching of tool results; LLM-as-judge on structured output; context compaction and memory management; logging, tracing and metrics; client-side rate limiting; and durable sleep, pause or "wait for event" (L12-17).
- **Code:** `handle_next_step(thread)` runs a `while True` loop over `determine_next_step(thread_to_prompt(thread))` with three kinds of branch (L27-69):
  - **Clarification:** append the event, `send_message_to_human`, `db.save_thread`, then `break`, because "we'll get a webhook later".
  - **Fetch open issues:** append the event, call `linear_client.issues()`, append the result, then `continue`.
  - **Create issue:** append the event, `request_human_approval`, `db.save_thread`, then `break`.
- **Mismatch:** the prose names the three branches `request_clarification`, `fetch_git_tags` and `deploy_backend` (L23-25), but the code uses `fetch_open_issues` and `create_issue`.
- **Main argument:** "the number one feature request I have for every AI framework" is the ability to interrupt "between the moment of tool **selection** and the moment of tool **invocation**" (L73-74). Without it you are forced to (1) pause in memory with `while…sleep` and restart from scratch on a crash, (2) restrict the agent to low-stakes calls, or (3) "yolo hope it doesn't screw up" (L76-81).
- **Evidence:** the author's experience with framework feature requests.

**Factor 9: Compact Errors into Context Window** ([content/factor-09-compact-errors.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-09-compact-errors.md))
- **Claim:** agents self-heal, because "Good LLMs have a fairly good chance of reading an error message or stack trace" and fixing the next call (L5). "Most frameworks implement this, but you can do JUST THIS without doing any of the other 11 factors." (L8)
- **Code:** a `try: handle_next_step(...) except Exception as e: thread["events"].append({"type": 'error', "data": format_error(e)})` (L11-29). A second version adds `consecutive_errors`, which resets on success and breaks out at 3 (L33-61). That snippet mixes Python with JS braces.
- **Escalation:** after the threshold, "escalate to a human, whether by model decision or via deterministic takeover of the control flow" (L62).
- **Warning:** doing this "TOO much" makes the agent spin out. The fix is to restructure how the error is represented or remove earlier events using factors 3 and 8 (L79-81). "the number one way to prevent error spin-outs is to embrace factor 10" (L83).
- **Gap:** the title says "compact", but the text never defines a compaction algorithm beyond `format_error` and removing resolved events.

**Factor 10: Small, Focused Agents** ([content/factor-10-small-focused-agents.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-10-small-focused-agents.md))
- **Claim:** "build small, focused agents that do one thing well. Agents are just one building block in a larger, mostly deterministic system." (L5)
- **Reasoning:** bigger tasks take more steps, which means longer context, and "As context grows, LLMs are more likely to get lost". Keep agents to "3-10, maybe 20 steps max" (L9-11).
- **"What if LLMs get smarter?":** "tl;dr yes", the principle still holds. As models improve, grow agent scope slowly to cover more of the larger DAG (L21-25).
- **Evidence:** a quote from the NotebookLM team, via swyx, that "the most magical moments… [come] just close to the edge of the model capability" (L35-37). There is no empirical step-count data.

**Factor 11: Trigger from anywhere, meet users where they are** ([content/factor-11-trigger-from-anywhere.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-11-trigger-from-anywhere.md), 17 lines, no code)
- **Opening:** "If you're waiting for the humanlayer pitch, you made it." (L5)
- **Claim:** let users trigger agents from Slack, email, SMS or any other channel, and let agents reply on the same channels (L9).
- **Benefits:** digital-coworker feel; outer-loop agents triggered by "events, crons, outages" that "may work for 5, 20, 90 minutes" and then contact a human; and high-stakes tools, because fast human loop-in enables "sending external emails, updating production data" with auditability (L13-15).

**Factor 12: Make your agent a stateless reducer** ([content/factor-12-stateless-reducer.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-12-stateless-reducer.md), 12 lines)
- **Text:** the only prose is "Okay so we're over 1000 lines of markdown at this point. This one is mostly just for fun." (L5) Everything else is two images.
- **Diagram:** [img/1c0-stateless-reducer.png](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/img/1c0-stateless-reducer.png) shows Context → "Determine Next Step" → fan-out to "Handle Next Step" branches → "whatever you want" → "New Context", looping back.
- **Tweet screenshot:** [img/1c5-agent-foldl.png](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/img/1c5-agent-foldl.png) shows a @dexhorthy tweet: "an AI Agent is a foldL where the accumulator is a context window, and the reducer is an LLM DetermineNextStep + a switch statement". It quotes his earlier "a for loop is not a framework". (Read from the image.)
- **Missing:** no code, and no discussion of side effects or idempotency. The reducer framing is implied, not argued.

**Factor 13 (appendix): Pre-fetch all the context you might need** ([content/appendix-13-pre-fetch.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/appendix-13-pre-fetch.md))
- **Claim:** "If there's a high chance that your model will call tool X, don't waste token round trips telling the model to fetch it" (L3).
- **Walkthrough:** three diffs remove the `list_git_tags` intent. First the tags are injected as a template variable `{{ git_tags }}`. Then a synthetic `list_git_tags` request and `list_git_tags_result` pair is appended to the thread before the first model call (L5-143).
- **Pull quote:** "If you already know what tools you'll want the model to call, just call them DETERMINISTICALLY and let the model do the hard part" (L147).
- **Framing:** it ties back to "AI engineering is all about Context Engineering" (L149).

**Template code that embodies the factors** ([packages/create-12-factor-agent/template/](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/create-12-factor-agent/template/))
- **Thread** ([`src/agent.ts`](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/create-12-factor-agent/template/src/agent.ts)): `class Thread { events: Event[] }` has `serializeForLLM()`, which renders each event as `<intent>` with `key: value` lines (factor 3). It also has `awaitingHumanResponse()`, `awaitingHumanApproval()` and `lastEvent()`, which compute execution state from the event list (factor 5).
- **Agent loop:** `agentLoop(thread)` calls `b.DetermineNextStep(thread.serializeForLLM())` and pushes a `tool_call` event. It returns the thread, which breaks the loop, on `done_for_now`, `request_more_information`, `request_approval_from_manager`, or `divide` (commented "divide is scary, return it for human approval"). Otherwise it runs `handleNextStep` (factors 7 and 8).
- **Thread store** ([`src/state.ts`](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/create-12-factor-agent/template/src/state.ts)): a `ThreadStore` interface (`create`/`get`/`update`) with a `FileSystemThreadStore` that writes `.threads/<uuid>.json` and an LLM-rendered `.txt` (factors 5 and 6).
- **Prompt and tools** ([`baml_src/agent.baml`](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/create-12-factor-agent/template/baml_src/agent.baml)): the tools are BAML classes keyed on an `intent` literal, such as `ClarificationRequest`, `DoneForNow`, `RequestApprovalFromManager` and `ProcessRefund`. `DetermineNextStep(thread: string) -> HumanTools | CalculatorTools | CustomerSupportTools` uses `client "openai/gpt-4o"` (factors 2 and 4).
- **Prompt tests:** BAML `test` blocks assert the expected intent for a serialized thread, for example `@@assert(intent, {{this.intent == "multiply"}})`. This is the "Testing and Evals" benefit of factor 2 made concrete.
- **Server** ([`src/server.ts`](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/create-12-factor-agent/template/src/server.ts)): `POST /api/v1/conversations` serves as an "outerLoop" webhook. It handles `conversation.created`, `human_contact.completed` and `function_call.completed` events from HumanLayer. On approval it runs the stored tool call, and on denial it appends `user denied operation … with feedback: …`. It then re-enters the inner loop (L58-120). This covers factors 6, 7 and 11.

### Inferences
- Factors 3, 5, 8 and 12 together amount to one design: an append-only, typed event list is the whole state. A custom serializer turns it into the prompt. A hand-written switch decides whether each intent runs synchronously (`continue`) or breaks to persist and wait (`break`). This lines up with items 2 and 3 of our planned architecture (a stateless loop with hooks, and an append-only event log). Factor 8's "pause between tool selection and invocation" maps onto approval hooks in our SDKs, such as `needsApproval` and `canUseTool`.
- The "factors" are uneven. Factors 1, 4 and 12 are framings rather than practices. Factors 6 and 11 are product requirements with no code. Factors 3, 7, 8 and 9 carry the most concrete guidance.
- The snippets are illustrative pseudocode, not runnable code. Python and JS syntax are mixed, and the factor 8 prose and code use different tool names. A later report should not mark them as verified.

### Gaps
- Factor 12 makes no prose argument, so any "stateless reducer" interpretation beyond the two images is ours.
- The guide never defines "compaction" (factor 9) operationally and gives no thresholds beyond "~3 attempts" and "3-10, maybe 20 steps".
- I did not view the many GIFs, MP4s and screenshots of tweets. Only the two factor 12 images were inspected.

## Overall thesis and the "brief history of software" motivation

### Takeaway
The thesis is that good production "agents" are mostly deterministic software with LLM steps placed at the right points. The naive "prompt plus bag of tools, loop until done" pattern breaks down as context grows. So the guide proposes that teams adopt small, modular agent concepts inside their existing product, rather than bet on a framework. The evidence is the author's conversations with founders and his own deploybot. No systematic data is offered.

### Cited Findings
- **Main claim:** "most of the products out there billing themselves as 'AI Agents' are not all that agentic… mostly deterministic code, with LLM steps sprinkled in" ([README.md L43](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)). Good agents do not follow the "here's your prompt, here's a bag of tools, loop until you hit the goal" pattern, which the README links to Anthropic's "Building effective agents" post (L45).
- **Framework claim:** "I've tried every agent framework out there" (crew/langchain, smolagents, langgraph, griptape), and "I don't see a lot of frameworks in production customer-facing agents" (README.md L39-41).
- **The typical journey:** the author has "talked to at least 100 SaaS builders (mostly technical founders)". The usual path is: grab `$FRAMEWORK`, reach a 70–80% quality bar, find 80% "isn't good enough", reverse-engineer the framework, and "Start over from scratch" (README.md, "Why 12-factor agents?"). This is self-reported, anecdotal evidence.
- **Recommendation:** "take small, modular concepts from agent building, and incorporate them into their existing product". These can be applied by engineers "even if they don't have an AI background" (README.md, "Design Patterns for great LLM applications").
- **Disclaimers:** the guide is "BY NO MEANS meant to be a dig" on frameworks. "I'm not going to talk about MCP." It uses TypeScript "for reasons" (README.md, "Random Disclaimers").
- **The history** ([content/brief-history-of-software.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/brief-history-of-software.md)):
  - Software is a directed graph, as flowcharts showed, "60 years ago" (L14-16).
  - DAG orchestrators such as Airflow, Prefect, Dagster, Inngest and Windmill arrived "20 years ago" (L20-22).
  - DAGs with ML steps came "10-15 years ago" (L26-32).
  - The promise of agents: "you get to throw the DAG away" and the LLM picks the path (L36-44).
  - Agents as a loop of LLM picks next step → code executes → result appended → repeat until done, with a Python loop snippet (L46-67).
- **The problem:** "Agents get lost when the context window gets too long… literally thats it, but that's enough to kneecap the approach" (brief-history L91-92). "you'll ALWAYS get better results with a small, focused prompt and context" (L98). Builders found "anything more than 10-20 turns becomes a big mess". The guide asks: "Can you imagine a web app that crashed on 10% of page loads?" (L100).
- **Opening jab:** the history opens with a swipe at the OpenAI Responses API: "pushing MORE agent logic behind an API ain't it" (L7).
- **What works, "micro agents":** the agent pattern embedded in a broader deterministic DAG (L106-114). The worked example is deploybot. Deterministic code deploys to staging and runs e2e tests, then hands the agent "deploy SHA 4af9ec0 to production". The agent proposes deploy calls, a human rejects one with "can you deploy the backend first?", and deterministic code requests approval and runs each deploy and the prod e2e tests (L118-139). The guide says this is based on "a real life OSS agent we've shipped to manage our deployments at Humanlayer" (`got-agents/agents/deploybot-ts`) and keeps the LLM focused on "a small, 5-10 step workflow" (L150-155).
- **"So what's an agent really?"** Four components: a **prompt** (factor 2), a **switch statement** (factor 8), **accumulated context** (factor 3), and a **for loop** that runs until a terminal tool call (factor 8) (brief-history L161-164).
- **Self-aware aside:** "We ignored all our own advice and built a framework for running distributed agents in kubernetes" (`humanlayer/kubechain`) ([README.md, Related Resources](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)).
- **Intellectual lineage cited:** 12factor.net; "Library patterns: Why frameworks are evil" (Tomas Petricek); Sandi Metz's "The Wrong Abstraction"; "Prompts are Functions" (a BAML interview) (README.md, Related Resources).

### Inferences
- The central causal claim is that long context degrades agents, so you should keep loops short and own the context. In this guide it rests on practitioner intuition and a swyx tweet (brief-history L102), not on benchmarks. A later report should pair it with external long-context or agent-reliability evidence, or mark it as unsupported here.
- The anti-framework stance targets prompt and control-flow opacity specifically. That gives a useful checklist for our own SDK: expose the prompt, the serialization of context, the loop and the pause points.

### Gaps
- The "100 SaaS builders" and "70-80%" figures have no supporting data or method.

## Relation to HumanLayer's products, BAML, and conflicts of interest

### Takeaway
The guide doubles as a content-marketing funnel. In the author's own words, factor 11 is "the humanlayer pitch". The template and workshops wire in HumanLayer's human-contact and approval SDK, and every prompt example uses BAML from BoundaryML, whose cofounder co-hosts webinars with the author. By November 2026 HumanLayer has pivoted from an approvals and human-contact API to a "multiplayer coding agent IDE and cloud". The SDK the template depends on has not been released since mid-2025.

### Cited Findings
- **The pitch:** factor 11 opens "If you're waiting for the humanlayer pitch, you made it." ([content/factor-11-trigger-from-anywhere.md L5](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-11-trigger-from-anywhere.md)). The README motivation is framed as "In building HumanLayer, I've talked to at least 100 SaaS builders" ([README.md](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)).
- **HumanLayer SDK in the template:** `template/package.json` depends on `"humanlayer": "^0.7.7"` and `"@boundaryml/baml": "latest"` (unpinned) ([packages/create-12-factor-agent/template/package.json](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/create-12-factor-agent/template/package.json)). `src/server.ts` imports `{ ContactChannel, FunctionCall, HumanContact, humanlayer, … }` from `'@humanlayer/sdk'`, a package that is not declared in `package.json` (an inconsistency). It also builds `humanlayer({ runId, contactChannel })` ([template/src/server.ts L4, L62-66](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/create-12-factor-agent/template/src/server.ts)).
- **Workshop chapters on HumanLayer:** "Human Approvals over email" and "HumanLayer Webhook Integration" (sections `11-humanlayer-approval`, `12-humanlayer-webhook`) ([workshops/2025-05/walkthrough.yaml](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/workshops/2025-05/walkthrough.yaml)).
- **A2H protocol draft:** "A2H is a service that allows an agent to request human interaction". "Why another protocol? MCP and A2A are not enough". It defines Kubernetes-style objects (`apiVersion: proto.a2h.dev/v1alpha1`, `kind: Message` / `NewConversation`, spec/status with an optional `response_schema`). The agent can find humans to contact without seeing their contact details ([drafts/a2h-spec.md L1-60](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/drafts/a2h-spec.md)). The template mirrors these objects in Zod as `Message<T>`, `ApprovalSchema = z.object({approved, comment?})` and `NewConversation` ([template/src/a2h.ts](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/create-12-factor-agent/template/src/a2h.ts)).
- **BAML:** factor 2's prompt example and the template are written in BAML ([content/factor-02-own-your-prompts.md L69](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-02-own-your-prompts.md); [template/baml_src/agent.baml](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/packages/create-12-factor-agent/template/baml_src/agent.baml)). Factor 4 defers to BoundaryML's Schema-Aligned Parsing post. The README links "BAML on GitHub" and says "I do webinars about Maximizing LLM Performance with @hellovai" (`hellovai/ai-that-works`) ([README.md, Related Resources](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)). Background knowledge, not verified this session: @hellovai is Vaibhav Gupta, a BoundaryML cofounder.
- **HumanLayer as of November 2026:**
  - The site's title is "HumanLayer - The multiplayer control plane for your software factory". It describes "a multiplayer coding agent IDE and cloud" with tasks, sessions, plan artifacts and code diffs, and says "The team that brought you context engineering…" ([humanlayer.dev](https://www.humanlayer.dev/), fetched 2026-11-18).
  - The `humanlayer/humanlayer` README says it "runs coding agents (Claude Code, Codex, OpenCode, Pi) on your machines and lets your team steer them". It is Apache-2.0, with "Copyright 2025-2026 QueryTale, Inc. d/b/a HumanLayer" in NOTICE ([README](https://raw.githubusercontent.com/humanlayer/humanlayer/main/README.md), [NOTICE](https://raw.githubusercontent.com/humanlayer/humanlayer/main/NOTICE), fetched 2026-11-18).
- **npm packages:**
  - `@humanlayer/sdk`: latest 0.7.9, published 2025-06-03, "typescript client for humanlayer.dev" ([registry.npmjs.org/@humanlayer/sdk](https://registry.npmjs.org/@humanlayer/sdk)).
  - `humanlayer`: latest is `0.17.2-npm`, published 2025-11-25, "HumanLayer, but on your command-line." ([registry.npmjs.org/humanlayer](https://registry.npmjs.org/humanlayer)). Neither is marked deprecated.

### Inferences
- **Conflicts of interest:**
  - (a) Factors 6, 7 and 11 (pause/resume, human contact as tool calls, multi-channel triggers) are exactly the problems HumanLayer's original approvals API sold a solution to.
  - (b) The "own your prompts" examples promote BAML, a partner's product.
  - (c) "Frameworks fall short" is partly a vendor argument for buying a component (human-in-the-loop) instead of a framework.
  - The technical advice still stands on its own merits and mostly says "do it yourself". The template's `^0.7.7` range sits on the `humanlayer` npm name, which has shipped a CLI since 0.8.0 and is at 0.17.x. The caret still resolves to the 0.7.7 client, though (corrected in the fact-check log, row 31); the install problem is `server.ts`'s undeclared `@humanlayer/sdk` import. Treat the template as historical (inference from the registry data).
- Since the pivot, HumanLayer's own product line has moved from "agents that contact humans" to "humans steering coding agents". The 12-factor guide predates that shift and does not mention it.

### Gaps
- I did not fetch the old HumanLayer approvals or SDK docs, so how `humanlayer()`, `contactChannel` and `function_call.completed` worked in 2025 rests only on the template code.

## Reception (secondary) and mentions in this repo's Hacker News corpus

### Takeaway
The README links an AI Engineer World's Fair talk and a YouTube deep dive, but I could not see stars or other popularity metrics. This repo's practitioner corpus never mentions "12-factor" or "12 factor" anywhere, including the raw HN JSON. HumanLayer and Dex Horthy do appear, as the author of four HN submissions about context engineering and coding-agent benchmarks, and in comments. Some of those comments call his writing an ad for HumanLayer.

### Cited Findings
- **Talks:** the README badges link an "aidotengineer conf_talk (17m)" ([YouTube 8kMaTybvDUw](https://www.youtube.com/watch?v=8kMaTybvDUw)) and a "youtube deep_dive" ([YouTube yxJDyQ8v6P0](https://www.youtube.com/watch?v=yxJDyQ8v6P0)). A tip reads "Missed the AI Engineer World's Fair? Catch the talk here" ([README.md L23-26](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)). It also links a March 2025 "Tool Use" podcast episode ([README.md, Related Resources](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/README.md)). These are self-reported; I did not open the videos.
- **Self-reported influence:** factor 3 claims precedence for "context engineering": "About 2 months after 12-factor agents was published, context engineering started to become a pretty popular term" ([factor-03 L247](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-03-own-your-context-window.md)). The HumanLayer site says "The team that brought you context engineering" ([humanlayer.dev](https://www.humanlayer.dev/)). Both are self-claims.
- **Stars:** `https://github.com/humanlayer/12-factor-agents` returned HTTP 403 through the proxy, so no star count is reported.
- **HN corpus, no matches:** a case-insensitive grep for `12-factor|12 factor|twelve-factor|humanlayer|horthy` over `docs/research/practitioners/practitioner-research.md`, `notes/`, `corpus.md` and `fact-check.md` found nothing. A scan of every comment and title in `docs/research/practitioners/.raw/*.json` for "12-factor", "12 factor" or "twelve-factor" also found nothing. Source: local grep, 2026-11-18.
- **HN corpus, Dex Horthy's submissions.** The four HN stories submitted by `dhorthy` all link the separate repo `humanlayer/advanced-context-engineering-for-coding-agents`:
  - "Getting AI to work in complex codebases" (2025-09-23, 517 points), at [corpus.md L78](../../practitioners/corpus.md) and [HN 45347532](https://news.ycombinator.com/item?id=45347532).
  - "Why Software Factories Fail (or: harness engineering is not enough)" (2026-07-23, 394 points), at corpus.md L309 and [HN 49023019](https://news.ycombinator.com/item?id=49023019).
  - "Benchmarking Opus 5 on SlopCodeBench" (2026-07-27), at corpus.md L311 and [HN 49076391](https://news.ycombinator.com/item?id=49076391).
  - "SlopCodeBench 10/2026 – Opus 5.5…" (2026-10-15), at corpus.md L375 and [HN 50108717](https://news.ycombinator.com/item?id=50108717).
- **HN comments that mention HumanLayer** (all in `.raw/`):
  - jascha_eng: "Except for ofc pushing their own product (humanlayer)… the basics in this post about compaction and doing human review at the correct level are pretty good" ([HN 45350892](https://news.ycombinator.com/item?id=45350892)).
  - romanovcode: "It's just a long ad for his product - humanlayer." ([HN 49033041](https://news.ycombinator.com/item?id=49033041)).
  - dhorthy: "github.com/humanlayer/humanlayer - it was overslopped and we reset from scratch to build it right" ([HN 49027028](https://news.ycombinator.com/item?id=49027028)).
  - Separately, a commenter recommends the `.claude/agents` setup in the `humanlayer/humanlayer` repo ([HN 45237161](https://news.ycombinator.com/item?id=45237161)).

### Inferences
- In this corpus, practitioners engage with Horthy's later context-engineering and coding-agent material, not with 12-factor-agents itself. The guide's reach, as far as this repo can show, is indirect. The "advertising" criticism attaches to the author's work in general, and a report can cite it as context for the conflict-of-interest note.

### Gaps
- No independent, primary measure of 12-factor-agents' adoption (stars, forks, citations, framework docs that reference it) was reachable this session. Any such figure in the later report must come from another source and be marked "as of".
