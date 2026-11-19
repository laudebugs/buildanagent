# Testing: offline, strict and deterministic

Every test in `packages/` runs offline, drives a strict test double instead of a real model, and produces the same result on every run. These rules make that true and say which seam each kind of test uses. They follow the SDK plan's test strategy ([§5](../plans/build-sdk.md#5-test-strategy)) and the harness plan's conformance suite ([ADR 0033](../decisions/0033-three-deployment-targets.md)).

## Every test starts from the shared setup

- **MUST:** every package's `vitest.config.ts` lists `./test/setup.ts` in `setupFiles`, and that file imports `@buildanagent/gateway/testing/setup`, so the setup runs before each test file. The import goes through a file because Vitest resolves a bare `setupFiles` entry when it loads the config, with Node's default conditions instead of `source`, so it would load `dist/`, or fail every test file before a build. The book's `apps/manual/vitest.config.ts` and `test/setup.ts` follow the same rule. The root `vitest.config.ts` lists `apps/*` and `packages/*` as projects, so a run started from the repo root uses those same configs. The setup makes `fetch` throw for any host other than loopback, fails the run if `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, and calls `allowModelRequests(false)`, so any adapter whose transport is not a marked mock throws before it sends.
- **MUST:** tests use Vitest ([ADR 0046](../decisions/0046-vitest-test-runner.md)), importing `test` from `vitest` and asserting with `node:assert/strict`, with one behaviour per `test()` and a name that states it ("an error terminal with partial content passes").
- **MUST NOT:** spawn third-party code with `...process.env`. A test that must spawn uses an allowlisted environment ([AGENTS.md](../../AGENTS.md#coding-standards)).

## Pick the seam by what the test is about

| What you test | Seam | Why |
| --- | --- | --- |
| The loop, tools, hooks, pauses, budgets | `ScriptedModel` through `createModel` | It is strict: an over-run throws `UnexpectedModelCallError`, and `assertComplete()` in teardown catches an under-run |
| An adapter's wire format | `mockTransport()` with wire fixtures | It replays real chunk splits without a socket |
| An end-to-end HTTP path | `startMockServer()` | It binds to 127.0.0.1 only |
| A portable seam (store, lock, scheduler, key store, sandbox, egress) | the conformance suite, run against every target's implementation | One suite defines what "works on Cloudflare, AWS and Vercel" means |
| A stream from anything | `assertStreamContract()` | It checks the stream rule every adapter and test model must keep |

## Tests are deterministic

- **MUST:** take time, ids and randomness from the injected `clock`, `idGenerator` and `random`, using `fixedClock()`, `sequentialIds()` and `seededRandom()` in tests. Nothing in `src/` reads `Date.now()` or `Math.random()` directly.
- **MUST:** the same script, clock and ids produce a deep-equal event log on a second run; the SDK's determinism test checks it.

## A test proves the behaviour, including the failure paths

- **MUST:** a guarantee that holds across a crash or a retry has a test that crashes or retries: a write killed between saving its key and running must report `unknown` and never run twice.
- **SHOULD:** a type rule gets a type test. A `@ts-expect-error` line, or a conditional type assigned to a literal, makes `pnpm typecheck` fail when the rule breaks.
- **SHOULD:** a test for a review finding fails on the code before the fix ([maintainability.md](maintainability.md#never-patch-code-just-to-make-a-test-pass)).

Model quality, instruction following and tool choice belong to the harness's evals, which run a real model against the mini-swe-agent baseline; unit tests check only our code's behaviour.
