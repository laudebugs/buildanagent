# Copilot SDK: TypeScript parity draft (S8a)

Draft input for the TypeScript gap report (todo C5) and the S8b fact-check. Checked 2026-11-18 against `@github/copilot-sdk@1.0.31` (`dist/*.d.ts`) and the other languages' READMEs in the mirror at tag `v1.0.31` (`docs/reference/copilot-sdk/source/`).

## Verdict: TypeScript is a first-class SDK, not a port

All six SDKs (Node.js/TypeScript, Python, Go, .NET, Java, Rust) live in one repository and drive the same Copilot runtime over the same JSON-RPC protocol (source `README.md`, "Architecture"). The root README lists Node.js/TypeScript first, and shared features are documented for all six at once, for example installation confirmation ("All six SDKs … provide this receiver with the same semantics", `nodejs/README.md` and `rust/README.md`) and sub-agent hooks (`docs/features/fleet-mode.md`). The language policy's usual worry, a TypeScript port trailing a Python primary, does not apply here. The gaps below are small and come almost entirely from Rust's language-specific extras.

## Features the TypeScript SDK lacks or has in a weaker form

| Feature | Where it exists | TypeScript 1.0.31 | Evidence |
|---|---|---|---|
| Connect over caller-supplied streams (custom transport, test doubles) | Rust: `Client::from_streams(reader, writer, cwd)` | Absent: `RuntimeConnection` offers only `forStdio`, `forTcp`, `forUri` and `forInProcess` | `rust/README.md` "Externally supplied streams" and "Rust-only API" ("Other SDKs are spawn-only or fixed-stdio"); `dist/types.d.ts` `RuntimeConnection` |
| Permission policy builders (`deny_all`, `approve_if(predicate)`) | Rust: `permission::approve_all`, `deny_all`, `approve_if`; `SessionConfig::approve_all_permissions()` | Weaker: only `approveAll` (and `defaultJoinSessionPermissionHandler`); deny-all and predicate policies need a hand-written handler | `rust/README.md` "Permission Policies" and "Rust-only API"; no `denyAll`/`approveIf` in `dist/*.d.ts` |
| Separate prepend/append CLI argument lists | Rust: `prefix_args` / `extra_args` | Weaker: one `args` list on `forStdio`/`forTcp`, placed before the SDK's own flags | `rust/README.md` "Rust-only API"; `dist/client.js` `startCLIServer` (`[...connectionExtraArgs, "--headless", …]`) |
| Explicit transport enum | Rust: `enum Transport { Default, Stdio, InProcess, Tcp, External }` | Equivalent in practice: the `RuntimeConnection` factories (the Rust README's "conditional config field combinations" describes older SDKs) | `rust/README.md` "Rust-only API"; `dist/types.d.ts` |
| Typed `SessionId`/`RequestId` newtypes | Rust | Bare strings (language idiom, not a functional gap) | `rust/README.md` "Rust-only API" |
| Observe events before a session starts | Rust: `prepare_session` / `prepare_resume_session` | Equivalent: `SessionConfig.onEvent` registers before `session.create` | `rust/README.md`; `dist/types.d.ts` `onEvent` JSDoc |

## Features TypeScript has that others document differently (not gaps)

- **Runtime packaging.** Node bundles the runtime in an optional per-platform npm package (no download at start); Python downloads it on first use or with `python -m copilot download-runtime`; Go needs its bundler tool; Java needs a runtime classifier JAR; Rust bundles it behind the `bundled-cli` feature (source `README.md` "Getting Started"; `python/README.md` "Runtime").
- **Tool definition idioms.** Java's annotation-based and lambda tools, Go's `DefineTool` and struct tools, and Python's Pydantic-free low-level API are language idioms; TypeScript's `defineTool` with Zod or raw JSON Schema covers the same ground.

## Open items for S8b

- Compare the generated RPC surfaces (`dist/generated/rpc.d.ts` against the Python and Go generated clients) method by method; the README comparison above can't see experimental RPCs that only one language documents.
- Check whether the Rust-only items are planned for the other SDKs ("cross-SDK parity for these is a post-release conversation", `rust/README.md`).
