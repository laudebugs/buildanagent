# Tool-name rules of the first wire protocols

A canonical tool name reaches both first wire protocols unchanged, because the canonical rule, `^[A-Za-z0-9_-]{1,64}$`, is the strictest intersection of the two rules below. OpenAI Chat Completions sets the 64-character limit, and Anthropic Messages allows the same characters at up to 128. `TOOL_NAME_RULES` in `names.ts` holds the same values.

| Wire protocol | Allowed characters | Length | Case | Source | Checked |
| --- | --- | --- | --- | --- | --- |
| Anthropic Messages | `a-z`, `A-Z`, `0-9`, `_`, `-` | 1 to 128 | Not stated | [Messages API reference, Tool object](https://platform.claude.com/docs/en/api/messages/create): "minLength: 1, maxLength: 128, pattern: ^[a-zA-Z0-9_-]{1,128}$". The [define-tools guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) gives the same pattern. | 2026-11-19 |
| OpenAI Chat Completions | `a-z`, `A-Z`, `0-9`, `_`, `-` | up to 64 | Not stated | [`FunctionDefinition.name` in OpenAI's TypeScript SDK](https://github.com/openai/openai-node/blob/v7.49.0/src/resources/shared.ts): "Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64." | 2026-11-19 |

Both rows are as of November 2026.

## What is still unchecked

- **The OpenAI API reference page itself.** Its hosts, `platform.openai.com` and `developers.openai.com`, did not resolve from the build environment. The OpenAI row therefore comes from the doc comment in OpenAI's official SDK, which is generated from the API specification, and the same comment appears in `openai@7.49.0`'s `resources/shared.d.ts`. Check the [API reference](https://platform.openai.com/docs/api-reference/chat/create) when it can be reached.
- **The OpenAI minimum length.** The SDK comment states no minimum. The canonical rule requires at least one character anyway.
- **Case.** Neither source says whether names are case-sensitive. The gateway keeps a name's case and treats names that differ only in case as different tools.
- **OpenAI-compatible servers.** Other servers that speak Chat Completions may set their own rules. An adapter for such a server passes its own `ToolNameRule` to `createToolNameMap()`.
