---
"@buildanagent/gateway": patch
"@buildanagent/sdk": patch
"@buildanagent/agent-safety": minor
"@buildanagent/protocol": minor
"@buildanagent/harness": minor
"@buildanagent/cli": minor
---

First public alpha of `@buildanagent/protocol`, `@buildanagent/harness`, `@buildanagent/cli` and `@buildanagent/agent-safety`, which now version and publish with the gateway and the SDK as one group of six at one version. The gateway and the SDK have no change of their own in this version: they move with the group.

The protocol is the JSON-RPC wire between a client and the harness. It gained four additions before this release:

- `session/open` takes `fromSeq`, which replays a session's entries from that sequence number before any live event.
- An `events_dropped` event tells a client that is reading too slowly how many events it missed, so it can reopen with `fromSeq`.
- `$/cancelRequest` withdraws a request.
- `stdioTransport()`, from `@buildanagent/harness/server`, serves one client over a pair of byte streams with one JSON-RPC message per line. The CLI's `buildanagent rpc` command serves the protocol that way over standard input and output.
