---
title: "Tools: schemas, validation, errors the model can read, and identity it cannot fake"
summary: A tool is a contract between your code and a model. The model learns it from a name, a description and a schema; your SDK checks every argument, a failed call comes back as a message the model can act on, and the user's identity comes from the signed-in session, never from the model.
opening: incident
sources: [anthropic-how-tool-use-works, anthropic-writing-tools, claude-agent-sdk-custom-tools, ruan-skillcfi, owasp-llm06-excessive-agency, openai-agents-context]
glossary: [tool, agent-loop, mcp, prompt-injection, trusted-context]
switchTo: [B10]
---

In November 2026 we read the eight support agents we had built for this book side by side, one on each SDK we verify, and found the same hole in six of them. Each one answers tickets with the help of lookup tools, and in those six a lookup takes the customer's email, order number or customer id as an argument that the model fills in. Now picture a ticket from Ada: she was charged twice this month, and would we please also check bob@example.com, who sits on her team. The model reads the ticket, sees a tool whose schema asks for an email, and calls it with Bob's address. Bob's plan and open tickets land in the context of a reply addressed to Ada. Nobody broke in; the tool asked the model a question that only the signed-in session should answer.

That hole is a tool design mistake, and no prompt fixes it. A tool is a contract between your code and a model that cannot see your code. The model learns the contract from a few lines of text, your SDK checks what the model sends against it, and the result goes back as more text. This chapter builds one contract piece by piece, in four SDKs: the schema the model reads and the SDK enforces, the error a failed call returns, the small set of tools worth offering, and the identity that no argument can override. By the end you can write a tool that a model uses well, and that it cannot turn against the user who is signed in.

## The model learns a tool from its name, description and schema, and the SDK checks every argument

Think of :analogy[a form at a counter]{#counter-form}, the kind you fill in at a post office. The form has a title, a line of instructions and labelled boxes, some marked for a date or a number. The clerk behind the counter never explains the job; whatever the form says is all you have to go on. A model meets a tool the same way. Anthropic's tool-use documentation puts it plainly: the model "never receives your implementation; it only receives the schema you provided and the result you returned" [@anthropic-how-tool-use-works].

Three parts of a tool definition reach the model, and one part stays with you. The name and the description are the form's title and instructions, and the input schema is its boxes, each with a type. The function that does the work, called `execute` in three of the four SDKs below and a handler in the fourth, runs in your process after the call comes back. [[lst:tool-openai]] and its three neighbours each define a small lookup, the weather in three SDKs and an order's status in ADK; switch tabs to compare them.

::::tabs
:::listing[OpenAI Agents SDK]{#tool-openai file="verify/openai-agents-sdk/examples/02-function-tool.ts" region="function-tool"}
::note[A schema written with Zod, a TypeScript library for declaring and checking data shapes: one string box, `city`. The SDK turns it into the JSON Schema the model reads.]{#schema}
::note[Your code. The model never sees this function, only the name, description and schema above it.]{#execute}
:::
:::listing[Google ADK]{#tool-adk file="verify/google-adk/examples/01-function-tool.ts" region="function-tool"}
::note[ADK turns the Zod schema into a Gemini function declaration, and `.describe()` adds the text the model reads for the box.]{#schema}
::note[Your code, which runs only after the arguments pass the schema.]{#execute}
:::
:::listing[Pi]{#tool-pi file="verify/pi/examples/02-custom-tool.ts" region="custom-tool"}
::note[Pi takes a schema built with TypeBox, a TypeScript library whose schemas are JSON Schema already.]{#schema}
::note[Your code, with the tool call's id first and the checked arguments second. It returns `content` for the model and `details` for your own records.]{#execute}
:::
:::listing[Claude Agent SDK]{#tool-claude file="verify/claude-agent-sdk/examples/02-custom-tool.ts" region="custom-tool"}
::note[A Zod raw shape: an object of fields, not a `z.object`. The SDK offers it to the model through an MCP server that runs in your process. MCP, the Model Context Protocol, is an open standard for connecting AI applications to the systems where data lives.]{#schema}
::note[The handler, your code, which receives the arguments after Zod has checked them.]{#handler}
:::
::::

The four listings differ in syntax and agree on the contract. Each names the tool, describes it in a sentence and declares one or two typed inputs, and each keeps the work in a function the model cannot read. The schema is also the form the model actually receives. In ADK, the example's checks confirm that the Zod object becomes a function declaration whose `orderId` field is a required string.

Because the description is the only instruction on the form, its wording changes what the model does. Anthropic's advice is to describe a tool the way "you would describe your tool to a new hire on your team", making explicit the context you would otherwise assume, and to name inputs without ambiguity: "instead of a parameter named `user`, try a parameter named `user_id`{checked=row-14}" [@anthropic-writing-tools]. Anthropic reports that Claude Sonnet 3.5 reached state-of-the-art performance on SWE-bench Verified "after we made precise refinements to tool descriptions". That benchmark is a set of 500 real GitHub issues from Python projects, each checked by hand. The one-sentence descriptions in these listings are fine for a weather demo. For a tool that touches money or customer data, we recommend writing the three or four sentences a new colleague would need, including when not to call it.

A schema checks nothing by itself. It only describes the boxes, so a model can still fill one wrongly, and each SDK checks the model's arguments against the schema before your function runs:

- **OpenAI Agents SDK** parses the arguments with the Zod schema, and it insists on its `strict`{checked=row-12} mode for a Zod schema, which makes the SDK reject arguments that do not match.
- **ADK** applies the Zod object with `parse()`. A call that does not match never reaches `execute`, and keys the schema does not declare are dropped.
- **Pi** first coerces common slips, such as `"42"` sent for a number, then validates against the schema.
- **Claude Agent SDK** validates with Zod inside its in-process MCP server, so the handler receives checked arguments.

A clerk still does one thing that no SDK does: read what you wrote as well as where you wrote it, and ask you a question when an answer makes no sense. The SDK asks only whether each box holds the right type. Any string passes as an `orderId`, so an order number the model invented would reach the function in [[lst:tool-adk]], which reports every order it is given as shipped. Your function still has to check that a value is real and that it belongs to the user, as the identity section shows.

[[lst:weather-run]] runs the OpenAI tool from the first tab through one full call. The replay shows exactly what crosses the boundary in each direction.

:::listing[One tool call, from offer to answer]{#weather-run file="verify/openai-agents-sdk/examples/02-function-tool.ts" region="run" replay}
::note[The scripted model's first turn calls `get_weather` with the city Lisbon; its second answers in text.]{#script}
::note[The agent offers the model one tool, `weather` from [[lst:tool-openai]].]{#agent}
::note[`runner.run` runs the loop: it validates the call, runs `execute`, sends the result back and stops when the model answers.]{#run}
:::

Each event in the replay is one side of the contract. The first request carries the user's question and the tool's name, `get_weather`, and nothing of its function. The model answers with a call, `get_weather` with `{ "city": "Lisbon" }`, and finishes with `"tool-calls"`. The SDK checks the arguments, runs `execute`, and sends its output, "Lisbon: sunny", back as a tool result in the second request. The model then answers "It is sunny in Lisbon.", the run ends, and the example's checks confirm that `execute` received the parsed arguments and that the second request carried the result. Each pass through this cycle is one turn of the agent loop from [[ch:call-workflow-loop]].

That call went well. [[fig:tool-round-trip]] traces the case the next section is about, from the ADK listing: the model's first call breaks the schema, and the check sends back an error instead of running the function.

:::figure[One tool call's round trip: the schema goes to the model, the SDK checks the call, and only a valid call runs]{#tool-round-trip}
::svg{alt="Two lanes, your code and its SDK on the left, the model on the right. The schema, orderId is a string, goes to the model, which sees the name, description and schema and calls the tool with orderId 42. The SDK validates the arguments; the call fails, and an error result saying expected string goes back to the model. The model retries with orderId A-1, which passes: execute runs in your process, and the model reads the result, order A-1 shipped."}
:::

## A failed call comes back as a result the model can read, and it should say what to try next

You feed a coin into :analogy[a vending machine that hands back your coin with a note]{#vending-machine}, and the coin drops into the return tray with a slip that reads "exact change only". Nothing jammed, nobody had to call a technician, and you know your next move: find two smaller coins. Compare the machine that swallows the coin, or the one that blinks "E-17". [[fig:vending-machine]] shows the helpful machine.

:::figure[A vending machine that hands back your coin with a note: the failure comes back with what to try next]{#vending-machine analogy="vending-machine"}
::svg{alt="A vending machine with two rows of snacks, A1 to B3, and a coin slot. An arrow from you inserting one large coin points at the slot. The return tray, highlighted, holds your coin, back, and an arrow leads from it to a note that says exact change only, try two small coins. Text between them reads: the machine says what to try next."}
:::

A tool call fails in the same two ways a coin can. The model can send arguments that break the schema, like a coin of the wrong size, or your function can throw, like a machine that is out of stock. By default, in every SDK in this chapter, neither failure ends the run. Both exceptions we found are in the OpenAI Agents SDK. A tool that declares an `outputSchema`{checked=row-85} gets no default error handler, so a throw ends the run unless the tool sets its own; a failed asynchronous schema check ends it too. In every other case the SDK catches the failure, turns it into a tool result, and sends that result to the model on its next turn, so the model reads the failure the way it reads any other result and decides what to do. [[lst:adk-retry]] scripts the first kind of failure, and its replay shows the whole exchange.

:::listing[A call that breaks the schema, and the retry that follows]{#adk-retry file="verify/google-adk/examples/01-function-tool.ts" region="retry" replay}
::note[The scripted model's first call sends `orderId` as the number 42, where [[lst:tool-adk]] asks for a string.]{#bad-call}
::note[Its second call sends the string `"A-1"`. A script retries because its author wrote it to; a real model decides for itself, from the error it reads.]{#retry}
:::

In the replay, the first call reaches ADK with `{ "orderId": 42 }`, and the Zod check rejects it before `execute` runs. ADK keeps the loop running: it wraps the failure as "Error in tool 'get_order_status'", followed by Zod's issue list, whose message reads "Invalid input: expected string, received number", and sends it back under an `error`{checked=row-28} key. The second call sends `"A-1"`, passes the check and runs the function, whose output comes back as "order A-1 shipped". The model then answers, after three model calls in all. The example's checks confirm each step: the failed arguments came back as an error, "not as an exception", and the function body ran only for the valid call.

What the model reads after a failure depends on the SDK, and the defaults differ more than the tool definitions did. [[tbl:tool-errors]] sets them side by side, as of November 2026.

:::table[What the model reads when a tool call fails, by default]{#tool-errors}
| SDK | The arguments break the schema | The function throws |
| --- | --- | --- |
| OpenAI Agents SDK | One fixed sentence: "An error occurred while running the tool. Please try again." | The same sentence |
| Google ADK | An error field: "Error in tool '…'" and Zod's issues | An error field: "Error in tool '…'" and the thrown message |
| Pi | "Validation failed for tool …", each failing field, and the arguments received | The thrown message, marked as an error |
| Claude Agent SDK | An error result from the in-process MCP server, starting "MCP error -32602: Input validation error" | The raw exception message, marked as an error |
:::

The OpenAI default deserves a second look, because it hides the cause on purpose. Its code says the default "returns a fixed message without inspecting the exception", so an internal detail such as a database host or a stack trace never reaches the model. The price is a model that learns nothing about what to change. To tell it more, a tool sets `errorFunction`{checked=row-31}, which receives the error and returns the text the model reads. The other three SDKs pass the cause through by default. The Claude row's first cell comes from reading the SDK's bundled code, not from a run, because our harness has no example that sends it invalid arguments.

You can do better than any of these defaults by writing the error yourself. Anthropic's advice is to "prompt-engineer your error responses to clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks" [@anthropic-writing-tools]. The Claude Agent SDK's documentation makes the same point about its handlers: return the failure with `isError: true`{checked=row-33}, and "You can add context the raw exception lacks, such as which request failed or what to try instead" [@claude-agent-sdk-custom-tools]. Pi takes the same flag on a tool's result, and an OpenAI tool can simply return the message as its output. Compare two errors for an order lookup that finds nothing:

- "Not found."
- "No order 4417 was found for this customer. Ask the customer to confirm the order number; do not guess one."

The second is the vending machine's note. It names the cause, gives the next step, and rules out the tempting wrong step, which for a model is to invent a plausible order. We recommend that every error a tool returns say what to try next and, where a wrong next step is likely, what not to do. One measurement from a neighbouring setup supports the first part. SkillCFI is a run-time enforcer that refuses a request breaking a skill's step order, and its authors tried three refusal messages on one model, over 80 refused sessions each: the reason alone, the reason plus a note that the request did not run, and those plus the steps allowed next. A session counted as recovered only if it then reached the expected ending with no further refusal. That happened in 17 of 80 sessions with the reason alone and 22 with the note, but 52 with the next steps added [@ruan-skillcfi]. The refusal there comes from an enforcer, not from an SDK's schema check, and the third message also carried workflow facts, so the figure shows that naming the next step can help a model, not how much a tool's error should. No source we found measures what not to do.

Here the comparison runs out. You read "exact change only" and go looking for coins. A model may skim the error, retry the same arguments, or answer as though the call had worked, and the replay above retries correctly only because its script says so. So the note has to be specific enough to act on, and the loop still needs the cap from [[ch:call-workflow-loop]]: a model that retries the same broken call forever never stops asking for tools.

## Offer a few tools shaped like the work, with clear names and results worth their tokens

Suppose your shop's API has three endpoints for orders, one to list a customer's orders, one to fetch an order and one to fetch a shipment, and you wrap each in a tool. To answer "where is my order?", the model must now call all three in the right order, carry ids from one result into the next call, and read three payloads, most of whose fields it never needed. Anthropic calls this pattern "a common error": "tools that merely wrap existing software functionality or API endpoints" [@anthropic-writing-tools]. Its advice runs the other way: "We recommend building a few thoughtful tools targeting specific high-impact workflows". The ADK listing's `get_order_status` is that shape in miniature. It takes the one thing the model knows, an order id, and returns the one thing the customer asked, its status.

Anthropic's post gives three consolidations of the same kind:

- `schedule_event`{checked=row-41}, which "finds availability and schedules an event", in place of `list_users`{checked=row-41}, `list_events`{checked=row-41} and `create_event`{checked=row-41};
- `search_logs`{checked=row-41}, which "only returns relevant log lines and some surrounding context", in place of `read_logs`{checked=row-41};
- `get_customer_context`{checked=row-41}, which "compiles all of a customer's recent & relevant information all at once", in place of three lookups by id.

Each consolidated tool moves work out of the model's context and into your code, where looping, joining and filtering cost nothing in tokens. The post also warns that "Too many tools or overlapping tools can also distract agents from pursuing efficient strategies."

In our view, consolidation stops at the side effect. A tool that both reads an order and refunds it cannot be marked read-only, and the marking matters: in the Claude Agent SDK, `readOnlyHint`{checked=row-44} "Controls whether the tool can be called in parallel with other read-only tools" [@claude-agent-sdk-custom-tools]. A refund also needs a gate that a lookup does not, as [[ch:approvals-guardrails-and-injection]] shows. We recommend splitting tools by what they change first, then consolidating within each side.

Names matter once tools come from more than one place, because a model choosing between two tools called "search" has only their descriptions to go on. Anthropic recommends namespacing, "grouping related tools under common prefixes", by service, such as `asana_search`{checked=row-46} and `jira_search`{checked=row-46}, and by resource. The Claude Agent SDK namespaces every tool it gets over MCP, as [[lst:claude-allowed]] shows.

:::listing[A namespaced tool: the server's name becomes part of the tool's]{#claude-allowed file="verify/claude-agent-sdk/examples/02-custom-tool.ts" region="allowed-tools"}
::note[The tool from [[lst:tool-claude]] reaches the model as `mcp__weather__get_temperature`: the prefix "mcp", then the key you gave the server in `mcpServers`, then the tool's own name, joined by double underscores.]{#allowed}
:::

A result deserves the same care as a schema, because every token of it lands in the context and stays there for the rest of the run. Anthropic asks tools to "return only high signal information" and to drop "low-level technical identifiers". It reports that "merely resolving arbitrary alphanumeric UUIDs to more semantically meaningful and interpretable language … significantly improves Claude's precision in retrieval tasks by reducing hallucinations." For results that can grow, it suggests "some combination of pagination, range selection, filtering, and/or truncation with sensible default parameter values", and notes that Claude Code caps tool responses "to 25,000 tokens by default". A `response_format`{checked=row-49} input with "concise" and "detailed" values lets the model choose. In the post's Slack example, the concise form used about a third of the tokens of the detailed one.

Pi builds that split into the result itself. A Pi tool returns `content` for the model and `details` for your logs and interface, as [[lst:tool-pi]] does, so a record can carry everything you want to keep while the model reads one line. The rule behind it is the one this section started from: the model should see the fields that inform its next action, and your code should keep the rest.

## Identity comes from the signed-in session, never from the model

At :analogy[passport control]{#passport-control}, you can tell the officer any name you like. The officer reads your passport instead, a document someone else issued and the officer can check against your face, and your claim at the desk changes nothing. Ada's ticket from the start of this chapter is a claim at the desk. When a lookup takes an email argument, the model decides whose record to read, and it decides from text that Ada wrote.

The trouble starts with where arguments come from. Every argument in a tool call is text the model wrote after reading its whole context: the user's message, earlier tool results, perhaps a web page or an email a tool fetched. Some of that text comes from people other than the signed-in user, and some may carry instructions planted for the model to follow, the attack called prompt injection. So any argument that names whose data a tool reads or changes is a choice made under the influence of whoever wrote the context. OWASP's guidance on excessive agency names the fix: "Execute extensions in user's context", so that actions "taken on behalf of a user are executed on downstream systems in the context of that specific user", and "Implement authorization in downstream systems rather than relying on an LLM to decide if an action is allowed or not" [@owasp-llm06-excessive-agency].

In code, the fix has two halves. First, the schema loses its identity field: a lookup of the signed-in customer's orders asks for no customer at all. Second, the tool's function reads the identity from trusted context, a value your code set from the authenticated session and handed to the tool outside its arguments. The model cannot write that value, and it sees it only if your code chooses to show it. Each SDK in this chapter offers a route, though they differ in how much they give you, as [[tbl:trusted-context]] shows.

:::table[What a tool's function receives beside the model's arguments, and where the identity can come from]{#trusted-context}
| SDK | What the function receives beside the arguments | Where the signed-in user's identity comes from |
| --- | --- | --- |
| OpenAI Agents SDK | A `RunContext` that wraps an object your code passed to the run | A field your code puts in that object when it starts the run; the SDK does not send the object to the model |
| Google ADK | A `Context` with the session's user id, session id and state | The user id your code passes when it runs the agent, and state such as a "user:customer_id" key that your code writes when it creates the session |
| Pi | A context with fields such as the working directory, the session manager and the model, but none for your own user | A value the function closes over, because your code builds the tool for each signed-in session |
| Claude Agent SDK | A second argument that its types declare only as unknown | A value the handler closes over, because your code builds the in-process MCP server for each request |
:::

The OpenAI Agents SDK is the most explicit about the boundary. Its documentation says the object behind `RunContext` "is not sent to the LLM. It is purely local", and lists "Data about the run (user name, IDs, etc.)" among its uses [@openai-agents-context]. The same page warns against a tempting shortcut. Hiding a tool from the model with an `isEnabled`{checked=row-58} check decides which tools the model sees, but those checks "run before the model produces tool or handoff arguments, so they cannot authorize a model-generated argument or resource selection". The authorization belongs inside `execute`.

Two of our capstones already work this way, and their checks show it. The ADK capstone's `lookup_customer`, in [[lst:adk-identity]], declares no parameters and reads "user:customer_id" from session state, a key the app wrote when it opened the ticket's session. Its scripted model tries to smuggle in another customer's id anyway. In the replay, the call arrives as `{ "customerId": "cust-999" }`, the plain Zod object drops the extra key, and the result holds Ada's record under "cust-42". The checks confirm that the lookup ran for the signed-in customer and that "the other customer's record never reaches the model". Do not read the dropped key as the defence, though. A schema that kept unknown keys would pass the smuggled id to the function, which would still be safe only because it never reads it. The defence is that identity comes from the session.

:::listing[A lookup that takes the customer from session state, never from the model]{#adk-identity file="verify/google-adk/examples/08-triage-agent.ts" region="lookup-customer" replay}
::note[The schema is an empty object, so the model has no field in which to name a customer, and any key it sends anyway is dropped before `execute` runs.]{#no-identity}
::note[The customer id comes from the session's state, which your code wrote when it created the session, and never from the model's arguments.]{#from-state}
:::

The Copilot capstone's `lookup_orders`{checked=row-60} takes the route that [[tbl:trusted-context]] gives Pi and the Claude Agent SDK: it closes over a customer object "set by our auth layer" and ignores the id its mock sends (`verify/copilot-sdk/examples/09-triage-agent.ts`). Copy that pattern, but not where it keeps the customer. Its `customer`{checked=row-75} is a constant at the top of the file, which is safe only because the script serves one made-up customer. A server must build the tool, or the object it closes over, for each request, from that request's authenticated session. A tool built once at module level hands one user's identity to every request. A tool that closes over one shared variable, which each request overwrites, is worse, because two overlapping requests can each read the other's user.

Some tools cannot drop every id, because the model has to say which record it means. One of the six capstones from the opening offers `lookupOrder({ orderId })`{checked=row-76}, and an order number is a fair thing for a customer to type. Such a tool keeps the id and checks it against the session. Its `execute` loads order 4417, compares the order's customer with the signed-in customer, and returns "No order 4417 was found for this customer" instead of the record. It returns that same message when no order 4417 exists at all, so the model, and anyone steering it, cannot tell another customer's order from a number nobody uses. OWASP states the rule in general form: "Enforce the complete mediation principle so that all requests made to downstream systems via extensions are validated against security policies" [@owasp-llm06-excessive-agency]. Where you can, put that check in the downstream system itself, such as a query that fetches only the session customer's orders. Then even a tool that forgets the check cannot read another customer's order.

One difference matters more than the likeness. A traveller carries the passport and hands it to the officer. In an agent, the model never holds the passport at all: your code reads the identity from the signed-in session and gives it straight to the tool, so nothing the model writes, and nothing written to the model, can stand in for it. For Ada, the fixed lookup takes no email, returns her own plan and tickets, and has no way to fetch Bob's. If the model asks about Bob anyway, the right reply, written as the error section above recommends, says that the tool reads only the signed-in customer's account and that the request should go to a person.

Put together, those are the clauses of the contract this chapter set out to write. The model reads a name, a description and a schema; the SDK checks every argument before your function runs; each failure comes back as a note that says what to try next; and whose data a tool touches is decided by the signed-in session, never by a sentence in a ticket.

## Exercises

1. **Write an error that says what to try next, and watch the retry.** In `verify/openai-agents-sdk/examples/02-function-tool.ts`, make the weather tool's `execute` throw for any city other than "Lisbon", and script the model to call `get_weather` with "Lisboa" first, then with "Lisbon", then to answer. Before you run anything, predict what the model reads after the first call, and write the prediction as a `check()` on the second request, as the file's own checks do. Run `pnpm test` in `verify/openai-agents-sdk` and read the first tool result in `results/transcripts/02-function-tool.json`, the file the replay of [[lst:weather-run]] plays. Then add an `errorFunction`{checked=row-31} that returns the error's message and the advice to use the city's English name, update your check, and run the tests again. What changed in the transcript, and what would a real model now have to go on? Restore the file and its results with `git checkout` when you are done.
2. **Take identity out of the schema.** In `verify/google-adk/examples/01-function-tool.ts`, give the session a "user:customer_id" of "cust-42" where the example creates it with `createSession`{checked=row-56}, and script the model's first call to send `{ orderId: "B-7", customerId: "cust-999" }`. Change `execute` to take ADK's `Context` as its second argument, read the customer from its state, and return an error that follows this chapter's advice for any order that customer does not own; treat "B-7" as such an order. Predict which keys `execute` receives and what the model reads, write both as checks, and run `pnpm test` in `verify/google-adk`. Which check from the original file now fails, and why is that failure correct?
3. **Redesign a set of tools on paper.** A shop exposes `list_orders(customer_email)`{checked=row-66}, `get_order(order_id)`{checked=row-66} and `refund_order(order_id, amount)`{checked=row-66} to its support agent. Rewrite the set for an agent that serves the signed-in customer: say how many tools you keep and why, name each one with a namespace, write each schema without an identity field, and write the error each returns when the order belongs to someone else. Which of your tools can be marked read-only?
