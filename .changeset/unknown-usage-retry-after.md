---
"@buildanagent/gateway": patch
"@buildanagent/sdk": patch
---

Price a reply whose usage the provider never reported as unknown, and wait as long as the provider asks before a retry.

- **Unreported usage costs `null`, not $0.** A reply that ends without usage, such as an OpenAI-compatible stream without its usage chunk or an Anthropic stream whose `message_delta` carries none, now has `usage.unreported: true` and a cost of `{ total: null, basis: "unknown" }`. Before, it was priced as a known $0, which a budget would count as free. `unreportedUsage()` builds such a record for an adapter you write. A provider-billed total still wins, and an HTTP error response still counts as zero tokens.
- **Retries honour `retry-after`.** Both adapters read `retry-after` (seconds or an HTTP date) and `retry-after-ms` from a failed response and put the hint on `error.retryAfterMs`. `createModel()` waits for the longer of its backoff and the hint, still capped at 60 seconds, and still never retries `quota`, `overflow` or `fatal` errors.
- **`ScriptedModel` scripts without `usage` report none.** Such a response's usage is now `unreported`, so it is priced as unknown. Pass `usage: {}` to script a response that reports zero tokens.
