# N25: MCP streamable HTTP, legacy SSE and background connect

| Field | Value |
| --- | --- |
| ID | `N25` |
| Status | `done` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N24](../done/N24-mcp-stdio.md) |
| Size | M |

## Goal

Add the remote transports and connect servers in the background, waiting at the first prompt only for directly exposed servers, so a slow server never blocks a session.

## Context

- [harness guide §4](../../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension): streamable HTTP, SSE as legacy, background connect, 10-second wait
- [HD14](../../plans/build-harness.md#hd14-build-the-mcp-client-on-modelcontextprotocolclient-240-provisional): the decision and its evidence

## Scope

**In scope**

- Streamable HTTP through `McpConnection`, and SSE for legacy-era servers only: HTTP+SSE has been deprecated since 2025-03-26, and the 2026-07-28 revision formally classes it Deprecated ([MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), as of November 2026)
- HTTP servers reached through the egress proxy's allowlist (N20)
- Background connect; the first prompt waits up to 10 seconds only for `direct` servers
- Tool-list changes diffed against a pin, never re-registered silently. Tool definitions are pinned in N22's `extensions.lock.json` format, and this todo owns the MCP entries. A new or changed tool starts disabled, is announced in a `role: "system"` message (HD3's append-only rule) and needs an approval before the model can call it. The `tools` array sent to the model stays as built at session start
- List-change notifications from both eras: `notifications/tools/list_changed` from legacy servers, and the opt-in `subscriptions/listen` stream (`toolsListChanged`) from 2026-07-28 servers, with a dropped stream re-issued

**Out of scope** (and which todo covers it)

- OAuth flows beyond what the client library provides

## Tasks

- [x] Serve a local HTTP MCP server in tests on 127.0.0.1.
- [x] Write the pin format for MCP tool definitions on N22's lock file, and the diff that classifies each tool as unchanged, new or changed.
- [x] Subscribe through `subscriptions/listen` on 2026-07-28 servers, and test a dropped stream with a re-issued request.

## Acceptance criteria

- [x] A deferred HTTP server that takes 30 s to answer does not delay the first model call
- [x] A direct server that answers in 2 s is listed in the first request
- [x] A tool-list change applies at the next turn, never mid-turn
- [x] A changed or new tool is disabled, announced in a system message and callable only after an approval; an unchanged tool stays enabled
- [x] A tool-list change never changes the `tools` array sent to the model mid-session (a scripted test inspects every request)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/mcp/http.test.ts`, `background.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Remote servers hold their own credentials; the harness passes none unless a credential route names the host.

History: plan review 2 (2026-11-19) replaced the silent re-register on `tools/list_changed` with the diff against a pin (agent connectors report, plan-change item 4), added `subscriptions/listen`, marked SSE legacy-only and tied tool changes to HD3's append-only rule.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/harness/mcp` now reaches remote servers over streamable HTTP and legacy SSE, connects every server in the background, and changes a session's tools only at a turn boundary, with each tool's definition checked against a pin. The new exports are `memoryMcpPinStore()` and the types `McpHttpTransport`, `McpSseTransport`, `McpRemoteSettings`, `McpEgressFetch`, `McpPinStore`, `McpPendingTool`, `McpToolState` and `McpTimers`. `McpManager` gains `start()`, `statuses()`, `beginTurn()`, `pending()`, `approve()` and `permissionHook()`, and `McpConnection` gains `watchTools()`. `McpManagerOptions` gains `pins`, `directWaitMs`, `relistIntervalMs` and `timers`, and `McpCallFailure` gains `disabled`. `@buildanagent/harness/tools` exports `TurnBoundary`, `HarnessOptions` takes `turnBoundaries`, and `@buildanagent/harness/extensions/node` gains `fileMcpPinStore()`, `readMcpPins()` and `writeMcpPins()`. The protocol's `McpServerRecord` takes `transport: "http" | "sse"` and an optional `urlHash`. The code is in `packages/harness/src/mcp/` (`remote-config.ts`, `guarded-fetch.ts`, `http-node.ts`, `remote.ts` and `pins.ts` are new) and `src/session/runner.ts`. The new tests are `test/mcp/http.test.ts` (23), `streams.test.ts` (6), `ssrf.test.ts` (15), `pin.test.ts` (15), `background.test.ts` (7), `sse-filter.test.ts` (6), `test/session/turn-boundary.test.ts` (1), `test/examples/mcp-remote.test.ts` (1) and one in `test/extensions/lock.test.ts`, against HTTP servers on 127.0.0.1 in the test process.

**Decisions.**

- **The client library's transports carry the protocol, and a fetch of our own carries every byte.** `StreamableHTTPClientTransport` and `SSEClientTransport` of `@modelcontextprotocol/client` 2.4.0 take a `fetch`, and the streamable one takes a `reconnectionScheduler`, so `guardedFetch()` sits under both. On its own the library reads a JSON body with `response.json()` and an event stream through `eventsource-parser` with no size bound, follows up to five redirects within the origin, sets the reconnect delay from the server's `retry:` field with no clamp, and resets its attempt count after any stream that ends normally, so a server that sends `retry: 0` and closes would loop. The guard bounds the body, refuses every redirect, removes the `retry:` field and gives the library a scheduler with its own budget. A thin transport of our own was the alternative; it would have meant writing the 2026-07-28 header rules, the per-request streams and the legacy session handling the library already has.
- **On Node the harness connects itself, to the address it checked.** Node's `fetch` gives no way to see or pin the address a name resolves to, so `http-node.ts` sends each request through `node:https` with a `lookup` that resolves once, refuses the name when any answer is not allowed, and returns the first answer, then checks `socket.remoteAddress` after the connect. With a configured egress proxy, every request goes through `proxy.fetch()` instead, so N20's allowlist, address checks and log apply. On a runtime without Node's network modules the platform's `fetch` carries the request, with `redirect: "manual"` and a literal-address check only. A separate `./mcp/node` entry was the alternative; the file loads Node by `process.getBuiltinModule()`, as `stdio.ts` does, so `./mcp` still loads on Cloudflare.
- **Default deny, named per server.** An address that is loopback, private, carrier-grade NAT, link-local, unspecified, multicast or reserved, or an IPv6 form that wraps one, is refused through the same `isPublicAddress()` the egress proxy uses. `allowAddresses` takes CIDR ranges and never allows loopback, and `unsafeAllowLoopback` is the only way to reach `127.0.0.1` or to use plain `http:`, which then reaches loopback addresses alone. `resolve` replaces the resolver, as in N20.
- **Credentials come from `headers` only.** A URL with a user name, a password, a fragment, a control character or a credential-like query parameter is refused at config time, and so is a header the transport sets itself or a value with a control character. Every log line and error message has the URL and each header value replaced with `[redacted]`, and the record holds `urlHash`, never the URL. A `401` fails with a message that says the harness runs no authorization flow, by the owner's N24 decision.
- **A broken bound closes the connection.** A body past a size bound, or a time bound on the answer to one request, closes the whole connection, since the server is then broken or hostile, and the error names the bound. A long-lived stream, a `GET` or a `subscriptions/listen`, that goes quiet is cut and opened again. The first version cut only the stream, which left the request waiting on the probe timeout and hid the reason.
- **The event filter rewrites line ends.** It passes each kept line with an LF after it. Dropping a `retry:` line between a CR and an LF would otherwise join them into one line end and hide the blank line that ends an event, which a test showed with the first version.
- **A legacy SSE stream opens once.** When it ends, the next `GET` is refused and the connection closes. A reconnect would start a new legacy session that the client never initialised.
- **The harness's own cuts never break a long-lived stream's connection or use up its budgets** (first code review, findings 2, 3, 5 and 7). A legacy SSE stream carries every answer and can't be reopened, so it has only the event and line bounds; the first version cut it for time and then closed the connection, so a quiet SSE server lost every call. A streamable HTTP GET or listen stream cut for idle time, its lifetime or `maxStreamBytes` is opened again at once, and the cut is spent by that reopen instead of counting as a drop or against the ten-reopen budget; the first version counted it, so a quiet listen stopped reopening after eight cuts. The total-byte cut of such a stream is no longer fatal, and an event or line past `maxMessageBytes` still is. The library's `maxRetries` sits past the schedule's budget, because at 2 the library gave up on failing reopens and left the connection open with no stream for a legacy server's change notices.
- **A tool runs only when its registered definition matches its pin too** (finding 4). The model reads the definition registered at connect, so a server that registered an unapproved definition and then listed the approved one would otherwise have had the tool enabled with the unapproved text. Such a tool is disabled for the session with its own notice.
- **Pins live in N22's lock file.** The lock file gains an `mcp` member, `{ "<server>": { "tools": { "<tool>": "sha256:…" } } }`, beside `extensions`, and each writer keeps the other's member. A file without `extensions` now reads as no extension pins, so writing MCP pins alone never makes a project's extensions refused. A tool's pin hashes `{ name, description, inputSchema }` with the description as cut, the fields of the record's `toolsHash`, and leaves the annotations out. Without a store, the list at connect is the pin for the life of the manager; with one, a server the store holds nothing for has every tool disabled. Trust on first use was the alternative; it would enable a new server's tools without a person.
- **Approval is a person's act on a definition hash, not a call approval.** `approve(server, tool, hash)` takes the hash `pending()` showed, refuses any other, and writes the store. `permissionHook()` denies a disabled tool, and the tool's own `execute` refuses it too. An `ask` through N13's signed pause was the alternative; a sticky allowance would cover it (`withStickyAllowances()` turns an ask into an allow), so a changed tool would inherit an earlier approval, and it would approve one call, not the definition. This follows N22, where project trust is a host decision outside the turn.
- **Changes apply at the turn boundary.** `beginTurn()`, which the runner calls before it builds the turn's tools, registers the servers that connected since the last turn, replaces the set of enabled tools and returns the notice. Notices and re-reads in between only update the server's latest list. The notice is a text block of origin `harness` in front of the input, in the same message: HD3 asks for a `role: "system"` message, and the gateway's `Message` has no system role (`assertKnownRoles()` refuses one).
- **The `tools` array never changes for a tool-list change.** A changed tool keeps its registered definition, a tool added mid-session is not registered and waits in `pending()` for a later session, and a `direct` server that connects after the first turn's wait is registered as `deferred`. Tool search can still activate a deferred tool, as before.
- **The first turn waits on the manager's timers.** `TurnOptions.clock` is an ISO-string clock with no timers, so the ten-second wait, the re-read interval and the listen backoff run on `McpManagerOptions.timers`, which the tests replace with a manual clock.
- **A failing server is tried once.** Background connect makes one attempt per server per manager, so a failure never retries, and it is reported once. Bounded backoff applies where the harness does reconnect: the listen stream and the streamable HTTP `GET`.
- **The listen stream is re-issued, bounded.** On a 2026-07-28 server that advertises `tools.listChanged`, the connection opens `subscriptions/listen`. When it drops, or the server ends it, it is opened again after one second, doubling to a minute, and the list is read again; a stream that lived five minutes resets the count, and after eight short-lived streams in a row it stays closed. The library's `listen()` does no re-listen of its own.

**Threat model.** N24's model still holds; a remote server adds a network peer and a URL.

- *What a hostile server, redirect or DNS answer cannot do.* It cannot send the harness to another origin: every redirect is refused, and a request off the configured origin, such as an SSE `endpoint` on another host, is never sent. A name whose answer is a refused address, whether at the first request or after a rebind, gets no connection, and the connection goes only to the checked answer. It cannot weaken TLS or make an `https:` URL fall back to HTTP. It cannot exhaust memory: a JSON body, an event and a line are capped at `maxMessageBytes`, a stream at `maxStreamBytes`, and a compressed answer is refused on Node. It cannot hold a request forever: headers, idle and lifetime timeouts cut it, and `maxStreams` caps open responses. It cannot set the reconnect delay or loop: `retry:` is removed, reopens wait one to thirty seconds, and ten in ten minutes close the connection. Its session id must be visible ASCII of at most 256 characters, and an event id the client could not send back is dropped. Its requests to the client are refused as in N24. It cannot get a header value or the URL into a log line, an error, the record or the model's context. It cannot make a changed or new tool callable without a person, or make a list change land inside a turn, change the `tools` array, or put its own text in a notice: a notice names canonical names and counts added tools. Flapping the list reads it at most once per `relistIntervalMs`, and an undone change announces nothing.
- *What it can still do.* It can send anything a result may hold, untrusted as in N24. It can change a tool's behaviour without changing its definition, which no pin can see. A disabled tool keeps sending the model its old definition until a new session. It can drop a response stream, and the request is lost: the harness sends no tool call again, because every MCP tool is a write, though SEP-2575 asks clients to re-issue. On a platform `fetch` it can rebind a name, since the harness can't resolve one there.

**Mutation checks.** Each criterion and threat was checked by breaking the code it covers and running its test. 48 mutations ran; 46 failed their test. The first code review's fixes added 13 more, and each fails its test.

| Mutation | Criterion or threat | Result |
| --- | --- | --- |
| C1 the first turn waits for every server; C2 for none | 30 s deferred server; 2 s direct server | both fail |
| C3 a re-read list applies at once | next turn, never mid-turn | fails |
| C4a every tool enabled; C4b `approve()` takes any hash; C4c the hook allows a disabled tool; C4d `execute` runs one | new or changed tool disabled until approved | each fails |
| C5 a late `direct` server keeps `direct` | `tools` array unchanged | fails |
| L1 no re-listen; L2 no limit on short streams; L3 no backoff | dropped stream re-issued, bounded | each fails |
| Ta1 every address allowed; Ta2 answers unchecked; Ta3 no pinned lookup; Ta4b no literal and no reached check | SSRF, DNS rebinding | each fails |
| Ta4 no reached-address check | DNS rebinding | survives: the pinned lookup already refuses, so the check is a second guard |
| Ta5 redirects passed on; Ta6 no origin check | redirects, origin | both fail |
| Tb certificates unchecked | TLS | fails |
| Tc1 no redaction; Tc2 headers not sent; Tc3 a 401 passed on | credentials | each fails |
| Td1 no body cap; Td2 no open-line cap; Td3 no event cap; Td4 no idle cut; Td5 no headers timeout; Td6 no stream cap; Td7 compression accepted | size and time bounds | each fails |
| Te session id unchecked | header hygiene | fails |
| Tf1 `retry:` kept; Tf3 no reopen budget; Tf4 an SSE stream may reopen | hostile stream | each fails |
| Tf2 the library's own reopen delay | hostile stream | survives: with `retry:` removed, the library's delay is the one the harness configures, so the clamp is a second guard |
| Tg1 no coalescing; Tg2 no notice cap; Tg3 a description in the notice | flapping lists | each fails |
| Th1 the wait timer not cleared; Th2 a failed server retried each turn | failure paths | both fail |
| Ti the record holds the URL | record | fails |
| P1 `writeLock()` drops MCP pins; P2 an MCP-only lock reads as empty extension pins | lock file | both fail |
| R1 the boundary runs after the tools are built; R2 notices not sent to the model | runner | both fail |
| F1 no status range check; F1b no try/catch around the response | a status outside 200 to 599 (finding 1) | both fail |
| F2 the SSE stream cut for time and bytes; F2b its per-event cut not fatal | SSE stream (finding 2) | both fail |
| F3 a planned listen cut counted as a drop | listen stream (finding 3) | fails |
| F4 the registered hash not compared | pin bypass (finding 4) | fails |
| F5 the library's `maxRetries` back at 2; F5b planned GET cuts counted in the budget | GET stream (finding 5) | both fail |
| F6 `writeLock()` reads a broken file strictly | lock repair (finding 6) | fails |
| F7 the total-byte cut fatal | long-lived streams (finding 7) | fails |
| F8 no per-path write queue | lock writes (finding 8) | fails |
| F9 `localhost` not loopback on the platform fetch | platform fetch (finding 9) | fails |
| F10 the old notice | MCP-only lock (finding 10) | fails |

**Named limits.**

- A tool a server adds mid-session joins only a later session, after approval; a changed tool sends its old definition until then.
- The manager's tool state is per manager, so two sessions sharing one manager share its turn boundaries.
- A broken response stream loses its request, and nothing sends a tool call again.
- On a runtime without Node's network modules, names resolve on the platform and are not checked; `localhost` and names under `.localhost` count as loopback there.
- A legacy SSE server's stream has no idle or lifetime bound, so a server can hold it open, one socket per connection.
- A tool registered with an unapproved definition stays disabled for the session even after its server lists the approved one.
- `ca` replaces the system's authorities for that server.
- The pins hash the definition, not the server's code, so a server can change what a tool does under an unchanged definition.
- The URL hash is not salted, so a reader of the log can confirm a guessed URL; secrets belong in `headers`.
- The lock file sits in the project it pins, as N22 says. Writes in one process are serialised by path; a write from another process, or through a second path to the same file, can lose one of two writes. `pinProjectExtensions()` replaces a lock file it can't read, and its MCP pins go with it.

**Other changes.** No dependency was added; `pnpm-lock.yaml` and every `package.json` are unchanged. L11 made the harness, the protocol and the CLI public while this todo was open, so `.changeset/harness-mcp-remote.md` releases the harness and the protocol as a `minor` change, and the fixed group moves the other four. The protocol's union, zod mirror, JSON Schema, fixtures and the harness's copy of `protocol.schema.json` changed together, and `docs/session-format.md` documents the new member. The gateway's portability scan and Biome's `noRestrictedGlobals` list `mcp/http-node.ts` beside `mcp/stdio.ts`. ADR 0021 records the transports in its consequences, and HD14 has an N25 revision.

**Open questions for the owner.**

1. *Should a broken response stream re-issue a read-only request?* SEP-2575 asks clients to re-issue a request whose stream broke. The harness re-issues none, because it treats every MCP tool as a write; `tools/list` and `subscriptions/listen` could be re-issued safely.
2. *Should a tool a server adds mid-session be usable in the same session once approved?* That would change the `tools` array mid-session, which HD3 forbids, so it waits for a new session now.
3. *Should a server the pin store holds nothing for be trusted on first use?* Every tool of it starts disabled now, which asks a person for each tool of a new server.
