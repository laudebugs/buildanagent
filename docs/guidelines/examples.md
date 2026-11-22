# Examples readers can copy: public imports, no test scaffolding, always tested

An example is code a reader will paste into their own agent, so it must be code we would merge. These rules apply to every file under `packages/*/examples/` and to every code block a reader-facing page shows ([docs-writing.md](docs-writing.md)). They adapt Lamina PDF's `examples.md`; the SDK's capstone, `packages/sdk/examples/triage-agent.ts` ([SDK plan §5.3](../plans/build-sdk.md#53-the-triage-capstone-checks-the-whole-sdk-against-the-reference-capstones)), is the first example they govern. Two sections below name the only exceptions: [an example about testing](#an-example-about-testing-may-build-the-double-it-teaches) and [a book example](#a-book-example-may-carry-the-plumbing-that-keeps-its-listing-true).

## An example does one thing and is always tested

- **MUST:** a page shows a file from `examples/`, never from `test/`. A test may import an example; an example never imports a test.
- **MUST:** an example does one thing and reads top to bottom. A reader could paste it into an app and run it after changing only the provider config.
- **MUST:** a test runs every example offline, on `ScriptedModel` or a mock transport ([testing.md](testing.md)), and fails when the example stops working.

## An example is written like product code

- **MUST:** the file opens with a comment that says what it shows. The comment mentions no ADR or todo ids, no repository paths and no test vocabulary, except in [an example about testing](#an-example-about-testing-may-build-the-double-it-teaches).
- **MUST:** an example imports only public entry points, such as `@buildanagent/sdk` and `@buildanagent/gateway/anthropic`. It never imports from `src/`, `test/` or another package's files.
- **MUST:** an example holds no test scaffolding. A fixed clock, fixed ids or a scripted model are parameters the test passes in, and checks of the output live in the test. The two exceptions are [an example about testing](#an-example-about-testing-may-build-the-double-it-teaches) and [a book example](#a-book-example-may-carry-the-plumbing-that-keeps-its-listing-true).
- **MUST:** an example receives its API key from the code that calls it. It never hard-codes a key, and it never reads one from an environment variable inside the example's own functions.
- **MUST:** numbers have names (`MAX_STEPS`, `BUDGET_USD`), except [in a book example](#a-book-example-may-carry-the-plumbing-that-keeps-its-listing-true).
- **MUST:** functions are at most 40 lines and files at most 100, stricter than the package limit, because a reader reads the whole file.
- **SHOULD:** handle errors the way an app would: act on an `awaiting_approval` result or an error terminal, and let the rest throw.

## An example about testing may build the double it teaches

A reader who copies an agent example must not copy its test double, so the rule above keeps doubles out. A reader who is learning to test needs to see one, though, so an example whose subject is testing, such as one that shows `ScriptedModel`, may build the double and check that the run used it up. The double and that check are the lesson. The other rules still apply. These rules say how a testing example differs:

- **MUST:** its header says that it shows a test double, and it may use the double's name, such as `ScriptedModel`, where the header rule above would otherwise ban test vocabulary.
- **MUST:** a reader could paste it into their own test suite and run it after changing only the names of their own code, because it has no provider config.
- **MUST:** it builds only what the run needs: the double, a stub for the reader's own system, such as an order store, and the ids its script needs. A fixed clock appears only when determinism is the lesson.
- **MUST NOT:** it asserts the agent's output or imports a test runner.
- **MUST:** a test runs it and checks what it returns, as for every example.
- **MUST:** it still holds one lesson, reads top to bottom, and stays within the length limits.

`packages/sdk/examples/offline-order-agent.ts` is the first such example: it scripts two model answers, stubs the order store, runs the order agent, checks that the script ran out and returns the answer.

## A book example may carry the plumbing that keeps its listing true

The rules above protect a reader who pastes an example into an app. The book reader is different: the book shows only the `// #region` that a chapter lists, and states that the listing is verified code ([book plan BK8](../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted), [ADR 0057](../decisions/0057-book-keeps-third-party-listings-and-adds-ours-as-tabs.md)). That promise holds only if the file fails when the claim it shows stops being true, and only if the book can replay the model exchange the listing describes. A book example may therefore carry the plumbing below, and nothing else the rules above forbid.

A book example is a file under `packages/*/examples/` that a chapter's `::listing` directive names with a `region`, and that the package's `test/book-examples.test.ts` runs: today `packages/gateway/examples/01-text-stream.ts` and `02-stream-usage.ts`, and the numbered `packages/sdk/examples/01-one-call.ts` to `09-stop-triage-output.ts` that a chapter lists. A file no chapter lists, such as `06-tool-failures.ts` or `triage-agent.ts`, follows the rules above in full.

- **MAY:** call `check()` and `scripted()`, both from the package's own `./lib/check.js`. `check(condition, message)` throws when a claim the listing shows is false, and `scripted()` returns a `ScriptedModel` behind `createModel()` so the run is offline.
- **MAY:** rely on the package's `examples/lib/` files, which import the shared recorder (`scripts/transcripts/events.js`). The recorder only reads each request and answer, so the example behaves as it would without it. A book example imports `./lib/check.js` and public entry points, never the recorder directly.
- **MAY:** leave a number inline when its value is the point of the listing and a `// book:note` marker on its line names what it means, as `maxSteps: 5, // book:note cap` does in `03-tool-loop.ts`. A number with no marker still takes a name.
- **MAY:** name the book chapter that lists the file in its header comment.
- **SHOULD:** put a `// book:note` marker on each `scripted()` call inside a listed region, so the page tells the reader that the model is scripted and the reader replaces it with a real one.
- **MUST NOT:** import a test runner or use test-framework globals, so the book examples stay plain programs that `tsx` runs. The package's test spawns each one and fails on a non-zero exit.
- **MUST NOT:** mock, stub or patch the package the example teaches. The model behind it may be scripted, but the gateway's and the SDK's own code runs unmodified, because a stubbed package would verify nothing.
- **MUST NOT:** touch the host: no file, shell, network or environment access beyond what the package's offline setup allows. The setup (`@buildanagent/gateway/testing/setup`, loaded by `lib/check.ts`) blocks non-loopback `fetch` and fails when a provider key is set.
- **MUST:** keep the other rules: public entry points only, one lesson, top to bottom, at most 40 lines a function and 100 a file (the longest book example, `packages/sdk/examples/07-identity-tool.ts`, has 88).

The exception rests on one trade. A reader who copies a book listing may copy a `scripted()` call or a `check()` along with the agent code. The book accepts that cost because the page labels each one with a note and shows a real model beside it, and because a listing that cannot fail is the worse outcome. An example that no chapter lists gets no such trade.

## Reviewer checklist

- Does it do one thing, top to bottom?
- Could a reader paste it into their app unchanged apart from the provider config?
- Does it use only public entry points?
- Are the numbers named?
- Does the header say what it shows, in plain words?
- If its subject is testing, does it build only the double it teaches and leave every assertion about the agent to the test?
- If a chapter lists it, does it use only the book-example plumbing: `check()`, `scripted()`, the `lib/` files and notes for inline numbers, with no test runner, no mock of our own package and no host access?
