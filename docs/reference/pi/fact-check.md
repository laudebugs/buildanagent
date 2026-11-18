# Pi's docs match its 1.5.2 package, but the live site runs ahead of the release

A developer who copies an example from Pi's docs needs it to compile and run against the release npm installed. To test that promise, I checked Pi's docs at git tag `v1.5.2` against `@earendil-works/pi-coding-agent`, `pi-agent-core` and `pi-ai` at 1.5.2. The docs cover 43 pages in `packages/coding-agent/docs`, three package READMEs and the 99 upstream example files they link to. Four automated tiers did the checking: type-checks, offline runs, an API-surface diff and behavioral tests. All of them live in [`verify/pi/`](../../../verify/pi/), with raw output in `verify/pi/results/`. The reference pages passed: settings, session entries, RPC commands and extension events match the package exactly, all 99 upstream example files compile, and every behavior we tested held. The problems I found are small: six errors in README code blocks, three undocumented details, and a default-model gotcha. The most consequential is the docs site, which serves unreleased changes as "latest".

## Reproduce the checks in three commands

```bash
pnpm install              # at the repo root: installs every harness
cd verify/pi
pnpm run fetch-docs       # mirror the docs from tag v1.5.2 (committed; MIT)
pnpm run verify           # extract -> type-check -> run docs examples -> API diff -> our tests
```

## Tier 1: all 99 upstream examples compile, and 6 README blocks have real errors

I compiled 334 TypeScript sources on their own against the pinned packages, with `tsc` 7 in strict mode and the repo's ES2024 target (`scripts/typecheck-examples.mjs`). The sources were 235 Markdown code blocks from 16 pages plus the 99 upstream example files. Extension code, 149 sources in all, compiles against a shim of the "extension view" of `pi-ai` that Pi supplies to extensions at run time (`verify/pi/shims/`). Because pnpm resolves only declared dependencies, the harness also declares `typebox`, `@earendil-works/pi-tui`, `pi-schema` and `pi-telemetry`, which Pi provides to extensions or the READMEs import. With that setup, the upstream example files came through clean, and every API error sat in a Markdown block:

| Source | pass | fragment | syntax | api-mismatch |
|---|---|---|---|---|
| Upstream example files (99) | 96 | 3 | 0 | 0 |
| Markdown code blocks (235) | 41 | 167 | 20 | 7 |

Here a *fragment* uses names defined elsewhere on its page or in the example's own dependencies, and a *syntax* block is an intentional partial snippet. Of the seven mismatches, one is a placeholder: `pi-ai-README.md:826` elides a function body with `/* ... */`. The other six are real errors (finding F2).

## Tier 2: 16 of 20 complete examples ran offline, and none failed

I ran every complete, type-clean block and every upstream SDK program, 20 in all (`scripts/run-examples.mjs`). Each one ran unmodified under a preload (`scripts/faux-preload.mjs`) that registers pi-ai's faux provider in every `ModelRuntime`. Each run also got a temp working directory, a temp `PI_CODING_AGENT_DIR` whose settings select the faux model, an allowlisted environment, and a network guard that rejects any non-local `fetch`:

| Outcome | Count | Notes |
|---|---|---|
| ran, model answered | 6 | Includes a real tool call through the faux model |
| ran, no model call | 10 | Configure sessions without prompting (for example `examples/sdk/04-skills.ts`), or script their own faux responses |
| skipped | 4 | Need a real provider: three README blocks call `createModels()` with real providers such as Anthropic's, and `examples/sdk/12-full-control.ts` needs `MY_ANTHROPIC_KEY` |
| error | 0 | — |

This tier has one deliberate limit. The faux model calls custom tools and the read-only `read` tool on a fixture, but never `bash`, `edit` or `write`, so docs code can't change the host. A pass therefore shows that a configuration loads and the loop completes; it doesn't show that the built-in tools behave as described.

## Tier 3: the reference pages match the package's types

A script compares each reference page with the matching declaration or schema in the package (`scripts/factcheck-api.mjs`). Four of the six surfaces match exactly, and the other two differ only by undocumented items:

| Surface | Docs | Package | Differences |
|---|---|---|---|
| Session entry types (`session-format.md` vs `SessionEntry`) | 11 | 11 | None |
| RPC commands (`rpc-commands.md` vs `RpcCommand`) | 33 | 33 | None |
| Extension events (`extensions.md` vs `pi.on()` overloads) | 41 | 41 | None |
| `AgentSession` members named in `sdk.md` | 13 | 95 | None missing; the rest are undocumented in `sdk.md` by design, which points readers to the declarations |
| Settings (`settings.md` vs `settings.schema.json`) | 54 | 60 | Six undocumented keys, all legitimately so: `queueMode` and `websockets` are deprecated (migrated to `steeringMode` and `transport`), and `deviceId`, `trackingId`, `lastChangelogVersion` and `extensionChangelogVersions` are internal state |
| `createAgentSession()` options (`sdk.md` vs `CreateAgentSessionOptions`) | 12 | 14 | `agentDir` and `sessionStartEvent` are undocumented (F3) |

The documented compaction defaults also match the schema: `reserveTokens` 16,384 and `keepRecentTokens` 20,000.

## Tier 4: every behavioral claim we tested held

Eight programs in `verify/pi/examples/` assert documented behavior against the faux model, and all eight pass:

| Claim (doc page) | Test | Result |
|---|---|---|
| A default session has four tools: `read`, `bash`, `edit`, `write` (how-pi-works, sdk) | 01 | ✅ |
| `prompt()` resolves after the run, and `agent_settled` marks that Pi won't continue (sdk) | 01 | ✅ |
| `customTools` adds tools whose `execute()` receives the model's arguments (sdk, extensions) | 02 | ✅ |
| `tools`, `excludeTools` and `noTools` control the active set (sdk) | 03 | ✅ |
| An inactive tool call becomes an error result and the loop continues (how-pi-works) | 03 | ✅ "Tool ls not found" |
| `prompt()` mid-run without a choice rejects; `steer()` and `followUp()` return `"queued"` (sdk) | 04 | ✅ |
| Steering enters after the current turn, follow-ups after the run (sdk, how-pi-works) | 04 | ✅ Order: prompt, steer, follow-up |
| Branching keeps abandoned paths in the same session tree (how-pi-works, sessions) | 05 | ✅ |
| Compaction appends a summary entry and keeps the originals (compaction, how-pi-works) | 06 | ✅ |
| A split user-message span gets two summaries, merged (compaction) | 06 | ✅ |
| A `tool_call` handler returning `{ block: true }` stops execution (extensions) | 07, 08 | ✅ |
| `terminate: true` ends the run without an extra model turn (examples/extensions/structured-output.ts) | 08 | ✅ |

## Six findings: one site issue, two home-folder and credential defaults, and three doc gaps

**F1. docs.pi.dev/latest serves the main branch, not the latest release.** Six pages on the live site already describe changes made after v1.5.2: `extensions.md`, `models-configuration.md`, `nvidia-rtx-llama-cpp.md`, `providers.md`, `rpc-commands.md` and `tui.md`. For example, the site lists four `QWEN_TOKEN_PLAN_*` variables (team and individual), while v1.5.2 documents two. A reader on the npm release can therefore follow "latest" docs into behavior their package lacks. Read the docs at the git tag that matches your installed version.

**F2. Six README code blocks fail to compile under strict TypeScript.**
- `pi-ai-README.md:1901` and the quick reference in `examples/sdk/README.md:35` import `getModel` and `complete` from `@earendil-works/pi-ai`. In 1.5.2 those deprecated helpers exist only in `@earendil-works/pi-ai/compat` and in the extension view. At run time, both are `undefined` on the main entry.
- The same quick reference builds `DefaultResourceLoader` without `cwd` and `agentDir`, which `DefaultResourceLoaderOptions` requires.
- `agent-core-README.md:538` and the faux example at `pi-ai-README.md:1499` declare messages as untyped object literals, so `role` widens to `string` and the calls reject them. Adding a type annotation or `as const` fixes both.
- `examples/extensions/README.md:146` reads `event.input.command` without the `isToolCallEventType("bash", event)` narrowing that `extensions.md` itself uses.
- `pi-ai-README.md:112` passes `call.arguments.timezone`, typed `unknown`, to `toLocaleString()` without a cast.

**F3. Two `createAgentSession()` options are missing from `sdk.md`.** `agentDir` is the "Global config directory" (default `~/.pi/agent`), and `sessionStartEvent` carries "Session start event metadata for extension runtime startup". Both appear only in the JSDoc of `CreateAgentSessionOptions`.

**F4. An unconfigured session can pick up ambient cloud credentials.** The documented defaults combine into a surprise. `createAgentSession()` picks the model "from settings or first available" (`examples/sdk/01-minimal.ts`), and Bedrock and Vertex AI "can also use ambient cloud credentials" (`providers.md`). On our cloud host, the first harness run therefore sent an upstream example to Amazon Bedrock, where AWS rejected the token. No page warns about this combination. Production code should pass `model` and `modelRuntime` explicitly.

**F5. The docs omit that extensions also get pi-ai's deprecated compat helpers.** The "Available Imports" table in `extensions.md` documents part of the difference. Inside Pi, it says, `@earendil-works/pi-ai` also exports TypeBox's `Type`, `Static` and `TSchema`, which the published package no longer re-exports. The extension view also re-exports the whole compat entry, including the deprecated `getModel()` and `complete()` (`pi-ai-extension-view.ts`). The table leaves that part out. Code that calls those helpers inside an extension works, but the same code in an SDK program fails, which is how the README errors in F2 arise.

**F6. `ModelRuntime.create()` writes to `~/.pi` even when every manager is in memory.** Its `authPath` defaults to `auth.json` under the agent directory, which it creates, and its `modelsPath` defaults to `models.json` there, which it reads (`dist/core/model-runtime.d.ts`). A fresh agent building from our Pi skill found this on 2026-11-18: with in-memory session and settings managers and an explicit resource loader, `~/.pi/agent/auth.json` still appeared. Our harness never noticed, because its runner sets `PI_CODING_AGENT_DIR` to a temp folder. Pass `authPath` and `modelsPath: null` to embed Pi without touching the home folder.

*Correction, 2026-11-18:* the first version of the guide said in-memory managers and an explicit resource loader "keep `~/.pi` out of the run" (§4, §14). F6 shows they don't, and both sections now name the `ModelRuntime` options. The test helper `examples/lib/faux.ts` and example 04 now pass them too.

## Verdict: trust the reference pages, and read the docs at your release tag

Pi's reference pages are exact. Settings, session entries, RPC commands and extension events match the 1.5.2 package one for one, and the 99 upstream example files compile. The behaviors we tested, from steering order to split-span compaction, work as written. The errors cluster in README quick-reference snippets, so copy from the `examples/` folder rather than from README code blocks. Read the docs at the tag that matches your installed version instead of docs.pi.dev/latest, and pin your model explicitly. With those habits, a team can build on Pi's documentation as written, and `pnpm run verify` will catch drift at the next upgrade.
