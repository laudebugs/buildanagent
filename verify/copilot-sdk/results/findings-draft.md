# S8a findings: GitHub Copilot SDK 1.0.31 (runtime 1.0.109), 2026-11-18

Mirror: `docs/reference/copilot-sdk/source/` (github/copilot-sdk tag v1.0.31, commit 15de061). Harness: `verify/copilot-sdk/`. Each finding says whether the docs, the SDK (types) or the runtime is wrong, and which check shows it. F1–F3 were also checked against 1.0.34 (latest on 2026-11-18): still present.

## Docs errors

**F1. A session without `onPermissionRequest` denies tool calls; the docs say they are left pending.** (docs wrong, behavior fails closed)
- Docs: `nodejs/README.md:404` and `:1957` ("When omitted, permission requests are emitted as events and left pending for the consumer to resolve with the pending permission RPC"), and the `SessionConfigBase.onPermissionRequest` JSDoc in `dist/types.d.ts:2578`.
- Behavior: the SDK sends `requestPermission: !!config.onPermissionRequest` (`dist/client.js:1711`), and the runtime then denies at once with "Permission denied and could not request permission from user…". No `permission.requested` event is emitted, the handler doesn't run, nothing is pending, the turn finishes.
- Verified by `examples/03-permission-deny.ts` (second half). To leave a request pending for an out-of-band human, return `{ kind: "no-result" }` from a handler (shown in `examples/09-triage-agent.ts`).

**F2. The hooks pages import types the package root doesn't export, one of which doesn't exist.** (docs wrong, or an SDK export gap)
- `docs/hooks/pre-tool-use.md:16`, `post-tool-use.md:21`, `session-lifecycle.md:20`, `user-prompt-submitted.md:16`, `error-handling.md:16` import `PreToolUseHookInput`/`Output`, `PostToolUseHookInput`/`Output`, `SessionStartHookInput`/`Output`, `UserPromptSubmittedHookInput`/`Output`, `ErrorOccurredHookInput`/`Output` and `HookInvocation` from `@github/copilot-sdk`.
- `dist/index.d.ts` exports none of the ten (they are declared in `dist/types.d.ts` but not re-exported), and `HookInvocation` exists nowhere; the handlers' second argument is typed inline as `{ sessionId: string }`. Five blocks, 15 errors (TS2305/TS2724). All five are blocks marked `<!-- docs-validate: hidden -->`.
- Shown by `results/typecheck-docs.json` (api-mismatch), `results/factcheck-api.json` (`exports.notInPackage`, 11 names), `results/mismatch-causes.json` (`hook-types-not-exported`).

**F3. `docs/features/usage-and-billing.md` calls `client.rpc` on a client it never started.** (docs wrong)
- Blocks at `usage-and-billing.md:920` (`client.rpc.models.list`) and `:1192` (`client.rpc.account.getQuota`) are complete and type-clean, but `new CopilotClient()` followed by `client.rpc…` throws "Client is not connected. Call start() first." (`dist/client.js:471–474`). `createSession` starts the client on demand; `rpc`, `listSessions` and the other client methods don't.
- Shown by `results/run-docs.json` (`docs__features__usage-and-billing__09`, `__11`: error, reviewed). Related: `examples/06-resume-session.ts` asserts `listSessions()` before `start()` throws "Client not connected".

**F4. Hook examples return `null`, which the handler types forbid; the runtime accepts it.** (docs and types disagree; runtime matches the docs)
- 50 `return null` statements across `docs/hooks/*.md` and `docs/features/hooks.md`. Every `*Handler` type in `dist/types.d.ts` returns `Output | void` (for example `PreToolUseHandler`, line 1373). In `strict` TypeScript this is TS2322 in `docs/hooks/hooks-overview.md:67` and, once the missing `client` is declared, 36 more blocks: 51 errors in 37 files (`results/mismatch-causes.json`, `hook-returns-null`).
- At runtime `null` behaves like no output: `examples/08-hooks.ts` returns `null` from both hooks and the turn completes normally. Either the types should allow `null` or the docs should `return;`.

**F5. `docs/hooks/post-tool-use.md` reads `ToolResultObject` fields that don't exist.** (docs wrong per the types; not checked at runtime)
- `post-tool-use.md:444` reads `input.toolResult.exitCode`, `:460` writes `modifiedResult: { error, stack }` and reads `.stack`, `:517` reads `.items`. `ToolResultObject` (`dist/types.d.ts:534`) has `textResultForLlm`, `binaryResultsForLlm`, `resultType`, `error`, `sessionLog`, `toolTelemetry`, `toolReferences` only. 4 errors in 3 blocks (`tool-result-field-not-in-type`). Not run: it would need the built-in `bash` tool, which the mock never calls.

## SDK (types) gaps

**F6. The runtime emits ten `model.*` event types that `SessionEvent` doesn't include.** (SDK types incomplete)
- A plain `sendAndWait` turn delivers `model.turn_started`, `model.log`, `model.call_start`, `model.model_call_started`, `model.model_call_success`, `model.message`, `model.response`, `model.call_final_result`, `model.turn_ended` and `model.messages_snapshot` to `session.on(handler)`; none appears in `dist/generated/session-events.d.ts` (191 typed event types). A `switch (event.type)` that assumes exhaustiveness is wrong at runtime.
- Shown by `examples/01-hello-session.ts` (prints `observed-events`) and `results/factcheck-api.json` (`events.emittedButUntyped`). `model.call_finished` also arrives but is typed (`ModelCallFinishedEvent`).

**F7. The README documents a fraction of the configuration surface.** (docs gap)
- `createSession` config: 22 of 98 `SessionConfig`/`SessionConfigBase` fields; 34 are mentioned on no page at all, including `toolSearch`, `largeOutput`, `onEvent`, `onExitPlanModeRequest`, `onMcpAuthRequest`, `skipCustomInstructions` and `managedSettings`. `availableTools`/`excludedTools` are documented on other pages, not in the README list.
- `CopilotClientOptions`: 6 of 21 fields undocumented (`clientInfo`, `entra`, `network`, `requestHandler`, `onGitHubTelemetry`, `builtinPluginDirectories`; `clientInfo` and `network` have their own sections or pages). `ProviderConfig`: 7 of 15 fields missing from the byok.md table (`headers`, `modelId`, `wireModel`, `transport`, `maxPromptTokens`, `maxOutputTokens`, `modelProvider`). Permission result kind `approve-read-only-for-session` and request kinds `workflow`, `extension-*` are missing from the README lists.
- Shown by `results/factcheck-api.json`.

## Surprising defaults (documented, but they matter for an embedding)

**F8. A default client and session is a full coding agent with host access.** `mode` defaults to `"copilot-cli"`, whose JSDoc warns that its tools "can access the host OS environment" (`dist/types.d.ts:236–246`); the model is offered 19 built-ins including `bash`, `view`, `create`, `edit`, `web_fetch` and `sql` (`examples/01-hello-session.ts`, `04-restrict-builtins.ts`). The Quick Start pairs this with `onPermissionRequest: approveAll`, which approves shell commands. `env` defaults to inheriting `process.env` (README "Options", `dist/client.js:634`), and `useLoggedInUser` defaults to true. Safe embedding needs `availableTools` (verified: `ToolSet().addCustom("*")` removes every built-in; `excludedTools` wins over `availableTools`), or `mode: "empty"`, which refuses any session without `availableTools` (verified in `04-restrict-builtins.ts`).

**F9. Custom tools are not persisted across resume.** Resuming without passing `tools` again offers the model none of them (`examples/06-resume-session.ts`). `docs/features/session-persistence.md:7` says the runtime keeps "tool state", and `:314` that resume can "update tool configurations"; neither page nor the README's `resumeSession` section says tool definitions must be passed again (other options, such as `skillProvider` and `autopilot`, are marked "not persisted"). Docs gap.

## Harness notes (not findings)

- The Copilot CLI's BYOK environment variables (`COPILOT_PROVIDER_BASE_URL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_OFFLINE`, found in `runtime.node`) don't configure SDK sessions: with them set and no `provider`, `createSession` fails with "No GitHub OAuth token or Copilot HMAC key provided". The harness injects `provider` per session instead.
- `docs/features/plugin-directories.md:483` fails with "Standalone server does not support session effect 'managed_plugin_retry'": `plugins.retryManaged` needs enterprise managed settings. Environment, not a docs error.
- The SDK bundles the runtime (`copilotCliVersion: 1.0.109`, `copilotRuntime.sourceSha 6bbff9d` = `@github/copilot@1.0.109` `buildMetadata.gitCommit`), so `@github/copilot` isn't installed.
- The npm `repository` (`github/copilot-agent-runtime`) is not public; `github/copilot-sdk` is the public, tagged snapshot.
