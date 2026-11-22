---
title: Pause for approval
description: Stop a tool call until a person approves it, then resume the run from a stored context.
---

You will make the refund agent ask a person before it moves money. The run ends with a signed request that you can store as JSON, and any process with the key can resume it. You need this when a write must not run unattended.

## Write the gate

The gate is an interceptor. It asks a person before any `refund_create` call and allows everything else:

```ts file="packages/sdk/examples/refund-approval.ts" region="gate"
```

## Store the pause

Start the run with a signer, which signs each request. When the result's stop reason is `awaiting_approval`, save `result.context` with your own store. It holds the pending requests and the input each one signs. Show the person that input, not the model's arguments, because the gate or a repair step may have changed them.

## Resume with the person's answer

Pass the stored context and one resolution for each request to `continueRun()`. This function resumes the refund run:

```ts file="packages/sdk/examples/refund-approval.ts" region="resume"
```

The SDK checks each resolution against its signature before the call runs. A resolution that fails its check runs nothing, and the call asks again.

Next, [test your agents offline](/testing/scripted-model/).
