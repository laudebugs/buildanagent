---
title: Add a tool
description: Give an agent a tool that changes the world, and report what each call did.
---

You will add a refund tool to the order agent. It changes the world, so it says so and reports what each refund did. You need this for any tool that writes to a payment provider, a database or another system.

## Declare the effect

A tool that changes the world declares `effect: { kind: "write" }`. A tool without it counts as read-only, so it is safe to run again after a crash. The `businessKey` names the real operation, such as `refund:42`, so a retry is recognised as the same refund. This tool refunds an order and reports the outcome:

```ts file="packages/sdk/examples/refund-tool.ts" region="tool"
```

## Report an outcome

An outcome says which of five things happened: `applied`, `not_applied`, `compensated`, `partial` or `unknown`. It also says what the model should do next and whether a retry is safe. The model reads the outcome first, then your content.

Every kind except `applied` marks the result as an error, so the model treats a declined refund as a failure it can explain to the customer.

Next, [stop the agent before it runs a write](/guides/pause-for-approval/).
