# Maintainability: one home per concept, small functions, comments that say why

These rules keep `packages/` easy to change as the SDK and harness grow. They adapt Lamina PDF's `maintainability.md`; the rules a tool can check are checked in CI, and the rest are a reviewer's call in each `/code-review` round.

## Every concept has one home

- **MUST:** search the workspace before you write a helper, type or table. If one exists, use it; if it is wrong, fix it where it lives.
- **MUST:** a concept two packages use lives in the lower one. The gateway owns the transcript types and the stream rule, so the SDK imports them and keeps no copy.
- **MUST:** shared test helpers live in a package's `testing` export, and no relative import reaches into another package's files.

## Functions and files stay small

- **MUST:** a function stays within cognitive complexity 15 and 60 lines, as [typescript.md](typescript.md#biome-lints-and-formats-and-caps-each-functions-size) sets out. Split a function that grows past either into named steps instead of exempting it.
- **SHOULD:** a module holds one concept. When a file needs a second heading in its top comment, it is probably two files.

## Each public item has one public path, and shipped code holds no test code

- **MUST:** each exported item is reachable from one entry point only.
- **MUST:** `src/` holds no test hooks, such as `__`-prefixed methods or logs kept for tests. Test doubles that users need, such as `ScriptedModel`, are public API in a `testing` export and are documented like any other export.

## Names and comments explain the code, not its history

- **MUST:** name files and tests for what they do, never for the review or todo that created them.
- **MUST:** comments explain why the code is the way it is: an invariant, a plan decision or a workaround. An internal comment may cite a decision by id (`D3`, `HD15`) or plan section; an exported symbol's TSDoc may not, because users read it ([typescript.md](typescript.md#public-apis-are-designed-as-types-first-and-every-export-is-documented)). Todo ids belong in commit messages and plans, not in `src/`, because a todo is done once and its id stops meaning anything to the next reader.

## Never patch code just to make a test pass

- **MUST:** when a test fails, find out why. Fix the product if it is wrong. If the test checks something that doesn't make sense, change or remove it, and say why in the commit message.
- **SHOULD:** a regression test for a review finding fails on the code before the fix.

## How it's checked

Four root scripts check the rules that a tool can, and `ci.yml` runs each one on every push. A rule that no script covers stays a reviewer's call in each `/code-review` round.

| Script | Tool and config | Fails on |
| --- | --- | --- |
| `pnpm check:deps` | dependency-cruiser, `.dependency-cruiser.json` | An import cycle in `packages/`, or a relative import from one package into another's files. An import by package name, such as `@buildanagent/gateway`, is the one public path and is never flagged |
| `pnpm check:duplicates` | jscpd, `.jscpd.json` | A block of 10 lines or more repeated in any package's `src/`, import lists and `src/vendor/` aside |
| `pnpm check:unused` | knip, `knip.jsonc` | An unused file, export or dependency in `packages/`, with each package's entry points read from its `exports` map |
| `pnpm check:ids` | `scripts/ci/todo-ids.mjs` | A todo id, such as `B4` or `E2a`, in a comment under `packages/*/src`. The ids come from the file names in `docs/todos/`, so a new todo is covered at once and a string such as `T00:00:00Z` never counts |

Three of these skip something on purpose. `check:duplicates` skips import lists, because two files that need the same names must list them, and `src/vendor/`, because the SDK's copies of the safety package are identical by design ([Known gaps](README.md#known-gaps)). `check:unused` leaves an export that only its own file uses to review, and its config names the few files that a path in a config or test loads.

Run a check locally before you push, since a violation fails CI and not only the review. Fix the code rather than widening the config. A new ignore in `knip.jsonc`, `.jscpd.json` or `.dependency-cruiser.json` needs a comment that says why the file is outside the rule, and a reviewer may refuse it.

The tools are exact-pinned dev dependencies of the root package, as the other tools are. dependency-cruiser supports TypeScript up to 6 and the repo uses 7, so it reads TypeScript through `@swc/core`. Without a parser it passes after reading a handful of files. `check:deps` therefore prints the number of modules it cruised, which should be in the hundreds.

