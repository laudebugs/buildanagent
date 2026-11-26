---
title: Protocol quick start
description: Write the first request a client sends to a harness, read its answer and run both against the buildanagent rpc command.
---

You will write the first line a client sends to a harness and read the answer. You need this when you build a client for the harness, in an editor, a script or a program in another language.

## Install the protocol package

The package needs Node 22.19 or later. Install it with the `alpha` tag, which npm serves for every release until the first stable one:

```bash
pnpm add @buildanagent/protocol@alpha
```

## Write the first request

A client opens every conversation with `initialize`, which says who the client is and which experimental methods it opts into. This function builds that request and turns it into one line of JSON:

```ts file="packages/protocol/examples/quick-start.ts" region="request"
```

`encode()` checks the message's envelope, so a request without `"jsonrpc": "2.0"` never reaches the wire. The line ends in a newline, because the protocol carries one message per line.

## Read the answer

The server answers on its output, in chunks that can cut a line, or a character, anywhere. This function feeds the bytes to a `JsonlFramer`, which finds each whole line, and `decode()` checks every message's envelope:

```ts file="packages/protocol/examples/quick-start.ts" region="answer"
```

It returns the server's `InitializeResult` and throws when the server answers with an error or never answers.

## Run both against a harness

The CLI's `rpc` command serves the protocol over its standard input and output. It refuses to start without `--model` and a key in the provider's variable, but `initialize` makes no model call, so the transcript sets a key that is not real. Use your own key when you run turns. Sending the line that `initializeLine("my-editor", "1.0.0")` writes gets the server's answer:

```console file="packages/cli/transcripts/rpc-initialize.txt"
```

The answer names the server and the SDK version it runs, which the transcript shows as `<version>` where your install prints its own. It lists the capabilities the server supports and the two experimental methods a client must opt into. `pending` is empty because no request waits for an answer. The server's own `version` reads `0.0.0` because of a known bug: the CLI does not yet pass the harness's version on.

Next, see how a client [opens a session and starts a turn](/protocol/messages/).
