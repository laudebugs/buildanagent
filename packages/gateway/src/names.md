# Tool-name rules of the first wire protocols

A canonical tool name reaches both first wire protocols unchanged, because the canonical rule, `^[A-Za-z0-9_-]{1,64}$`, is the strictest intersection of the two rules below. OpenAI Chat Completions sets the 64-character limit, and Anthropic Messages allows the same characters at up to 128. `TOOL_NAME_RULES` in `names.ts` holds the same values.

| Wire protocol | Allowed characters | Length | Case | Source | Checked |
| --- | --- | --- | --- | --- | --- |
| Anthropic Messages | `a-z`, `A-Z`, `0-9`, `_`, `-` | 1 to 128 | Not stated | [Messages API reference, Tool object](https://platform.claude.com/docs/en/api/messages/create): "minLength: 1, maxLength: 128, pattern: ^[a-zA-Z0-9_-]{1,128}$". The [define-tools guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) gives the same pattern. | 2026-11-19 |
| OpenAI Chat Completions | `a-z`, `A-Z`, `0-9`, `_`, `-` | up to 64 | Not stated | [Chat Completions API reference, `FunctionDefinition.name`](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create): "Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64." [`FunctionDefinition.name` in OpenAI's TypeScript SDK](https://github.com/openai/openai-node/blob/v7.49.0/src/resources/shared.ts) at v7.49.0 has the same words. | 2026-11-19 |

Both rows are as of November 2026. The [fact-check log](../../../docs/plans/reviews/fact-check-tool-name-rule.md) records how each claim was checked.

## What is still unchecked

- **The OpenAI minimum length.** Neither the API reference nor the SDK comment states a minimum. The canonical rule requires at least one character anyway.
- **Case.** Neither provider says whether names are case-sensitive. The gateway keeps a name's case, but a `ToolNameMap` never issues two wire names that differ only in case: of two such names, the later one gets a salted hash suffix.
- **OpenAI-compatible servers.** Other servers that speak Chat Completions may set their own rules. An adapter for such a server passes its own `ToolNameRule` to `createToolNameMap()`.
