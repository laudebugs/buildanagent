# Fact-check: the tool-name rule

This log checks the provider claims that todo B7 adds, on 2026-11-19: the table in [`names.md`](../../../packages/gateway/src/names.md), the status note in [ADR 0011](../../decisions/0011-tool-name-rule.md#status-note-todo-b7-2026-11-19) and the revision to [D12](../build-sdk.md#d12-a-per-adapter-name-table-first-then-a-canonical-rule-and-reversible-sanitising-accepted). Anthropic's claims were read from the Markdown rendering of its Messages API reference and from its define-tools guide that day. OpenAI's claims were read from the Markdown rendering of its Chat Completions API reference on `developers.openai.com` and from `openai/openai-node` at tag `v7.49.0`. The next two sections re-read the OpenAI claims on the live pages later the same day, and check the price catalog's OpenAI entry, which has no fact-check log of its own. The last section records the owner's acceptance of ADR 0011.

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
| 7 | The OpenAI API reference could not be reached from the build environment | ✏️ | True when B7 was drafted: neither `platform.openai.com` nor `developers.openai.com` resolved then. On 2026-11-19 `developers.openai.com` answered and confirmed claim 4, while `platform.openai.com` still returned 403. `names.md`, `names.ts`, ADR 0011 and the B7 todo now cite the API reference and no longer list it as unchecked |
| 8 | OpenAI states no minimum length | ⚠️ | Neither the API reference nor the SDK comment states one. The canonical rule requires at least one character anyway |
| 9 | OpenAI does not say whether tool names are case-sensitive | ⚠️ | Neither source mentions case for function names; the gateway handles it as in claim 3 |

## Derived claims

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 10 | The strictest intersection of the two rules is `^[A-Za-z0-9_-]{1,64}$` | ✅ | Claims 1 and 4 allow the same characters; the shorter limit is OpenAI's 64, and the minimum of 1 is Anthropic's (claim 8) |
| 11 | That intersection is the floor ADR 0011 assumed, so no superseding rule is needed | ✅ | ADR 0011's title and decision state `^[A-Za-z0-9_-]{1,64}$` |
| 12 | D12's revision: Anthropic allows the same characters at up to 128 and OpenAI at up to 64, so the strictest provider sets the 64-character limit | ✅ | Claims 1, 4 and 10 |
| 13 | Both rows hold as of November 2026 | ✅ | Every source above was read on 2026-11-19 |

## OpenAI claims re-read on the live pages (2026-11-19)

Row 7 records that the OpenAI reference was out of reach when B7 was drafted, so the SDK's source (row 5) stood in for it until `developers.openai.com` answered later that day and row 4 cited it. Row 14 reads that page again, row 15 re-tries `platform.openai.com`, and row 16 re-reads the reference for the two absence claims.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 14 | Row 4: `FunctionDefinition.name` "Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64" | ✅ | [Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create.md), read with `curl` on 2026-11-19: the same sentence, under the function tool's `name` |
| 15 | Row 7: `platform.openai.com` still answers 403 | ✅ | `curl` and Playwright's Chromium, 2026-11-19: both got 403 and a "Just a moment..." challenge page. `developers.openai.com` serves the same reference, so nothing depends on it |
| 16 | Rows 8 and 9: OpenAI states no minimum length and no case rule for function names | ⚠️ | The live reference still mentions neither. An absence is all a search can show, so the gateway keeps the handling that rows 3 and 9 describe |

## The price catalog's OpenAI entry (2026-11-19)

These rows check the `gpt-5.4-mini` entry in [`catalog.json`](../../../packages/gateway/src/catalog.json), which todo B5 added from OpenAI's pricing and model pages, and the cache-write note in [B5's outcome](../../todos/done/B5-usage-cost-catalog.md#outcome). Each page was read as Markdown with `curl` on 2026-11-19.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 17 | `gpt-5.4-mini` costs $0.75 per million uncached input tokens, $0.075 cached and $4.50 output | ✅ | [Pricing](https://developers.openai.com/api/docs/pricing.md), standard table: "gpt-5.4-mini \| $0.75 \| $4.50 \| $0.075"; the [model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini.md) gives the same three rates |
| 18 | `gpt-5.4-mini` has no cache-write charge, so the entry prices cache writes at the uncached input rate | ✅ | [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching.md): writes cost 1.25× input for 30 minutes and 2.5× for 12 hours only "For GPT-5.6 and later"; its model table gives "No additional cache-write charge" for GPT-5.5 and for "Other earlier models". The pricing page's `gpt-5.4-mini` table has no write columns, unlike its GPT-5.6 and later rows. The entry is right as it stands |
| 19 | `contextWindow` is 272,000 and `maxOutputTokens` 128,000, and the model's full window is 400,000 | ✅ | Model page: "400,000 context window", "Maximum input tokens: 272,000", "128,000 max output tokens" |
| 20 | The model takes images and reasons | ✅ | Model page: "Input modalities: text, image" and "Reasoning token support" |
| 21 | B5's outcome: OpenAI's newer models bill 30-minute and 12-hour cache writes | ✅ | Prompt caching guide, as in row 18; it adds that the 12-hour lifetime is offered "in the Responses API" only |

## The owner's acceptance (2026-11-19)

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 22 | The owner accepted ADR 0011 | ✅ | Owner's answer, 2026-11-19: "accepted". The ADR's status, its index row and D12's row in the SDK plan now read Accepted |

**Totals:** 22 claims: 17 ✅, 1 ✏️, 4 ⚠️.
