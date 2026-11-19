# Examples readers can copy: public imports, no test scaffolding, always tested

An example is code a reader will paste into their own agent, so it must be code we would merge. These rules apply to every file under `packages/*/examples/` and to every code block a reader-facing page shows ([docs-writing.md](docs-writing.md)). They adapt Lamina PDF's `examples.md`; the SDK's capstone, `packages/sdk/examples/triage-agent.ts` ([SDK plan §5.3](../plans/build-sdk.md#53-the-triage-capstone-checks-the-whole-sdk-against-the-reference-capstones)), is the first example they govern.

## An example does one thing and is always tested

- **MUST:** a page shows a file from `examples/`, never from `test/`. A test may import an example; an example never imports a test.
- **MUST:** an example does one thing and reads top to bottom. A reader could paste it into an app and run it after changing only the provider config.
- **MUST:** a test runs every example offline, on `ScriptedModel` or a mock transport ([testing.md](testing.md)), and fails when the example stops working.

## An example is written like product code

- **MUST:** the file opens with a comment that says what it shows. The comment mentions no ADR or todo ids, no repository paths and no test vocabulary.
- **MUST:** an example imports only public entry points, such as `@buildanagent/sdk` and `@buildanagent/gateway/anthropic`. It never imports from `src/`, `test/` or another package's files.
- **MUST:** an example holds no test scaffolding. A fixed clock, fixed ids or a scripted model are parameters the test passes in, and checks of the output live in the test.
- **MUST:** an example takes its API key from the caller, never from a hard-coded string, and never reads an ambient environment variable inside library calls.
- **MUST:** numbers have names (`MAX_STEPS`, `BUDGET_USD`).
- **MUST:** functions are at most 40 lines and files at most 100, stricter than the package limit, because a reader reads the whole file.
- **SHOULD:** handle errors the way an app would: act on an `awaiting_approval` result or an error terminal, and let the rest throw.

## Reviewer checklist

- Does it do one thing, top to bottom?
- Could a reader paste it into their app unchanged apart from the provider config?
- Does it use only public entry points?
- Are the numbers named?
- Does the header say what it shows, in plain words?
