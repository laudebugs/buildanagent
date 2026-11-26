---
title: The own-key guard
description: How agent safety keeps every model call on the user's own key and address, and refuses a call that could bill someone else.
---

You will build model calls that carry one user's key to one address and nothing else, and that count against a cap. You need this when users bring their own provider keys and a call that falls back to your key would bill you or another user.

An agent that bills the wrong account fails silently: the call succeeds, and someone else pays for it. The `./byok` subpath, short for bring your own key, closes the paths that allow it.

## Three defaults can pick another key

In `ai` 7.0.173, as of November 2026, three paths let a call use a credential that no line of your code chose. A provider built without `apiKey` reads `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` from the environment. A provider built without `baseURL` reads `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL`. A string model id goes to Vercel AI Gateway, which signs in with its own credential and, by default, falls back to Vercel's billed keys.

## Build the provider from the user's key

The `./byok` subpath needs the optional peers `@ai-sdk/anthropic` and `@ai-sdk/openai`, which the package pins to exactly 4.0.105 and 4.0.118 as of November 2026. The example also uses `ai` and `./cost`. Install them with the package:

```bash
pnpm add @buildanagent/agent-safety@alpha ai@7.0.173 @ai-sdk/anthropic@4.0.105 @ai-sdk/openai@4.0.118
```

`explicitProvider()` builds an Anthropic or OpenAI provider from the `apiKey` and `baseURL` you pass, and from nothing else. Both are required, so the provider never reads the environment. The first function below builds the provider for one user's key and caps its calls:

```ts file="packages/agent-safety/examples/own-key-capped.ts" region="provider"
```

The second function answers a prompt and says why a call stopped, as the [cost cap](/agent-safety/cost-cap/) page explains:

```ts file="packages/agent-safety/examples/own-key-capped.ts" region="call"
```

Build the answerer once for each key and keep it. Its spend is what the cap counts, so a new answerer for each call would reset the cap to zero.

## Refuse string model ids at startup

`assertNoDefaultProvider()` sets the AI SDK's default provider to one that refuses every model. After that, `generateText`, `streamText` or a `prepareStep` that names a model by string throws a `SafetyError` with the code `default_provider` before any request. Call it once at startup. It defines the setting as read-only, so later code that assigns another default provider throws in strict mode, which every ES module uses, and is ignored silently in sloppy mode.

The property stays configurable, so code can still delete it. Treat this as a second tripwire only, and rely on the startup call. If another default provider is already set, it throws `default_provider` too.

A model you build any other way, such as with `createAnthropic()` or the `gateway` that `ai` exports, is not checked. Build every model with `explicitProvider()`.

## What a bad key or address throws

`explicitProvider()` throws `invalid_byok_config` for a missing key, a key with surrounding whitespace or a control character, and a base URL that is not safe. The base URL must use https, with plain http allowed only on a loopback host for a local proxy. It must not be Vercel AI Gateway, and a Cloudflare AI Gateway address must name the provider's own endpoint.

## The egress guard checks each request

Every provider that `explicitProvider()` builds sends its requests through `egressGuard()`, which you can also wrap around any other `fetch`. The guard refuses a request, with the code `egress_refused` and before anything leaves, in three cases:

- The request goes to another origin, or outside the base URL's path.
- Its credential header is missing or differs from the configured key. That header is `x-api-key` for Anthropic and `authorization: Bearer` for OpenAI.
- It carries a second credential header, such as `authorization` beside an Anthropic key.

The guard never follows a redirect, because Node's `fetch` forwards `x-api-key` to a redirect's new host. The package README covers Cloudflare AI Gateway, including its token and the `byok_only` setting that `checkModelRoutes()` verifies at deploy time.

Next, look up an error in [Problems and fixes](/agent-safety/problems-and-fixes/).
