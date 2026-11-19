# Fact-check: signed approvals on the AI SDK and Cloudflare `agents` (E3)

On 2026-11-19, this log checked every factual claim about third-party code and standards that E3's code, tests and `packages/agent-safety/README.md` rely on. Registry dates come from `https://registry.npmjs.org/<package>`, read with curl that day. Behaviour claims come from the pinned packages' built files in this workspace, cited by file and line as installed, and from the package's tests, which run offline in Node 22 and in workerd. The standards were read from the RFC Editor's text. A claim backed by a passing test in `packages/agent-safety/test/` says **[verified]**.

**Totals:** 29 claims: 29 ✅, 0 ✏️, 0 ⚠️.

## Pins

The five new dev dependencies are the versions `verify/cloudflare-agents` already pins, so the lockfile resolves them to the same copies.

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| E3-1 | `agents` 0.33.0 was published on 2026-11-03, so it clears the one-week pin rule on 2026-11-19 | ✅ | npm registry `time["0.33.0"]`: `2026-11-03T13:16:52Z` |
| E3-2 | `@cloudflare/ai-chat` 0.12.2 was published on 2026-10-20 | ✅ | npm registry: `2026-10-20T15:23:04Z` |
| E3-3 | `miniflare` 5.20261103.0-beta was published on 2026-11-03 | ✅ | npm registry: `2026-11-03T11:37:47Z`; the harness README explains why a beta is the runtime Cloudflare's stable wrangler ships |
| E3-4 | `esbuild` 0.28.2 was published on 2026-08-08 | ✅ | npm registry: `2026-08-08T20:00:55Z` |
| E3-5 | `@cloudflare/workers-types` 5.20261103.1 was published on 2026-11-03 | ✅ | npm registry: `2026-11-03T01:02:42Z` |

## The AI SDK's approval flow (`ai` 7.0.162)

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| E3-6 | `generateText` and `streamText` pass every approved approval from the incoming history to `validateApprovedToolApprovals`, which calls the call's `toolApproval` again before any `execute` runs | ✅ | `ai/dist/index.js` 4972–5062 (the function, whose `resolveToolApproval` call is at 5040), 5301 (`generateText`) and 9575 (`streamText`). The first test in `test/ai-approval.test.ts` records the order `policy, policy, recheck, execute` **[verified]** |
| E3-7 | At that second call only a `denied` status denies the call; every other status, `user-approval` included, lets it run | ✅ | `ai/dist/index.js` 5048–5056 pushes anything but `denied` onto the approved list. Changing the adapter's resume path to return `user-approval` made the tampered-signature test run `execute` |
| E3-8 | A denial at that point reaches the model as a `tool-result` whose output is `execution-denied` with the status's `reason` | ✅ | `ai/dist/index.js` 5048–5054 copy the reason onto the response, and 5364–5372 (`generateText`) and 9664–9672 (`streamText`) write the result. `test/ai-approval.test.ts` parses the reason from the model's next request **[verified]** |
| E3-9 | A generic `toolApproval` function decides alone: the SDK then never consults a tool's `needsApproval` | ✅ | `ai/dist/index.js` 3949–3955 return the function's status before the per-tool and `needsApproval` branches; the deprecated-`needsApproval` tests pause only because the adapter applies it itself **[verified]** |
| E3-10 | A per-tool approval function receives `(input, { toolCallId, messages, toolContext, runtimeContext })`, and `needsApproval` receives `(input, { toolCallId, messages, context })` | ✅ | `ai/dist/index.d.ts` 3489–3493 (`SingleToolApprovalFunction`) and `ai/dist/index.js` 3963–3985 |
| E3-11 | On the first call, the `messages` a generic function receives exclude the assistant response that holds the call, so a matching approval request in them marks a resume | ✅ | `ai/dist/index.d.ts` 3516–3519 ("Messages that were sent to the language model to initiate the response that contained the tool call") |
| E3-12 | `collectToolApprovals` reads approval responses only from the last message, and only when it is a `tool` message, and skips an approved call that already has a result | ✅ | `ai/dist/index.js` 2406–2450; the replay test drops the call's result to make the SDK collect the approval again **[verified]** |
| E3-13 | With `experimental_toolApprovalSecret` set, the SDK checks its own signature before `toolApproval` and throws `InvalidToolApprovalSignatureError` for a missing or wrong one, which covers the call's id, tool and input but no key id | ✅ | `ai/dist/index.js` 4989–5005; `test/ai-approval.test.ts` changes the input and catches the error **[verified]** |
| E3-14 | `streamText` streams a `tool-output-denied` chunk, in `fullStream` and in the UI message stream, for a call denied at that second check | ✅ | `ai/dist/index.js` 9592–9598, and a scratch run of `streamText` and `toUIMessageStream()` over a denied approval printed the chunk in both |
| E3-27 | Before a per-tool approval function or `needsApproval` sees a tool's context, `ai` validates it against the tool's `contextSchema`, so defaults and transforms apply and an invalid context throws; a generic `toolApproval` function gets the raw `toolsContext` | ✅ | `ai/dist/index.js` 2837–2846 (`validateToolContext`) and 3949–3985 (`resolveToolApproval`, raw for a function at 3950–3956); `test/ai-approval.test.ts` pauses a call only under a Zod default and rejects an invalid context **[verified]**. Added by the first code review, which found the adapter passed the raw context |
| E3-28 | `ai`'s UI message types and validator accept an `output-denied` tool part only with `approval.approved: false` | ✅ | `ai/dist/index.d.ts` 2132–2145 and `ai/dist/index.js` 11267 (`approvalDeniedSchema`) and 11434–11440; `test/ai-approval.test.ts` runs `validateUIMessages` on a settled part **[verified]**. Added by the first code review, which found `settleDeniedApprovals()` kept `approved: true` |
| E3-29 | A person's denial never reaches `toolApproval`: `collectToolApprovals` sorts it into the denied list, and only the approved list goes through `validateApprovedToolApprovals` | ✅ | `ai/dist/index.js` 2443–2444, 5300–5302 (`generateText`) and 9573–9576 (`streamText`). So a denied pause is never taken from the store, which is why `memoryPendingStore()` expires requests |

## Cloudflare's `AIChatAgent` (`agents` 0.33.0, `@cloudflare/ai-chat` 0.12.2)

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| E3-15 | `AIChatAgent` applies a `cf_agent_tool_approval` frame to the stored part and, with `autoContinue`, runs `onChatMessage` again, whose `streamText` then runs the approval check of E3-6 | ✅ | `@cloudflare/ai-chat/dist/index.js` 608–614 and 4044–4046; `test/cloudflare-approval.test.ts` answers each pause with that frame in workerd **[verified]** |
| E3-16 | `agents` treats a `tool-output-denied` chunk as a replay when the stored part is already `approval-responded`, so `AIChatAgent` neither stores the denial nor forwards it to the client | ✅ | `agents/dist/message-builder-DAl9AhHH.js` 391–398 (`isReplayChunk`), used by `@cloudflare/ai-chat/dist/index.js` 3790. In workerd the client received no output chunk for the denied call, and the stored part stayed `approval-responded` **[verified]** |
| E3-17 | Without a fix, the next model step in the same chat fails with `AI_MissingToolResultsError` for the denied call | ✅ | Observed in workerd before `settleDeniedApprovals()` existed: the retry scenario's `onError` received "Tool result is missing for tool call call_1." The same scenario now passes with no turn error **[verified]** |
| E3-18 | A client that connects while a turn streams receives `cf_agent_stream_resuming` and gets the buffered chunks only after it sends `cf_agent_stream_resume_ack` with the stream's id | ✅ | `@cloudflare/ai-chat/dist/index.js` 1031–1044 exclude connections in `_pendingResumeConnections` from every broadcast; `agents/dist/protocol-eXeJxhgu.js` 161–164 and `stall-watchdog-BpRF2uwG.js` 105–108 name the frames. The approved scenario received its output chunk only after the ack **[verified]** |
| E3-19 | The Workers types declare `crypto` as a global `const`, so `globalThis.crypto` fails to type-check (TS2339) under them, while the bare `crypto` global type-checks under both the Node and the Workers types | ✅ | `@cloudflare/workers-types/index.d.ts` declares `declare const crypto: Crypto`; `tsc -p test/workerd/tsconfig.json` reported TS2339 on each `globalThis.crypto` in `src/` and passes with bare `crypto` |
| E3-20 | Miniflare 5 refuses a Worker script outside its modules root ("can't use \"..\" to break out of starting directory"), and setting `modulesRoot` to the script's folder lets a bundle in the system temp directory run | ✅ | The error from the first workerd run, and the passing runs after `modulesRoot: outDir` in `test/cloudflare-approval.test.ts` |

## Standards and the signature format

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| E3-21 | RFC 2104 strongly discourages an HMAC key shorter than the hash's output, which is 32 bytes for SHA-256, so `hmacSigner()` refuses shorter keys | ✅ | [RFC 2104 §3](https://www.rfc-editor.org/rfc/rfc2104.txt): "less than L bytes is strongly discouraged as it would decrease the security strength of the function" |
| E3-22 | RFC 4648 §5 defines base64url with `-` and `_`, and padding may be skipped when the length is known | ✅ | [RFC 4648 §5](https://www.rfc-editor.org/rfc/rfc4648.txt), which points to §3.2 for skipping padding; `test/signing.test.ts` checks `toBase64Url()` against Node's `base64url` for lengths 0 to 39 **[verified]** |
| E3-23 | RFC 4648 §3.5 requires encoders to set the unused pad bits to zero, so text with non-zero pad bits is a second spelling of the same bytes, which `fromBase64Url()` refuses | ✅ | [RFC 4648 §3.5](https://www.rfc-editor.org/rfc/rfc4648.txt): "These pad bits MUST be set to zero by conforming encoders"; `test/signing.test.ts` flips the last pad bit of a signature **[verified]** |
| E3-24 | The fixture's signature is plain HMAC-SHA-256 over the payload bytes, base64url without padding: `openssl dgst -sha256 -hmac` over the same payload gives the same value | ✅ | `openssl dgst -sha256 -hmac '<test key>' -binary \| basenc --base64url` printed `gPgwkt3vEqjXFPJ6ab0o3BLbCsDeYaB7Ains3tAQkrI=`, the fixture's signature plus padding; `test/signing.test.ts` repeats the check with `node:crypto` **[verified]** |
| E3-25 | `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='` prints 43 characters of unpadded base64url, the form `parseKeyRing()` reads | ✅ | Run on 2026-11-19; 32 bytes encode to 43 characters plus one `=` |
| E3-26 | The signed payload holds a fixed tag and D5's six fields in D5's order, and nothing else: request id, kind, call id, tool name, input hash and policy version | ✅ | [build-sdk.md D5](../build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5) lists the fields; `test/fixtures/signed-pending.json` pins the bytes, with `null` for an absent policy version **[verified]** |
