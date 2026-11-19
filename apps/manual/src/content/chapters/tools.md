---
title: "Tools: schemas, validation, errors the model can read, and identity it cannot fake"
summary: A tool is a contract between your code and a model. The model learns it from a name, a description and a schema; your SDK checks every argument, a failed call comes back as a message the model can act on, and the user's identity comes from the signed-in session, never from the model.
opening: incident
sources: [anthropic-how-tool-use-works, anthropic-writing-tools]
glossary: [tool, agent-loop]
switchTo: [B10]
---

In November 2026 we read the eight support agents we had built for this book side by side, one on each SDK we verify, and found the same hole in six of them. Each one answers tickets with the help of lookup tools, and in those six a lookup takes the customer's email, order number or customer id as an argument that the model fills in. Now picture a ticket from Ada: she was charged twice this month, and would we please also check bob@example.com, who sits on her team. The model reads the ticket, sees a tool whose schema asks for an email, and calls it with Bob's address. Bob's plan and open tickets land in the context of a reply addressed to Ada. Nobody broke in; the tool asked the model a question that only the signed-in session should answer.

That hole is a tool design mistake, and no prompt fixes it. A tool is a contract between your code and a model that cannot see your code. The model learns the contract from a few lines of text, your SDK checks what the model sends against it, and the result goes back as more text. This chapter builds one contract piece by piece, in four SDKs: the schema the model reads and the SDK enforces, the error a failed call returns, the small set of tools worth offering, and the identity that no argument can override. By the end you can write a tool that a model uses well, and that it cannot turn against the user who is signed in.

## The model learns a tool from its name, description and schema, and the SDK checks every argument

Think of :analogy[a form at a counter]{#counter-form}, the kind you fill in at a post office. The form has a title, a line of instructions and labelled boxes, some marked for a date or a number. The clerk behind the counter never explains the job; whatever the form says is all you have to go on. A model meets a tool the same way. Anthropic's tool-use documentation puts it plainly: the model "never receives your implementation; it only receives the schema you provided and the result you returned" [@anthropic-how-tool-use-works].

Three parts of a tool definition reach the model, and one part stays with you. The name and the description are the form's title and instructions, and the input schema is its boxes, each with a type. The function that does the work, called `execute` in three of the four SDKs below and a handler in the fourth, runs in your process after the call comes back. [[lst:tool-openai]] and its three neighbours define the same small lookup in four SDKs; switch tabs to compare them.

::::tabs
:::listing[OpenAI Agents SDK]{#tool-openai file="verify/openai-agents-sdk/examples/02-function-tool.ts" region="function-tool"}
::note[A Zod schema: one string box, `city`. The SDK turns it into the JSON Schema the model reads.]{#schema}
::note[Your code. The model never sees this function, only the name, description and schema above it.]{#execute}
:::
:::listing[Google ADK]{#tool-adk file="verify/google-adk/examples/01-function-tool.ts" region="function-tool"}
::note[ADK turns the Zod schema into a Gemini function declaration, and `.describe()` adds the text the model reads for the box.]{#schema}
::note[Your code, which runs only after the arguments pass the schema.]{#execute}
:::
:::listing[Pi]{#tool-pi file="verify/pi/examples/02-custom-tool.ts" region="custom-tool"}
::note[Pi takes a TypeBox schema, which is JSON Schema already.]{#schema}
::note[Your code, with the tool call's id first and the checked arguments second. It returns `content` for the model and `details` for your own records.]{#execute}
:::
:::listing[Claude Agent SDK]{#tool-claude file="verify/claude-agent-sdk/examples/02-custom-tool.ts" region="custom-tool"}
::note[A Zod raw shape: an object of fields, not a `z.object`. The SDK's in-process MCP server offers it to the model.]{#schema}
::note[The handler, your code, which receives the arguments after Zod has checked them.]{#handler}
:::
::::

The four listings differ in syntax and agree on the contract. Each names the tool, describes it in a sentence and declares one or two typed inputs, and each keeps the work in a function the model cannot read. The schema does more than document the inputs. In ADK, the example's checks confirm that the Zod object becomes a function declaration whose `orderId` field is a required string, which is the form the model actually receives.

Because the description is the only instruction on the form, its wording changes what the model does. Anthropic's advice is to describe a tool the way "you would describe your tool to a new hire on your team", making explicit the context you would otherwise assume, and to name inputs without ambiguity: "instead of a parameter named `user`, try a parameter named `user_id`{checked=row-14}" [@anthropic-writing-tools]. Anthropic reports that Claude Sonnet 3.5 reached state-of-the-art performance on the SWE-bench Verified evaluation "after we made precise refinements to tool descriptions". The one-sentence descriptions in these listings are fine for a weather demo. For a tool that touches money or customer data, we recommend writing the three or four sentences a new colleague would need, including when not to call it.

The form analogy breaks at the clerk. A clerk reads every box and hands back a form with a word where a date belongs, but a schema only describes the boxes, and a model can still fill one wrongly. So each SDK checks the model's arguments against the schema before your function runs:

- **OpenAI Agents SDK** parses the arguments with the Zod schema, and it insists on its `strict`{checked=row-12} mode for a Zod schema, which makes the SDK reject arguments that do not match.
- **ADK** applies the Zod object with `parse()`. A call that does not match never reaches `execute`, and keys the schema does not declare are dropped.
- **Pi** first coerces common slips, such as `"42"` sent for a number, then validates against the schema.
- **Claude Agent SDK** validates with Zod inside its in-process MCP server, so the handler receives checked arguments.

[[lst:weather-run]] runs the OpenAI tool from the first tab through one full call. The replay shows exactly what crosses the boundary in each direction.

:::listing[One tool call, from offer to answer]{#weather-run file="verify/openai-agents-sdk/examples/02-function-tool.ts" region="run" replay}
::note[The scripted model's first turn calls `get_weather` with the city Lisbon; its second answers in text.]{#script}
::note[The agent offers the model one tool, `weather` from [[lst:tool-openai]].]{#agent}
::note[`runner.run` runs the loop: it validates the call, runs `execute`, sends the result back and stops when the model answers.]{#run}
:::

Step through the replay and you see the contract at work. The first request carries the user's question and the tool's name, `get_weather`, and nothing of its function. The model answers with a call, `get_weather` with `{ "city": "Lisbon" }`, and finishes with `"tool-calls"`. The SDK checks the arguments, runs `execute`, and sends its output, "Lisbon: sunny", back as a tool result in the second request. The model then answers "It is sunny in Lisbon.", the run ends, and the example's checks confirm that `execute` received the parsed arguments and that the second request carried the result. Each pass through this cycle is one turn of the agent loop from [[ch:call-workflow-loop]].

That call went well. [[fig:tool-round-trip]] traces the case the next section is about, from the ADK listing: the model's first call breaks the schema, and the check sends back an error instead of running the function.

:::figure[One tool call's round trip: the schema goes to the model, the SDK checks the call, and only a valid call runs]{#tool-round-trip}
::svg{alt="Two lanes, your code and its SDK on the left, the model on the right. The schema, orderId is a string, goes to the model, which sees the name, description and schema and calls the tool with orderId 42. The SDK validates the arguments; the call fails, and an error result saying expected string goes back to the model. The model retries with orderId A-1, which passes: execute runs in your process, and the model reads the result, order A-1 shipped."}
:::

## Exercises

1. Drafted with the last section.
