# Examples readers can copy: public imports, no test scaffolding, always tested

An example is code a reader will paste into their own agent, so it must be code we would merge. These rules apply to every file under `packages/*/examples/` and to every code block a reader-facing page shows ([docs-writing.md](docs-writing.md)). They adapt Lamina PDF's `examples.md`; the SDK's capstone, `packages/sdk/examples/triage-agent.ts` ([SDK plan §5.3](../plans/build-sdk.md#53-the-triage-capstone-checks-the-whole-sdk-against-the-reference-capstones)), is the first example they govern.

## An example does one thing and is always tested

- **MUST:** a page shows a file from `examples/`, never from `test/`. A test may import an example; an example never imports a test.
- **MUST:** an example does one thing and reads top to bottom. A reader could paste it into an app and run it after changing only the provider config.
- **MUST:** a test runs every example offline, on `ScriptedModel` or a mock transport ([testing.md](testing.md)), and fails when the example stops working.

## An example is written like product code

- **MUST:** the file opens with a comment that says what it shows. The comment mentions no ADR or todo ids, no repository paths and no test vocabulary, except in [an example about testing](#an-example-about-testing-may-build-the-double-it-teaches).
- **MUST:** an example imports only public entry points, such as `@buildanagent/sdk` and `@buildanagent/gateway/anthropic`. It never imports from `src/`, `test/` or another package's files.
- **MUST:** an example holds no test scaffolding. A fixed clock, fixed ids or a scripted model are parameters the test passes in, and checks of the output live in the test. [An example about testing](#an-example-about-testing-may-build-the-double-it-teaches) is the one exception.
- **MUST:** an example receives its API key from the code that calls it. It never hard-codes a key, and it never reads one from an environment variable inside the example's own functions.
- **MUST:** numbers have names (`MAX_STEPS`, `BUDGET_USD`).
- **MUST:** functions are at most 40 lines and files at most 100, stricter than the package limit, because a reader reads the whole file.
- **SHOULD:** handle errors the way an app would: act on an `awaiting_approval` result or an error terminal, and let the rest throw.

## An example about testing may build the double it teaches

A reader who copies an agent example must not copy its test double, so the rule above keeps doubles out. A reader who is learning to test needs to see one, though, so an example whose subject is testing, such as one that shows `ScriptedModel`, may build the double and check that the run used it up. Those lines are the lesson. The other rules still apply, with two changes in how they read:

- **MUST:** its header says that it shows a test double, and it may use the double's name, such as `ScriptedModel`, where the header rule above would otherwise ban test vocabulary.
- **MUST:** a reader could paste it into their own test suite and run it after changing only the names of their own code, in place of the provider config that an agent example asks for.
- **MUST:** it builds only what the run needs: the double, a stub for the reader's own system, such as an order store, and the ids its script needs. A fixed clock appears only when determinism is the lesson.
- **MUST NOT:** it asserts the agent's output or imports a test runner. A test runs the example and checks what it returns, as for every example.
- **MUST:** it still holds one lesson, reads top to bottom, and stays within the length limits.

`packages/sdk/examples/offline-order-agent.ts` is the first such example: it scripts two model answers, stubs the order store, runs the order agent, checks that the script ran out and returns the answer.

## Reviewer checklist

- Does it do one thing, top to bottom?
- Could a reader paste it into their app unchanged apart from the provider config?
- Does it use only public entry points?
- Are the numbers named?
- Does the header say what it shows, in plain words?
- If its subject is testing, does it build only the double it teaches and leave every assertion about the agent to the test?
