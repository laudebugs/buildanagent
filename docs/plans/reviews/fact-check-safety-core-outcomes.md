# Fact-check: the safety core's outcomes, hash and AI SDK adapter (E1)

This log checks every factual claim about third-party APIs and standards that E1's code, tests and `packages/agent-safety/README.md` rely on, on 2026-11-19. Registry dates come from `https://registry.npmjs.org/<package>` read with curl that day. Type claims come from the `.d.ts` files of the pinned packages installed in this workspace. The standards were read from the RFC Editor's text and the AIP repository's Markdown. A claim backed by a passing test in `packages/agent-safety/test/` says so.

## Pins

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 1 | `ai` 7.0.162 was published on 2026-11-03, so it clears the one-week pin rule on 2026-11-19 | ✅ | npm registry `time["7.0.162"]`: `2026-11-03T01:19:34Z` |
| 2 | `@ai-sdk/provider-utils` 5.0.74 was published on 2026-11-03 | ✅ | npm registry: `2026-11-03T01:20:07Z` |
| 3 | `@ai-sdk/provider` 4.0.35 was published on 2026-10-30 | ✅ | npm registry: `2026-10-30T15:40:29Z` |
| 4 | `zod` 4.6.7 was published on 2026-10-12 | ✅ | npm registry: `2026-10-12T16:29:37Z` |
| 5 | `ai` has moved past the pin: its `latest` is 7.0.177 (2026-11-18), and its newest 7.x release at least a week old is 7.0.171 (2026-11-12) | ✅ | npm registry `dist-tags.latest` and `time`. The package keeps 7.0.162, the version `verify/vercel-ai-sdk` verified, because [ADR 0038](../../decisions/0038-generated-agent-sdk-policy.md) makes a new version a target only after a reference round |
| 6 | `agents` 0.33.0 (2026-11-03) is still the latest release | ✅ | npm registry `dist-tags.latest` and `time["0.33.0"]` |
| 7 | `ai` 7.0.162 declares `zod` (`^3.25.76 \|\| ^4.1.8`) as a required peer, so the package's dev dependencies include `zod` | ✅ | `ai/package.json` `peerDependencies`; it has no `peerDependenciesMeta` |

## The AI SDK's tool results

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 8 | A tool's `toModelOutput` receives `{ toolCallId, input, output }` and returns a `ToolResultOutput` or a promise of one | ✅ | `@ai-sdk/provider-utils` 5.0.74 `dist/index.d.ts`, the `toModelOutput?` member of `Tool` |
| 9 | `ToolResultOutput`'s variants are `text`, `json`, `execution-denied`, `error-text`, `error-json` and `content` | ✅ | Same file, `type ToolResultOutput` |
| 10 | `json` and `error-json` carry a `value` of type `JSONValue`, which accepts readonly arrays and objects | ✅ | Same file; `@ai-sdk/provider` 4.0.35 defines `JSONValue = null \| string \| number \| boolean \| Readonly<JSONObject> \| readonly JSONValue[]` |
| 11 | `MockLanguageModelV4` is exported from `ai/test` | ✅ | `ai/package.json` exports `./test`; `test/ai-adapter.test.ts` imports it **[verified]** |
| 12 | The value `toModelOutput` returns reaches the model's next request as a `tool-result` part, in a `tool` message, whose `output` is that value | ✅ | `test/ai-adapter.test.ts` reads the second request's `prompt` for each of the five kinds **[verified]** |

## Standards behind the hash and the reason code

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 13 | An AIP-193 `reason` "must be at most 63 characters and match a regular expression of `[A-Z][A-Z0-9_]+[A-Z0-9]`" | ✅ | [AIP-193](https://google.aip.dev/193), read from `aip/general/0193.md` in the AIP repository; `writeOutcome()` uses that pattern, anchored |
| 14 | RFC 8785 (JCS) sorts property names recursively by their UTF-16 code units, compared as unsigned integers, and keeps array order | ✅ | [RFC 8785 §3.2.3](https://www.rfc-editor.org/rfc/rfc8785.txt); JavaScript's default `sort()` compares strings by UTF-16 code units, and `test/hash.test.ts` checks a surrogate pair against U+FB33 **[verified]** |
| 15 | JCS serializes literals, strings and numbers as ECMAScript's `JSON.stringify` does | ✅ | RFC 8785 §3.2.2: "This part is identical to that of ECMAScript" |
| 16 | JCS must reject NaN, Infinity and lone surrogates | ✅ | RFC 8785 §3.2.2.2 and §3.2.2.3; `test/hash.test.ts` checks all three **[verified]** |
| 17 | RFC 8785's sample object canonicalizes to `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}` | ✅ | RFC 8785 §3.2.2 gives the serialized primitives; the sorted key order follows §3.2.3. `test/hash.test.ts` hashes the parsed sample against that string **[verified]** |
| 18 | `String.prototype.isWellFormed()` is part of ES2024, so `src/` may call it under the packages' `es2024` lib | ✅ | `pnpm typecheck` passes with `lib: ["es2024"]`; Node 22 runs the lone-surrogate test **[verified]** |
| 19 | Cloudflare Workers support `crypto.subtle.digest("SHA-256", …)` | ✅ | [Cloudflare Web Crypto docs](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), which list `SHA-256` among the digest algorithms. The workerd run of the package's tests is E7's |

## Tooling the package works around

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 20 | `eventsource-parser` 3.1.1, which `@ai-sdk/provider-utils` imports, ships a `source` export condition that points at `src/*.ts`, and those files import `.ts` specifiers | ✅ | Its `package.json` `exports` and `src/parse.ts` line 5 (`from './errors.ts'`) |
| 21 | Under our `source` condition, TypeScript reads those files and reports TS5097 unless `allowImportingTsExtensions` is on | ✅ | `pnpm --filter @buildanagent/agent-safety typecheck` before and after the setting in `tsconfig.json` |
| 22 | Vitest's native loader resolves externalized dependencies with our `source` condition, and Node 22 then refuses with "Stripping types is currently unsupported for files under node_modules" | ✅ | The error from `vitest run` before `server.deps.inline` listed `ai`, `@ai-sdk/*` and `eventsource-parser` |
| 23 | With pnpm's default `auto-install-peers`, listing `agents` as an optional peer made pnpm install it into the package and record it under `dependencies` in `pnpm-lock.yaml` | ✅ | Observed with pnpm 10.34.9 on 2026-11-19; `agents` therefore joins the peers with the first `./agents` adapter instead |
