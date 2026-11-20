---
"@buildanagent/gateway": minor
---

Breaking Changes: `ModelEvent` gains a `raw` member, `{ type: "raw"; event: unknown }`, so a `switch` over a model event's `type` that must stay exhaustive needs a `raw` case. No stream emits one unless you ask: `StreamOptions` gains `includeRaw` (default off), and with it off every stream is unchanged. With it on, the Anthropic and OpenAI Chat adapters stream one raw event per server-sent event, as `{ event, data }` with `data` unparsed, before the normalized events it produced. A raw event is not output, so the gateway still retries a call that failed before any content, and the `retry` event marks the failed attempt's raw events superseded. Adapters still declare `specificationVersion: "v1"`.
