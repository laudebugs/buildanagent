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

## Exercises

1. Placeholder.
