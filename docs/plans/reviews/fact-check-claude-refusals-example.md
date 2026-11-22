# Fact-check: the Claude Agent SDK refusal example

This log checks the claims that `verify/claude-agent-sdk/examples/10-refusals-are-recorded.ts` and its README section make on 2026-11-22 (todo T31), against the pinned `@anthropic-ai/claude-agent-sdk` 0.3.327 and the run itself.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| T31-1 | A result message carries `permission_denials`, a list of `{ tool_name, tool_use_id, tool_input }` | ✅ | `sdk.d.ts`: `SDKPermissionDenial` (lines 6057 to 6061), and `permission_denials: SDKPermissionDenial[]` on both result variants (lines 6248 and 6423) |
| T31-2 | With no `canUseTool` callback, an `ask` decision is terminal, so the call is refused and recorded | ✅ | `sdk.d.ts` line 6064: "Without one (bare -p / SDK query() with no canUseTool), 'ask' decisions are terminal, so this event also covers those implicit denials"; the example's run shows the call refused and recorded |
| T31-3 | `result.permission_denials` is the SDK's authoritative record of refusals | ✅ | `sdk.d.ts` line 6064: "result.permission_denials is the authoritative record" |
| T31-4 | A refused call never runs, and the model's next request carries the refusal as an error result | ✅ | The example's checks: `send_email` ran 0 times, and a `tool_result` block with `is_error: true` is in the mock's request log |
| T31-5 | A refusal leaves the run's result `success`, not an error | ✅ | The example's check that `result.subtype` is `success` |
| T31-6 | A call that `allowedTools` names runs, and leaves `permission_denials` empty | ✅ | The example's second query: `read_notes` ran once and the list was empty |
| T31-7 | The SDK's `sandbox` option isolates command execution, and the mock never calls built-in host tools such as `Bash` | ✅ | `sdk.d.ts` (lines 2331 to 2389): "Sandbox settings for command execution isolation"; the harness README says the mock "Never calls built-in tools such as Bash or Edit" |

**Totals:** 7 claims: 7 ✅, 0 ✏️, 0 ⚠️.
