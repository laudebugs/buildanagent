# Fact-check: the tool-name rule

This log checks the provider claims that todo B7 adds, on 2026-11-19: the table in [`names.md`](../../../packages/gateway/src/names.md), the status note in [ADR 0011](../../decisions/0011-tool-name-rule.md#status-note-todo-b7-2026-11-19) and the revision to [D12](../build-sdk.md#d12-a-per-adapter-name-table-first-then-a-canonical-rule-and-reversible-sanitising). Anthropic's claims were read from the Markdown rendering of its Messages API reference and from its define-tools guide that day. OpenAI's claims were read from the Markdown rendering of its Chat Completions API reference on `developers.openai.com` and from `openai/openai-node` at tag `v7.49.0`.

## Anthropic Messages

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 1 | A custom tool's `name` must match `^[a-zA-Z0-9_-]{1,128}$` | ✅ | [Messages API reference](https://platform.claude.com/docs/en/api/messages/create), `tools`, `Tool object`, `name`: "minLength: 1, maxLength: 128, pattern: ^[a-zA-Z0-9_-]{1,128}$" |
| 2 | The define-tools guide gives the same pattern | ✅ | [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools): "Must match the regex `^[a-zA-Z0-9_-]{1,128}$`" |
| 3 | Anthropic does not say whether tool names are case-sensitive | ⚠️ | Neither page above mentions case for tool names. An absence is all a search can show, so the gateway assumes the worst case and never issues two wire names that differ only in case |

## OpenAI Chat Completions

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 4 | `FunctionDefinition.name` "Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64" | ✅ | [Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), `tools`, `ChatCompletionFunctionTool`, `function.name`, read 2026-11-19 |
| 5 | OpenAI's TypeScript SDK carries the same words | ✅ | [`src/resources/shared.ts`](https://github.com/openai/openai-node/blob/v7.49.0/src/resources/shared.ts) at `v7.49.0`, `FunctionDefinition.name`; `openai@7.49.0`'s `resources/shared.d.ts` in this workspace has the same comment |
| 6 | The SDK is generated from OpenAI's API specification | ✅ | The `v7.49.0` README: "It is generated from our OpenAPI specification" |
| 7 | The OpenAI API reference could not be reached from the build environment | ✏️ | True when B7 was drafted, when `platform.openai.com` and `developers.openai.com` did not resolve. On 2026-11-19 `developers.openai.com` answered and confirmed claim 4, while `platform.openai.com` still returned 403. `names.md`, `names.ts`, ADR 0011 and the B7 todo now cite the API reference and no longer list it as unchecked |
| 8 | OpenAI states no minimum length | ⚠️ | Neither the API reference nor the SDK comment states one. The canonical rule requires at least one character anyway |
| 9 | OpenAI does not say whether tool names are case-sensitive | ⚠️ | Neither source mentions case for function names; the gateway handles it as in claim 3 |

## Derived claims

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 10 | The strictest intersection of the two rules is `^[A-Za-z0-9_-]{1,64}$` | ✅ | Claims 1 and 4 allow the same characters; the shorter limit is OpenAI's 64, and the minimum of 1 is Anthropic's (claim 8) |
| 11 | That intersection is the floor ADR 0011 assumed, so no superseding rule is needed | ✅ | ADR 0011's title and decision state `^[A-Za-z0-9_-]{1,64}$` |
| 12 | D12's revision: Anthropic allows the same characters at up to 128 and OpenAI at up to 64, so the strictest provider sets the 64-character limit | ✅ | Claims 1, 4 and 10 |
| 13 | Both rows hold as of November 2026 | ✅ | Every source above was read on 2026-11-19 |

**Totals:** 13 claims: 9 ✅, 1 ✏️, 3 ⚠️.
