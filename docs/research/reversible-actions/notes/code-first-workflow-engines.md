# Sagas and compensation in code-first workflow engines: Temporal, Azure Durable Functions / Durable Task, Dapr Workflow (as of November 2026)

*Working material for the [sagas report](../sagas.md); the report and its [fact-check log](../fact-check-sagas.md) supersede this note where they disagree.*

Running example throughout: an agent action that (1) updates an order, (2) refunds a payment, (3) sends an email. All three engines model this the same way at the core: each step is an activity, the workflow/orchestrator is ordinary code replayed from an event history, and compensation is plain `try/catch` code the author writes. None of the three ships a saga primitive in .NET or TypeScript; Temporal's Java SDK is the only SDK found with a built-in `Saga` class.

Fetch date for every source: 2026-11-18. Registry dates come from registry.npmjs.org and the NuGet registration API. "Inferred" marks my reasoning, not a source.

## Versions and status (pin candidates under the repo's one-week-old rule)

### Takeaway
All three engines had releases in the last month. Under the repo rule (release at least one week old), the newest TypeScript Temporal packages (1.26.0 and the 2.0.0 AI integrations, all published 2026-11-17) are too new; pin the prior releases.

### Cited Findings
- `@temporalio/workflow`: latest 1.26.0 published 2026-11-17; 1.25.0 published 2026-10-27; 1.24.0 2026-09-15 — [npm registry](https://registry.npmjs.org/@temporalio/workflow)
- `Temporalio` (.NET): 1.22.0 published 2026-11-10; 1.21.1 2026-10-30 — [NuGet registration](https://api.nuget.org/v3/registration5-gz-semver2/temporalio/index.json)
- `@temporalio/vercel-ai-sdk`: 1.0.0 published 2026-10-17; 2.0.0 published 2026-11-17. "The integration is versioned separately from the Temporal TypeScript SDK" — [npm registry](https://registry.npmjs.org/@temporalio/vercel-ai-sdk); [Temporal docs, AI SDK integration](https://docs.temporal.io/develop/typescript/ai-sdk)
- `@temporalio/openai-agents`: 1.24.0 published 2026-09-15; 2.0.0 published 2026-11-17 — [npm registry](https://registry.npmjs.org/@temporalio/openai-agents)
- .NET: `Temporalio.Extensions.MicrosoftAgentFramework` 0.0.1, described as "Temporal integration for Microsoft Agent Framework (Pre-release)" — [NuGet search](https://azuresearch-usnc.nuget.org/query?q=packageid:Temporalio.Extensions.MicrosoftAgentFramework). I found no .NET OpenAI Agents integration package.
- `Microsoft.Azure.Functions.Worker.Extensions.DurableTask` (Durable Functions, .NET isolated): 1.22.0 published 2026-11-10 — [NuGet registration](https://api.nuget.org/v3/registration5-gz-semver2/microsoft.azure.functions.worker.extensions.durabletask/index.json)
- Durable Task .NET SDK (`Microsoft.DurableTask.Client`, `.Worker`, `.Client.AzureManaged`): 1.28.0 published 2026-11-04 — [NuGet registration](https://api.nuget.org/v3/registration5-gz-semver2/microsoft.durabletask.client/index.json)
- `durable-functions` (npm, Azure Functions JS): latest 3.6.0 published 2026-10-14; `preview-v4` tag 4.0.0-beta.1 — [npm registry](https://registry.npmjs.org/durable-functions)
- `@microsoft/durabletask-js`: latest 0.4.0 published 2026-07-31 — [npm registry](https://registry.npmjs.org/@microsoft/durabletask-js)
- Durable Task SDK status table: .NET (`Microsoft.DurableTask.Worker.AzureManaged`, `...Client.AzureManaged`) GA; Python GA; Java GA; JavaScript/TypeScript (`@microsoft/durabletask-js`, `@microsoft/durabletask-js-azuremanaged`) **Preview**; Go Beta. "The JavaScript or TypeScript SDK is currently in preview. It isn't compatible with the Azure Durable Functions JavaScript SDK (durable-functions)." Requires Node.js 22+ — [Durable Task SDKs overview](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-task-scheduler/durable-task-overview)
- .NET in-process model: "Support will end for the in-process model on November 10, 2026. We highly recommend that you migrate your apps to the isolated worker model" — [Durable Functions .NET isolated overview](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-dotnet-isolated-overview). (As of 2026-11-18 that date has passed.)
- Durable Task Scheduler "is the recommended storage provider for Durable Functions and the Durable Task SDKs"; it is "a purpose-built backend-as-a-service", runs "as a separate resource from your app", and has two billing SKUs, Dedicated and Consumption — [Durable Task Scheduler](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-task-scheduler/durable-task-scheduler)
- Dapr runtime: 1.19.1 released Oct 30th 2026, "Supported (current)", with SDKs Java 1.19.0, Go 1.16.0, Python 1.19.0, .NET 1.19.0, JS 3.19.0; 1.19.0 released Oct 22nd 2026 — [Dapr supported releases](https://docs.dapr.io/operations/support/support-release-policy/)
- `Dapr.Workflow` (NuGet): 1.19.1 published 2026-11-10 (newer than the 1.19.0 .NET SDK the support table lists); `@dapr/dapr` 3.19.0 published 2026-10-22 — [NuGet registration](https://api.nuget.org/v3/registration5-gz-semver2/dapr.workflow/index.json); [npm registry](https://registry.npmjs.org/@dapr/dapr)
- Dapr Workflow became stable in Dapr 1.15: "Dapr Workflow (stable) ... The ability to author and run workflows is now stable. This includes the Dapr runtime along with the Dapr .NET, Java, Python, Go and Javascript" SDKs — [Dapr blog, v1.15 release (2025-02-27)](https://blog.dapr.io/posts/2025/02/27/dapr-v1.15-is-now-available/)
- Dapr 1.19 still has preview workflow features, e.g. "The WorkflowsFastPath preview feature" — [Dapr workflow overview](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-overview/)

### Inferences
- Pin candidates as of 2026-11-18 under the one-week rule: `@temporalio/workflow` 1.25.0; `Temporalio` 1.22.0 (8 days old); `@temporalio/vercel-ai-sdk` 1.0.0; `@temporalio/openai-agents` 1.24.0; `Microsoft.Azure.Functions.Worker.Extensions.DurableTask` 1.22.0; `Microsoft.DurableTask.*` 1.28.0; `durable-functions` 3.6.0; `@microsoft/durabletask-js` 0.4.0 (preview); Dapr runtime 1.19.1, `Dapr.Workflow` 1.19.1, `@dapr/dapr` 3.19.0.

### Gaps
- Release notes for each version were not read; no claim is made about saga-relevant changes between versions.
- Durable Task Scheduler GA date was not found on the pages read (the page does not say "preview"; I did not find an explicit GA statement).

## Temporal (.NET `Temporalio` and TypeScript `@temporalio/workflow`)

### Takeaway
In both SDKs a saga is a hand-written list of compensation closures in workflow code, run in reverse inside a `catch`, then the original error is rethrown so the Workflow Execution ends as Failed. Activity retries (unlimited by default) and non-retryable `ApplicationFailure`s decide when a step "really" fails; Updates with validators and `condition`/`WaitConditionAsync` give a durable approval gate.

### Cited Findings

**No built-in saga in .NET/TS**
- "If you're writing Java, you can leverage Temporal's Saga library ... If you're working with TypeScript, Python, or Go, you'll need to keep track of the compensations yourself ... keep track of a list of compensating functions, and then execute them when there's a failure." (Blog, May 2023, Emily Fortuna; .NET is not mentioned) — [Temporal blog, Saga compensating actions](https://temporal.io/blog/compensating-actions-part-of-a-complete-breakfast-with-sagas)
- Registration order advice: the blog labels "register compensation after the step" as `// DON'T DO THIS`, because a step can have partially executed (e.g. timed out) before failing; register the compensation *before* the step and write it to tolerate the step not having happened (`putBowlAwayIfPresent`) — [Temporal blog](https://temporal.io/blog/compensating-actions-part-of-a-complete-breakfast-with-sagas)
- Java `Saga` class supports `setParallelCompensation(...)`; the Python helper runs compensations in `reversed(...)` order, or with `asyncio.gather` when parallel — [Temporal blog](https://temporal.io/blog/compensating-actions-part-of-a-complete-breakfast-with-sagas)

**.NET saga sample** (`temporalio/samples-dotnet`, `src/Saga/SagaWorkflow.cs`) — [source](https://raw.githubusercontent.com/temporalio/samples-dotnet/main/src/Saga/SagaWorkflow.cs)
- Compensations are `List<Func<Task>>`; each is added **before** its forward activity; on `catch (Exception)` it calls `CompensateAsync`, which does `compensations.Reverse()` and awaits each, swallowing and logging compensation errors, then `throw;`:
  ```csharp
  try {
      compensations.Add(async () => await Workflow.ExecuteActivityAsync(
          () => Activities.WithdrawCompensation(transfer), options));
      await Workflow.ExecuteActivityAsync(() => Activities.Withdraw(transfer), options);
      // ... Deposit + DepositCompensation, then StepWithError
  } catch (Exception) {
      await CompensateAsync(compensations);   // Reverse() then await each, swallow errors
      throw;
  }
  ```
- Activity options: `StartToCloseTimeout = TimeSpan.FromSeconds(90)`. The failing step throws `new ApplicationFailureException("Simulated failure", nonRetryable: true)` so it is not retried — [Activities.cs](https://raw.githubusercontent.com/temporalio/samples-dotnet/main/src/Saga/Activities.cs)

**TypeScript saga sample** (`temporalio/samples-typescript`, `saga/src/workflows.ts`) — [source](https://raw.githubusercontent.com/temporalio/samples-typescript/main/saga/src/workflows.ts)
- Uses `compensations.unshift({ message, fn })` **after** each successful step (so the array is already in reverse order), and a fatal first step (`createAccount`) fails fast with no compensation. On error: `await compensate(compensations); throw err;`. `compensate` loops sequentially, catching and logging ("swallow errors") each compensation failure. Activity options `startToCloseTimeout: '2s', scheduleToCloseTimeout: '3s'` (default) and `'4s'/'8s'` (long-running).
  ```ts
  try {
    await addAddress({ accountId, address });
    compensations.unshift({ message: '...', fn: () => clearPostalAddresses({ accountId }) });
    await addClient({ accountId, clientEmail });
    compensations.unshift({ message: '...', fn: () => removeClient({ accountId }) });
    await addBankAccount({ ... });
    compensations.unshift({ message: '...', fn: () => disconnectBankAccounts({ accountId }) });
  } catch (err) {
    if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure) log.error(err.cause.message);
    await compensate(compensations);
    throw err;
  }
  ```

**Retries, non-retryable errors, timeouts**
- Default Activity Retry Policy: initial interval 1 s, backoff coefficient 2.0, maximum interval 100 s, maximum attempts 0 = unlimited, non-retryable errors none. Workflow Executions do not retry by default — [Temporal docs, Retry Policies](https://docs.temporal.io/encyclopedia/retry-policies)
- "An Activity Failure will never directly cause a Workflow Failure ... Activities will not actually return a failure to your Workflow until [the retry/timeout] condition or another non-retryable condition is met. At this point ... you could implement a Saga Pattern that uses try and catch blocks to 'unwind'" — [TS failure detection](https://docs.temporal.io/develop/typescript/failure-detection)
- TS: `ApplicationFailure.create({ message, nonRetryable: true })`; "You can alternately specify a list of errors that are non-retryable in your Activity Retry Policy" — [TS failure detection](https://docs.temporal.io/develop/typescript/failure-detection). .NET: `throw new ApplicationFailureException("Invalid department", nonRetryable: true);` — [.NET failure detection](https://docs.temporal.io/develop/dotnet/failure-detection)
- TS workflow errors: "any exceptions that are raised other than an explicit Temporal ApplicationFailure will only fail that particular Workflow Task and be retried ... treated as bugs"; to make other types fail the execution use `failureExceptionTypes` (`setWorkflowOptions()`) or the `workflowFailureErrorTypes` Worker option, "Both options are experimental." The docs' "fail deliberately" example rethrows the caught `ActivityFailure` — [TS failure detection](https://docs.temporal.io/develop/typescript/failure-detection)
- Temporal docs "generally do not recommend setting Workflow Timeouts" — [TS failure detection](https://docs.temporal.io/develop/typescript/failure-detection)

**Cancellation**
- TS `CancellationScope.nonCancellable(fn)`: "Cancellation does not propagate to children"; the docs' cleanup example: "Cleanup logic must be in a nonCancellable scope. If we'd run cleanup outside of a nonCancellable scope it would've been cancelled before being started because the Workflow's root scope is cancelled." `await CancellationScope.nonCancellable(() => cleanup(url)); throw err;` Also `withTimeout(timeoutMs, fn)` and `cancelRequested` — [TS cancellation scopes](https://docs.temporal.io/develop/typescript/workflows/cancellation-scopes.md)
- Activity cancellation requires heartbeats and a heartbeat timeout. `cancellationType`: `TRY_CANCEL` (default) fails the activity call immediately "so Workflow code that continues, for example to run compensation or to retry, can overlap with an Activity that is still executing"; `WAIT_CANCELLATION_COMPLETED` keeps the call pending until the activity acknowledges; `ABANDON` doesn't request cancellation — [TS cancellation](https://docs.temporal.io/develop/typescript/cancellation)
- .NET cancellation page exists — [.NET cancellation](https://docs.temporal.io/develop/dotnet/cancellation) (fetched but not analyzed in detail; see Gaps)

**Idempotency**
- "Temporal recommends that Activities be idempotent", citing payment processing ("must charge the customer only once") — [Activity definition](https://docs.temporal.io/activity-definition.md)

**Human approval: Signals, Updates, wait conditions**
- Signal: "The handler cannot return a value. The response is sent immediately from the server, without waiting for the Workflow to process the Signal." Doc example: `wf.setHandler(approve, (input) => { approvedForRelease = true; approverName = input.name; }); ... await wf.condition(() => approvedForRelease);` — [TS message passing](https://docs.temporal.io/develop/typescript/message-passing)
- Update: "a trackable synchronous request ... The sender must wait until the Worker accepts or rejects the Update." Validators: "Use validators to reject an Update before it is written to History"; TS validator "must be a non-async function ... returns void"; "To reject an Update, throw an error of any type in the validator"; on rejection `WorkflowExecutionUpdateAccepted` is not added to history — [TS message passing](https://docs.temporal.io/develop/typescript/message-passing)
- .NET: validator via `[WorkflowUpdateValidator(nameof(SetCurrentLanguageAsync))]`, "must be a void type and accept the same argument types as the handler"; "When a Validator raises an error, the Update is rejected, the Update is not run"; `Workflow.WaitConditionAsync`; client `StartUpdateAsync(..., new(waitForStage: WorkflowUpdateStage.Accepted))` returns once accepted — [.NET message passing](https://docs.temporal.io/develop/dotnet/message-passing)
- Async handlers can use "Activities, Child Workflows, durable `workflow.sleep` Timers, `workflow.condition` conditions" — [TS message passing](https://docs.temporal.io/develop/typescript/message-passing)

**Determinism**
- "In the Temporal TypeScript SDK, Workflows run in a deterministic sandboxed environment ... side effects and access to external state must be done through Activities because Activity outputs are recorded in the Event History" — [TS workflow basics](https://docs.temporal.io/develop/typescript/workflows/basics.md)

**AI-agent integrations**
- Vercel AI SDK plugin (`AiSdkPlugin` from `@temporalio/vercel-ai-sdk`; workflow helpers `temporalProvider`, `TemporalMCPClient` from `@temporalio/vercel-ai-sdk/workflow`): "when you call methods in the AI SDK such as generateText() or streamText(), the plugin wraps those calls in Activities behind the scenes." But "when the model calls [tools], they execute in the Workflow. Since tool functions run in Workflow context, they must follow Workflow rules ... must call Activities or Child Workflows to perform non-deterministic operations like API calls" — [Temporal docs, AI SDK](https://docs.temporal.io/develop/typescript/ai-sdk)
- TS OpenAI Agents integration: "Any tool that does I/O must run outside the Workflow sandbox, usually through an Activity or Nexus Operation. ... Use `activityAsTool` for HTTP calls, database access ... The tool name must match a registered Activity." (`import { activityAsTool } from '@temporalio/openai-agents/workflow'`) — [@temporalio/openai-agents README on npm](https://registry.npmjs.org/@temporalio/openai-agents)
- This matches the repo's R1 correction: model calls become activities automatically, tools do not — [docs/research/agent-sdk/fact-check.md, R1](../../agent-sdk/fact-check.md#re-verification-against-primary-sources-r1)

### Inferences
- The two official samples disagree on registration order: .NET registers each compensation before its step (the blog's recommended order, compensations must tolerate "step never happened"); TS registers after success (the blog's "DON'T DO THIS" order), which skips compensation for a step that timed out after partially applying. For "refund payment", the before-step order plus an idempotency key is the safer pattern.
- Both samples rethrow after compensating, so the caller sees Workflow status Failed with the original ActivityFailure; "failed and compensated" vs "failed, compensation incomplete" is not distinguished unless the author returns a result object or throws a distinct `ApplicationFailure` type. Compensation errors are swallowed in both samples.
- Order/refund/email sketch: register `revertOrder` → `updateOrder`; register `reverseRefund`(?) → `refundPayment`; `sendEmail` last (emails cannot be compensated, so put the irreversible step last, or send a correction email as the "compensation"). This is my mapping; no Temporal doc uses this example.
- Because agent tools run in workflow context, a saga around tool calls requires each side-effecting tool to be an activity (via `activityAsTool` or a tool that calls `proxyActivities`), otherwise there is nothing durable to compensate.

### Gaps
- `workflow.condition(fn, timeout)` returning `boolean` (timeout overload) was not confirmed from a page fetched in this session; check the TS API reference before citing.
- .NET `CancellationToken`/`Workflow.CancellationToken` + detached cleanup pattern (the .NET equivalent of `nonCancellable`) was not extracted; read [.NET cancellation](https://docs.temporal.io/develop/dotnet/cancellation).
- No Temporal sample found using the order/refund/email example.

## Azure Durable Functions and the Durable Task SDKs / Durable Task Scheduler

### Takeaway
Compensation is documented as a `try/catch` around `CallActivityAsync` that calls the reverse activity; Microsoft's samples show a single-step refund, not a reversed list. Retry policies are per-call `TaskOptions`; human approval is `WaitForExternalEvent` raced against a durable timer with `Task.WhenAny`. The SDK sample returns a string after compensating, so the instance ends as Completed, not Failed.

### Cited Findings
- "You implement Durable Functions orchestrations in code, so use your language's built-in error handling features. Error handling and compensation don't require new concepts" — [Durable Functions error handling](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling?tabs=csharp-isolated)
- Isolated worker: "unhandled exceptions surface as `TaskFailedException`"; inspect `FailureDetails`. Durable Task SDKs use the same type — [error handling](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling?tabs=csharp-isolated)
- Durable Task SDK (.NET) compensation sample:
  ```csharp
  [DurableTask(nameof(TransferFundsOrchestration))]
  public class TransferFundsOrchestration : TaskOrchestrator<TransferOperation, string> {
    public override async Task<string> RunAsync(TaskOrchestrationContext context, TransferOperation transfer) {
      await context.CallActivityAsync(nameof(DebitAccountActivity), new AccountOperation { ... });
      try {
        await context.CallActivityAsync(nameof(CreditAccountActivity), new AccountOperation { ... });
      } catch (TaskFailedException ex) {
        var details = ex.FailureDetails;
        // Compensate by refunding the source account
        await context.CallActivityAsync(nameof(CreditAccountActivity), new AccountOperation { Account = transfer.SourceAccount, ... });
        return $"Transfer failed: {details.ErrorMessage}. Compensation completed.";
      }
      return "Transfer completed successfully";
    }
  }
  ```
  — [error handling, Durable Task SDKs tab](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling?tabs=csharp-isolated)
- Durable Task JS SDK compensation sample uses generator orchestrators: `const transferFundsOrchestrator: TOrchestrator = async function* (ctx: OrchestrationContext) { yield ctx.callActivity(debitAccount, ...); try { yield ctx.callActivity(creditAccount, ...) } catch (error) { yield ctx.callActivity(creditAccount, /* refund source */); return "Transfer failed. Compensation completed."; } ... }` (`import { OrchestrationContext, TOrchestrator } from "@microsoft/durabletask-js"`) — [error handling](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling?tabs=csharp-isolated)
- Parallel calls: in JS, `context.df.Task.all` — "the first failure causes the task to complete with an error" — [error handling](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling?tabs=csharp-isolated)
- Retries: isolated `TaskOptions.FromRetryPolicy(new RetryPolicy(maxNumberOfAttempts: 3, firstRetryInterval: TimeSpan.FromSeconds(5)))`; JS `new df.RetryOptions(5000, 3)` + `context.df.callActivityWithRetry(...)`. Options: first retry interval, backoff coefficient ("Defaults to 1"), max retry interval, retry timeout ("By default, retries continue indefinitely"). Durable Task SDK retry methods "are useful for activities that read data from web services or perform idempotent writes"; Go note: "Activities must be idempotent" — [error handling](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling?tabs=csharp-isolated)
- Custom retry handlers only in .NET and Java (`TaskOptions.FromRetryHandler(retryContext => ...)`); "JavaScript doesn't support custom retry handlers in Durable Functions. Implement retry logic ... by using loops, exception handling, and timers" — [error handling](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling?tabs=csharp-isolated)
- Human interaction (isolated, `[Function("E4_SmsPhoneVerification")]`): `DateTime expiration = context.CurrentUtcDateTime.AddSeconds(90); Task timeoutTask = context.CreateTimer(expiration, timeoutCts.Token); ... Task<int> challengeResponseTask = context.WaitForExternalEvent<int>("SmsChallengeResponse"); Task winner = await Task.WhenAny(challengeResponseTask, timeoutTask);` and "All pending timers must complete or be canceled before the function exits" (`timeoutCts.Cancel()`). "This orchestrator is deterministic because CurrentUtcDateTime returns the same value at the same point in every replay" — [phone verification sample](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-phone-verification?tabs=csharp-isolated)
- Durability of the wait: "The 'wait-for-external-event' API waits indefinitely for some input. You can safely unload the function app while waiting ... If your function app uses the Consumption Plan, no billing charges are incurred while an orchestrator function is awaiting an external event task, no matter how long it waits." — [external events](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-external-events)
- "External events have an at-least-once delivery guarantee ... might receive duplicates ... We recommend that external events contain a unique ID" (MSSQL provider is transactional, Azure Storage is not); "Use timeouts to avoid indefinite waits ... race a durable timer against the external event" — [external events](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-external-events)
- Determinism: "Orchestrator functions use event sourcing ... The replay behavior of orchestrator code creates constraints"; "Time-based APIs are nondeterministic and should never be used"; "For .NET isolated orchestrator functions, use the `TaskOrchestrationContext.CurrentUtcDateTime` property" — [code constraints](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-code-constraints)
- Caller-visible status: `RuntimeStatus` values Pending, Running, Completed ("completed normally"), ContinuedAsNew, Failed ("failed with an error"), Terminated; output holds the return value, or failure details if failed — [instance management](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-instance-management)
- Durable Task SDKs: "Wait for external events (human approvals, webhooks, timers) without consuming compute"; run on any compute; connect to Durable Task Scheduler — [Durable Task SDKs overview](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-task-scheduler/durable-task-overview)

### Inferences
- Compensation in reverse order is not provided; for three steps the author writes the reversed list (as in the Temporal/Dapr pattern) or nested try/catch. Microsoft's samples only show one compensating call.
- The SDK sample returns a success-shaped string after compensating, so `RuntimeStatus` is Completed and the caller must parse the output to learn the saga rolled back. To surface Failed, rethrow after compensating (`throw;`). This is a design choice the docs leave to the author.
- Docs inconsistency (observed, worth a fact-check row if cited): the error-handling page's "Isolated worker model" tab shows `[FunctionName("TransferFunds")]` with `TaskOrchestrationContext`, while the isolated phone-verification sample uses `[Function(...)]`. `[FunctionName]` is the in-process attribute (my understanding, not verified on a page this session).
- For the agent example: `WaitForExternalEvent<Approval>("Approve")` + `CreateTimer` + `WhenAny` before `RefundPayment`, with a dedupe ID in the event payload given at-least-once delivery.

### Gaps
- No Microsoft doc found with a multi-step saga compensation list or the order/refund/email example.
- Durable Task Scheduler GA date and pricing were not extracted.
- Behavior of orchestrator cancellation/termination on compensation (terminate does not run catch blocks) was not checked on a page.

## Dapr Workflow (.NET `Dapr.Workflow`, JS `@dapr/dapr`)

### Takeaway
Dapr Workflow (stable since 1.15) is built on the same Durable Task model: `TaskFailedException` surfaces activity failure, and the docs' compensation pattern records compensation names in a list and runs them in reverse in the `catch`. The documented compensation example completes the workflow with a "failed, compensation applied" message rather than failing it. Approvals use `WaitForExternalEventAsync` with a timeout; events that arrive early are saved in history.

### Cited Findings
- "Dapr Workflow provides support for the compensation pattern, allowing you to register compensation activities for each step and execute them in reverse order when needed." Example: reserve inventory, process payment, ship order; on error cancel shipment, refund payment, release inventory — [Dapr workflow patterns, Compensation](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-patterns/)
- The compensation code sample on that page is **Java only**: `List<String> compensations`; `compensations.add("ReleaseInventory")` after each successful step; `catch (TaskFailedException e) { Collections.reverse(compensations); for (...) { try { switch ... ctx.callActivity(...).await(); } catch (TaskFailedException ex) { log } } ctx.complete("Order processing failed, compensation applied"); }`, then "Step 4: Send confirmation" and `ctx.complete("Order processed successfully: " + orderId)` — [Dapr workflow patterns](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-patterns/)
- "To run this pattern, try the resiliency and compensation tutorial, which also shows retry policies, in Python, .NET or Java." — [Dapr workflow patterns](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-patterns/)
- .NET retry + compensation snippet:
  ```csharp
  var retryOptions = new WorkflowTaskOptions {
      RetryPolicy = new WorkflowRetryPolicy(
          firstRetryInterval: TimeSpan.FromMinutes(1), backoffCoefficient: 2.0,
          maxRetryInterval: TimeSpan.FromHours(1), maxNumberOfAttempts: 10),
  };
  try { var result1 = await context.CallActivityAsync<string>("Step1", wfInput, retryOptions); ... }
  catch (TaskFailedException) { // Retries expired - apply custom compensation logic
      await context.CallActivityAsync<long[]>("MyCompensation", options: retryOptions);
      throw;
  }
  ```
  — [Dapr workflow patterns](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-patterns/)
- Retry policies "are durable and maintain their state across application restarts" (unlike Dapr Resiliency YAML policies); "Retries are internally implemented using durable timers"; "Using workflow retry policies and resiliency policies together can result in unexpected behavior"; parameters: first retry interval, backoff coefficient, maximum retry interval, retry timeout — [Dapr workflow features and concepts](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/)
- Human approval (.NET): `ApprovalResult approvalResult = await context.WaitForExternalEventAsync<ApprovalResult>(eventName: "ManagerApproval", timeout: TimeSpan.FromDays(3));` with `catch (TaskCanceledException) { // An approval timeout results in automatic order cancellation; return new OrderResult(Processed: false); }`. JS: `ctx.waitForExternalEvent("approval_received")`, `ctx.createTimer(24 * 60 * 60)`, `ctx.whenAny(tasks)`. The pattern text: "If the approval isn't received within the specified time, the workflow resumes and performs some compensation logic, such as canceling the order." — [Dapr workflow patterns, External system interaction](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-patterns/)
- External events: multiple events of the same name are dispatched FIFO; "If a workflow receives an external event signal but has not yet created a 'wait for external event' task, the event will be saved into the workflow's history and consumed immediately after the workflow requests the event." — [features and concepts](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/)
- Replay/determinism: "When a workflow 'awaits' a scheduled task, it unloads itself from memory until the task completes ... runs again from the beginning ... Returns the stored result"; "requires that workflow function code be deterministic"; retry-policy actions are saved into history so don't change them for running workflows — [features and concepts](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/)
- Instance IDs: only one instance with a given ID at a time; a fixed ID makes a racing second start fail with `AlreadyExists`; purge or retention to reuse — [features and concepts](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/)
- Status filter example `dapr workflow list --app-id myapp --filter-status RUNNING` — [features and concepts](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/)

### Inferences
- The Java compensation sample calls `ctx.complete(...)` inside `catch` and then continues to "Step 4: Send confirmation"; whether `ctx.complete` halts execution in the Java SDK was not checked, so the sample may fall through. Treat as a possible docs bug to verify before citing.
- Dapr's documented saga ends the instance as COMPLETED with a message, whereas its .NET retry snippet rethrows (`throw;`), ending it FAILED. The docs show both; the caller-visible outcome is the author's choice, as in Durable Task.
- Dapr's `WaitForExternalEventAsync(name, timeout)` throws `TaskCanceledException` on timeout, a different shape from Durable Functions' `WhenAny` race and Temporal's `condition`.

### Gaps
- The .NET and JS versions of the "resiliency and compensation tutorial" (quickstarts repo) were not fetched; no .NET/JS multi-step compensation list from Dapr was read.
- Dapr workflow status enum names (COMPLETED/FAILED/TERMINATED) were not confirmed on a page beyond `RUNNING`.

## Cross-engine comparison: failure trigger, order, caller status, determinism, approval durability

### Takeaway
All three engines treat compensation as user code: an activity failure (after retries are exhausted or on a non-retryable error) surfaces as an exception in replayed workflow code; reverse order is the author's loop; whether the caller sees "failed" or "completed (compensated)" depends on whether the author rethrows. Approval waits are durable history events in all three.

### Cited Findings
- Temporal: failure surfaces after retry policy/timeouts or non-retryable error — [TS failure detection](https://docs.temporal.io/develop/typescript/failure-detection); samples rethrow → failed — [.NET sample](https://raw.githubusercontent.com/temporalio/samples-dotnet/main/src/Saga/SagaWorkflow.cs), [TS sample](https://raw.githubusercontent.com/temporalio/samples-typescript/main/saga/src/workflows.ts)
- Durable Task: `TaskFailedException` → catch → compensate → return string → Completed — [error handling](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling?tabs=csharp-isolated); statuses — [instance management](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-instance-management)
- Dapr: `TaskFailedException` → reverse list → `ctx.complete("...compensation applied")` (Java) or `throw;` (.NET retry snippet) — [Dapr patterns](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-patterns/)
- Reverse order: Temporal .NET `compensations.Reverse()`, TS `unshift`; Dapr Java `Collections.reverse(compensations)`; Durable: single compensation only in docs — sources above.
- Approval durability: Temporal Signals/Updates recorded in history (`WorkflowExecutionUpdateAccepted`) — [TS message passing](https://docs.temporal.io/develop/typescript/message-passing); Durable: app can be unloaded, no Consumption billing while waiting — [external events](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-external-events); Dapr: early events saved to history — [features and concepts](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/)

| Concern | Temporal (.NET / TS) | Durable Functions / Durable Task | Dapr Workflow |
|---|---|---|---|
| Saga primitive | None (Java only has `Saga`) | None | None (pattern doc only) |
| Failure surfaced as | `ActivityFailure` (TS) / exception (.NET) | `TaskFailedException` | `TaskFailedException` |
| Default activity retry | Unlimited, 1 s → ×2 → 100 s cap | None unless `TaskOptions` given (inferred from per-call opt-in) | None unless `WorkflowTaskOptions` given (inferred) |
| Non-retryable signal | `ApplicationFailure nonRetryable` / policy list | .NET/Java custom retry handler | not found |
| Reverse order | Author loop | Author code | Author loop (`Collections.reverse`) |
| Doc sample's final status | Failed (rethrow) | Completed (returns string) | Completed (Java) / Failed (.NET `throw;`) |
| Approval API | Signal/Update + `condition` / `WaitConditionAsync`; Update validators | `WaitForExternalEvent` + `CreateTimer` + `WhenAny` | `WaitForExternalEventAsync(name, timeout)` |
| Duplicate events | Update validator can reject before history | at-least-once; dedupe by ID | FIFO; buffered in history |

### Inferences
- An agent harness that wants "failed and compensated" as a first-class outcome must define it itself (a typed result or a distinct failure type), in every engine.
- The irreversible step (send email) should go last, or its compensation should be a follow-up correction email; no engine helps here.
- The "default retry" rows for Durable and Dapr are inferences from the docs showing retry as an opt-in per-call option; I found no page stating "no retries by default" for either.

### Gaps
- None of the three vendors' docs use the order/refund/email example; code sketches above are their closest samples.
- Parallel compensation is documented only for Temporal Java/Python (blog), not for .NET/TS or the other engines.
