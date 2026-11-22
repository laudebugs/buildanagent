---
title: "Asking before acting: approvals, guardrails and prompt injection"
summary: An approval pauses an agent before a risky tool call and resumes it from a saved copy of the run. This chapter shows how three SDKs save and resume that pause, what happens when someone edits the saved call, why an approval is only one gate beside guardrails, and why prompt injection can be contained but not prevented.
opening: fact
sources: [openai-agents-human-in-the-loop, ai-sdk-tool-approvals, langchain-human-in-the-loop]
glossary: [approval]
switchTo: [B15, E3]
---

In November 2026 we paused a refund run, edited one order number in the saved copy and approved the pause. The pause had asked about order A-1, and the refund went to order Z-9. The edit worked on the OpenAI Agents SDK 0.21.0 and on the AI SDK 7.0.162, because the first SDK leaves the check to you and the second makes it only when you give it a secret. OpenAI's documentation says so directly: `RunState.fromString()` "does not authenticate the snapshot or the person submitting it" [@openai-agents-human-in-the-loop].

An approval is therefore more than a click. It is a pause saved as data, a decision that arrives later, and a rule for what that decision may cover. This chapter follows the pause from the model's request to the resumed run, shows what an edited call does at each step, and then places the approval among the other gates an agent needs: guardrails on what goes in and out, and containment for the prompt injection that no gate fully stops.

## An approval is a pause that your code saves, and a decision that arrives later

A model never runs a tool; it asks, and the SDK decides whether the call runs now. With approval switched on for a tool, the SDK decides "not yet". It ends the run with the call still pending and hands you what you need to continue later. The SDK has not refused the call, and nothing has run. The run is paused, and the next run starts from wherever you saved it.

Each of the three SDKs below marks a tool in one line. The AI SDK takes a `toolApproval` rule per tool, the OpenAI Agents SDK takes a `needsApproval` function on the tool, and LangChain takes an `interruptOn` entry in its human-in-the-loop middleware [@ai-sdk-tool-approvals; @openai-agents-human-in-the-loop; @langchain-human-in-the-loop].

::::tabs
:::listing[AI SDK]{#policy-ai file="verify/vercel-ai-sdk/examples/03-tool-approval.ts" region="approval-policy"}
::note[The tool that changes data. Its `execute` runs only after approval.]{#tool}
::note[The rule: this tool waits for a person. `"user-approval"` is one of four statuses; the others run the tool normally, approve it automatically or deny it.]{#rule}
:::
:::listing[OpenAI Agents SDK]{#policy-openai file="verify/openai-agents-sdk/examples/05-approval-resume.ts" region="needs-approval"}
::note[`needsApproval` returns a boolean, so it can decide from the call; here it says yes every time.]{#rule}
:::
:::listing[LangChain]{#policy-langchain file="verify/langchain/examples/03-human-in-the-loop.ts" region="interrupt-on"}
::note[The middleware names the tool and the decisions a person may give.]{#rule}
::note[A checkpointer is required: the interrupt saves the graph's state there, and the resume reads it back.]{#checkpointer}
:::
::::

Each SDK stops in a different shape, because each keeps the paused run in a different place. [[fig:paused-run]] shows what they share.

:::figure[A paused run is saved data: the run ends, a person decides later, and a second run starts from the saved copy]{#paused-run}
::svg{alt="Three columns. On the left, run 1: the model asks for the refund, and the SDK does not run the tool, so the run ends. In the middle, a store saved by your code holds the messages, the pending call issue_refund with order A-1, and an approval id. On the right, a person decides to approve or reject, run 2 starts from the stored copy, and an approved tool runs exactly once. A note says the decision may come hours later, in another process."}
:::

The AI SDK's pause is the message array itself: the first call returns a request for approval, you append the person's answer to the messages and call again. The OpenAI Agents SDK returns a list of `interruptions` and a `RunState` that serialises to a string; you approve or reject each interruption on that state and run again with it. LangChain interrupts the graph, saves its state under the thread's id, and resumes when you invoke the same thread with a `Command` that carries the decisions [@ai-sdk-tool-approvals; @openai-agents-human-in-the-loop; @langchain-human-in-the-loop].

::::tabs
:::listing[AI SDK]{#resume-ai file="verify/vercel-ai-sdk/examples/03-tool-approval.ts" region="approval-response"}
::note[The first call ends with a request for approval, and the example's checks confirm that the tool has not run.]{#pause}
::note[The person's answer goes into the messages as a response to that request's id. `approved` is `true` or `false`.]{#answer}
::note[The second call sends the whole history again. The tool runs now, once, or the model reads a denial.]{#resume}
:::
:::listing[OpenAI Agents SDK]{#resume-openai file="verify/openai-agents-sdk/examples/05-approval-resume.ts" region="approve-resume"}
::note[The run pauses with one interruption, and the example's checks confirm that the tool has not run.]{#pause}
::note[The state becomes a string, the thing you would store, and then comes back from it, as it would in a new process.]{#save}
::note[`approve` records the decision on the state; running the state again continues from the pause.]{#resume}
:::
:::listing[LangChain]{#resume-langchain file="verify/langchain/examples/03-human-in-the-loop.ts" region="resume"}
::note[The thread's id is the address of the saved state. The first call returns the request under `__interrupt__`.]{#pause}
::note[Resuming is a second call on the same thread, carrying the decision, not a new question.]{#resume}
:::
::::

All three keep the same promise. The tool does not run before the decision, and it runs exactly once after an approval. A rejection never runs it either: the AI SDK's model reads an `execution-denied`{checked=row-14} result, the OpenAI SDK's model receives the rejection message, and LangChain's model reads a tool message about the rejection, and each model can still answer [@ai-sdk-tool-approvals; @openai-agents-human-in-the-loop; @langchain-human-in-the-loop]. [[lst:approval-replay]] replays the AI SDK's pause so you can see where the run ends.

::listing[The AI SDK pauses before the refund and runs it after the answer]{#approval-replay file="verify/vercel-ai-sdk/examples/03-tool-approval.ts" region="approval-response" replay}

A pause saved as data survives what a waiting process does not. OpenAI's guide describes the flow as "designed to be interruptible for longer periods of time without keeping your server running", and tells you to keep the serialised state "in application-controlled storage, such as a server-side database" [@openai-agents-human-in-the-loop]. A person can therefore answer after lunch, from a different server, in a Slack thread. The same fact is the risk: whatever sits in storage is what the second run will trust.

## A saved approval must cover exactly the call the reviewer saw

Think of :analogy[a bank's second signature on a large payment]{#second-signature}. A company's bank will not move 4,000 on one signature. A second person reads the payment order and signs this payee and this amount, and if a clerk raises the amount afterwards, the teller refuses the order. An approval should work the same way: it says yes to one call, with one tool name and one input, and not yes to whatever the saved run says when it resumes.

:::figure[A bank's second signature on a large payment: the signature covers the order as written, so an edit voids it]{#second-signature analogy="second-signature"}
::svg{alt="Two cards side by side with the word like between them. The left card is a payment order: pay Acme Ltd, amount 4,000, signed M. Okafor. The right card is an approved tool call: tool issue_refund, orderId A-1, signature HMAC. Under the left card, a note says that if the amount changes to 40,000 the teller refuses it. Under the right card, a note says that if the orderId changes to Z-9 the signature no longer matches. A line at the bottom says the signature covers exactly what will run."}
:::

A saved run does not behave like that by default. [[lst:tamper-ai]] and [[lst:tamper-openai]] each pause a refund for order A-1, edit the saved copy to order Z-9 and then approve.

::::tabs
:::listing[AI SDK]{#tamper-ai file="verify/vercel-ai-sdk/examples/13-approval-tamper.ts" region="tamper"}
::note[The pause is the same as in [[lst:resume-ai]].]{#pause}
::note[Anyone who can write to the stored messages can do this: one replacement changes the order id in the saved tool call.]{#edit}
::note[The second call returns the error instead of throwing it, so the example can check the outcome.]{#resume}
:::
:::listing[OpenAI Agents SDK]{#tamper-openai file="verify/openai-agents-sdk/examples/10-approval-tamper.ts" region="tamper"}
::note[The edit is a string replacement in the serialised state, which sits in your database.]{#edit}
::note[The reviewer's approval lands on the edited call.]{#approve}
:::
::::

The outcome depends on the SDK and on one setting. With no secret, the AI SDK accepted the edited history and ran the refund for Z-9. The OpenAI SDK did the same, and its documentation says it must: the restore does not authenticate the snapshot or the person submitting it [@openai-agents-human-in-the-loop]. With `experimental_toolApprovalSecret`{checked=row-19} set, the AI SDK rejected the edited call with an `InvalidToolApprovalSignatureError` before the tool ran. The SDK signs each approval request with an HMAC when it issues the request and verifies the signature when the approval comes back, and the signature binds the tool name, the call id and the input, so changing any one invalidates it [@ai-sdk-tool-approvals]. Its documentation asks for a random secret of at least 32 bytes, shared by every server instance that may handle a later request. The OpenAI and LangChain pages describe no such signature [@openai-agents-human-in-the-loop; @langchain-human-in-the-loop].

A safe SDK, or a safe server around an unsafe one, therefore does four things:

1. **It binds the decision to the exact call.** It signs the tool name, call id and input, as the AI SDK does, or it keeps the pending call on the server and accepts only a decision about a pending id from the client.
2. **It checks the call again when the run resumes.** The AI SDK validates the input against the tool's schema again, and a server-side policy that denies the call wins even over a correctly signed approval [@ai-sdk-tool-approvals].
3. **It learns who decided from the session, not from the request.** OpenAI's guide says to authenticate the reviewer with the application's session and "never obtain the authenticated identity from the approval request body" [@openai-agents-human-in-the-loop].
4. **It lets a decision count once.** OpenAI's guide tells the server to consume the pending request atomically, so a replayed submission cannot resume the same snapshot twice [@openai-agents-human-in-the-loop].

A reviewer may still change a call on purpose. LangChain's `edit`{checked=row-24} decision lets a person modify the arguments before the tool runs, and its documentation advises small changes, because a large one may make the model rethink its approach [@langchain-human-in-the-loop]. An edit like that is a decision the system records and the reviewer sees. The edit in [[lst:tamper-ai]] is a change nobody decided. Your code should be able to tell the two apart, and the signature is what lets it.

## Exercises

1. Placeholder.
