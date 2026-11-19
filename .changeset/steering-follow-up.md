---
"@buildanagent/sdk": minor
---

Breaking Changes: `AgentEvent` has a new `steer_applied` type, so an exhaustive `switch` over `event.type` stops compiling until it handles the new case. `SdkErrorCode` also gains `undelivered_message`.

New: a `Run` has `steer(message)` and `followUp(message)`. Each queues a user message and returns a `DeliveryReceipt` (`id`, `kind`, `message`, `stepIndex`) once the message is in the transcript. A steer is applied before the next model call, never inside a running model call or tool batch. A follow-up waits until the run would end, then extends it by one step. Each message also emits one `steer_applied` event.
