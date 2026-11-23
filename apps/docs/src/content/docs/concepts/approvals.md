---
title: Approvals
description: A gate can pause a tool call for a person, and a signed request lets any process resume it.
---

An approval stops a tool call until a person answers. You need this to learn how a pause works and why it can resume in another process.

## A gate decides each tool call

A `beforeToolCall` interceptor, called a gate, returns `allow`, `deny` or `ask` for each call. A `deny` reaches the model as an error that states the reason. An `ask` pauses the call. Without a gate, every registered tool is allowed.

## An ask ends the run with a signed request

When a gate asks, the run does not run the call and does not wait on a callback. It signs a pending request for the call, finishes the step's other calls and ends with the stop reason `awaiting_approval`. You store the context, show the person the request with the input it signs and pass their answer back later.

::figure[An approval pause, from the gate asking to the resumed run]{id="approval-pause" alt="A gate asks about a tool call, and the run ends with the stop reason awaiting_approval. After a person allows or denies the request, continueRun() resumes the run from the stored context."}

The signed request and the stored context are what you keep while the person decides. The signature covers the request's id, kind, call id, tool, input hash and policy version. A stored pause whose call, tool or input changed no longer verifies.

## A resolution resumes the run

A person answers each request with a resolution: `allow` or `deny` for an approval, or an answer for a question. `continueRun()` checks the answer against the signature before the call runs. A verified `allow` runs the call once, with the input the request signs. A request that fails its check runs nothing.

A request is meant to be answered once, but the SDK cannot see your other processes. Single use is your store's job: mark a request used before you resume it.

Next, [add a tool of your own](/guides/add-a-tool/).
