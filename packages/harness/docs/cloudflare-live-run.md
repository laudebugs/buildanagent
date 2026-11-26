# The Cloudflare live run checks the adapters on a real account, and only the owner starts it

The offline tests run the Cloudflare adapters in workerd through Miniflare, which has real Durable Object storage, alarms and hibernatable sockets. It never evicts an object, and it keeps every alarm on one machine. The live run closes that gap. It deploys the same test Worker to your own Cloudflare account under a new random name, runs the same checks against real Durable Objects, waits long enough for a real eviction, and deletes the Worker however the run ends. It never runs in CI, and no workflow calls it.

## What you need before you run it

1. Wrangler, logged in to the account you want to use (`wrangler login`), or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set to a token that may edit Workers. Set `WRANGLER` to Wrangler's path if it is not on `PATH`.
2. Any Workers plan: SQLite-backed Durable Objects run on the Free plan too. The run creates one Worker with one Durable Object class and deletes it at the end.
3. This repository installed with `pnpm install`. The run bundles the Worker from source, so it needs no build.

## Run it from the repository root

```sh
HARNESS_CLOUDFLARE_LIVE=1 pnpm --filter @buildanagent/harness live:cloudflare
```

Without `HARNESS_CLOUDFLARE_LIVE=1` the script refuses to start, and with `CI` set it refuses too. A run takes about three minutes, most of it the 90-second idle wait that lets the object leave memory.

## What the run checks, in order

1. The workerd smoke test: `new Function` is refused, pi-schema and `@cfworker/json-schema` agree on a schema, and the MCP client lists and calls a tool.
2. Every case of the portability suite, each in its own Durable Object, printed as `passed`, `skipped` or `failed`. The same four cases skip as offline: the two torn-line cases and the key store's rotate and prune.
3. 16 concurrent requests for one session's lock, of which one must win, and 16 concurrent appends that expect the same tail, of which one must be written.
4. A wake on the real alarm two seconds out, which must arrive with the time it asked for.
5. A turn over a WebSocket, an idle wait of 90 seconds, and a second turn on the same socket, which must be accepted and settle. The run prints whether the object was evicted and rebuilt in between; record that line, because only an eviction tests the bridge's replay.

## The run handles no secret of yours

The run makes two random values for itself: a key ring of one 32-byte key and an access token. It gives both to Wrangler on standard input as the Worker secrets `APPROVAL_KEYS` and `LIVE_TOKEN`, and never prints them. The deployed Worker refuses any request without the token from its first deploy, before the token is set, because a `workers.dev` address is public. Wrangler gets only `PATH`, `HOME`, `LANG`, `TMPDIR`, `XDG_CONFIG_HOME` and the two Cloudflare variables, so it finds your login and nothing else from your shell. If Wrangler fails, the script shows its output with both random values replaced by `[REDACTED]`. Your Cloudflare login stays with Wrangler, and the script never reads it.

## Record the result in the pull request that changes the adapters

A passing run ends with `deleted buildanagent-harness-live-<suffix>`. Paste the run's output, without the address, into the pull request, and tick the todo's live-run box. If the run stops before that line, check the Workers list in the dashboard and delete any `buildanagent-harness-live-` Worker it left.
