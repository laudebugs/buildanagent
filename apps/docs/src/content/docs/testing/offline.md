---
title: Keep tests offline
description: Block real requests and provider keys at the start of every test file.
---

A test should never reach a real provider by accident. Read this page to turn real requests off for your whole test suite, so a mistake fails the test instead of spending money.

## Import the setup first

Start each test file with one import. It blocks every request to a host other than your own machine, stops the run if a provider API key is set and turns real model requests off:

```ts
import "@buildanagent/gateway/testing/setup";
```

An adapter that tries to send a request anyway throws an error with the code `model_requests_disabled` before it sends anything.

## Test a wire format with a mock transport

To test how an adapter talks to a provider, pass a mock transport to it. The mock answers the first request with the first scripted response, the second with the second, and records every request it receives. A request past the end of the script throws. The record reads `[redacted]` for every credential header, so a test log never holds a key.

## Tests give the same result every run

Nothing in `@buildanagent/sdk/testing` reads the system clock or `Math.random()`. Import `fixedClock()` and `sequentialIds()` from it and pass them to `run()` as `clock` and `idGenerator`, and the same script streams the same events every time, timestamps and run id included.

Next, see the [packages and their entry points](/reference/packages/).
