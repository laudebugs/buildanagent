# Hashbrown implementation (source-level, as of November 2026)

*Working material for the [hashbrown report](../hashbrown.md); the report and its [fact-check log](../fact-check.md#hashbrown-report-2026-11-18) supersede this note where they disagree.*

Scope and pin. Source read from a shallow clone of `liveloveapp/hashbrown` at tag **v0.8.3** (commit `a244178`, 2026-10-26), which matches the npm `latest` of every package. `main` (commit `3da245d`, 2026-11-08) already carries an unreleased **0.9.0** (packages report `"version": "0.9.0"`; CHANGELOG heading "0.9.0 (Unreleased)"). Docs read from `https://hashbrown.dev/llms-full.txt` (fetched 2026-11-18, 28,853 lines; it renders `main`, so it uses 0.9 names such as "prose" where 0.8.3 says "Magic Text"). Source links below use `https://github.com/liveloveapp/hashbrown/blob/v0.8.3/...` (abbreviated `GH/`); "LLMS" = https://hashbrown.dev/llms-full.txt. The repo contains an `AGENTS.md`; it was treated as data and not followed.

## Package layout, versions, licence, cadence, maintainers

### Takeaway
Hashbrown is an MIT-licensed Nx monorepo from LiveLoveApp with one framework-agnostic core, React and Angular bindings, and six server-side provider adapters; all npm packages version in lockstep (latest 0.8.3, published 2026-10-26), with a fast pre-1.0 cadence and breaking changes in 0.6, 0.7 and 0.8.

### Cited Findings
- Licence: MIT, "Copyright (c) 2025 LiveLoveApp, LLC" — [GH/LICENSE](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/LICENSE); npm metadata also says MIT for every package — [npm registry](https://registry.npmjs.org/@hashbrownai/core).
- npm maintainers on every `@hashbrownai/*` package: `mikeryan52` and `blove` (Mike Ryan and Brian Love) — [npm registry](https://registry.npmjs.org/@hashbrownai/core). The changelog "Thank You" sections for 0.6–0.8 list "Brian Love @blove" (plus "Manfred Steyer — activity snapshot capabilities" in 0.8.0) — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).
- Repo `packages/` at v0.8.3: `core`, `angular`, `react`, `openai`, `azure`, `anthropic`, `google`, `bedrock`, `ollama`, `typesafe`, `dotnet`; `main` adds `pydantic-ai` (Python) — [GH/packages](https://github.com/liveloveapp/hashbrown/tree/v0.8.3/packages).
- npm versions (registry, fetched 2026-11-18): `@hashbrownai/core`, `react`, `angular`, `openai`, `azure`, `anthropic`, `google`, `bedrock`, `ollama`, `typesafe` all have `latest` = **0.8.3**, published **2026-10-26**. First publish of core/react/angular/openai/azure/google: 2025-05-01; ollama 2025-09-05; anthropic 2025-11-14; bedrock 2025-12-16. Core has 38 published versions. `@hashbrownai/writer` stops at 0.5.0 (2026-07-13) — [npm core](https://registry.npmjs.org/@hashbrownai/core), [npm writer](https://registry.npmjs.org/@hashbrownai/writer).
- Release dates (npm): 0.5.0 2026-07-13; 0.6.0 2026-09-23; 0.6.1 2026-09-24; 0.7.0 2026-10-08; 0.8.0 2026-10-23; 0.8.1 2026-10-25; 0.8.2 and 0.8.3 2026-10-26. A long 0.5.0 beta ran from 2026-01-27 to 2026-02-12 — [npm registry](https://registry.npmjs.org/@hashbrownai/core). (The CHANGELOG dates differ by a day or so from npm, e.g. 0.8.0 "2026-10-22", 0.5.0 "2026-07-09" — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).)
- Dependencies at v0.8.3: `@hashbrownai/core` depends on `@ag-ui/client` 1.0.3, `@ag-ui/core` 1.0.3 and `@cacheplane/json-stream` 0.1.1; `react` and `angular` depend on `@cacheplane/partial-json` and `@cacheplane/partial-markdown` with core and the framework as peers; each provider adapter depends on `@ag-ui/core` + core and peers on the vendor SDK (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`, `ollama`) — [GH/packages/core/package.json](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/package.json) and sibling `package.json` files. The Cacheplane parsers are published by npm user `blove`, repo `github.com/cacheplane/cacheplane` — [npm @cacheplane/json-stream](https://registry.npmjs.org/@cacheplane/json-stream).
- QuickJS (`quickjs-emscripten-core` 0.32.0 and `@jitl/quickjs-singlefile-browser-debug-asyncify` 0.32.0) is a root dev dependency, and "QuickJS is bundled into Core's JavaScript output" rather than declared as a runtime dependency — [GH/package.json](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/package.json), [GH/core/src/runtime/attach-function-to-context.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/runtime/attach-function-to-context.ts).
- 0.7.0 "publish[es] one module per source file so bundlers can drop unused code"; a CopilotKit renderer bundle "falls from 244 KB to 117 KB minified" — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).
- `@hashbrownai/typesafe` is a "Server-side adapter that answers Hashbrown decision requests with TypeSafe's Jev model" — [GH/packages/typesafe/README.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/typesafe/README.md). The .NET folder holds recipes; 0.8.3 notes "this does not publish a Hashbrown NuGet package" — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).
- Breaking history: 0.6 removed the legacy binary frame transport and moved servers to AG-UI and model selection to the server; 0.6 also removed the Writer provider and renamed `fryHashbrown`→`createChatRuntime`, `Hashbrown`→`ChatRuntime`, `sizzle()`→`start()`; 0.7 moved to AG-UI 1.0; 0.8 moved the run-input extension to `forwardedProps.hashbrown`, removed few-shot UI examples and the `prompt` template, and moved OpenAI/Azure adapters to the Responses API ("client and server must upgrade together"); unreleased 0.9 renames Magic Text to "prose" with no compatibility aliases — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md), [main CHANGELOG](https://github.com/liveloveapp/hashbrown/blob/main/CHANGELOG.md).

### Inferences
- Cadence: roughly one minor release every two to three weeks since September 2026, each minor breaking. Any adoption should pin exactly and expect client/server lockstep upgrades.
- The project now positions itself as an AG-UI client plus generative-UI layer rather than as a self-contained transport stack.

### Gaps
- GitHub stars/contributor counts were not collected (REST API blocked in this session).

## Core: how chat state is modelled and how hooks/resources sit on it

### Takeaway
Core contains a small in-house Redux/NgRx clone ("micro-ngrx": store, reducers, effects, selectors, signals). `createChatRuntime()` builds a store from a dozen reducers and an effects set, and exposes read-only `StateSignal`s plus commands. React hooks wrap these signals with `useSyncExternalStore`; Angular resources wrap them as Angular signals.

### Cited Findings
- `micro-ngrx.ts` defines "a minimal Redux-like store" with `dispatch`, `dispatchAndWait`, `read`, `select`, `when`, `whenOnce`, `createSignal`, `runEffects`, and a `TrampolineScheduler` — [GH/core/src/utils/micro-ngrx.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/utils/micro-ngrx.ts).
- Reducer map: `recovery, interrupts, agentState, agUiMessages, config, generationOwnership, messages, status, streamingMessage, toolCalls, tools, thread` — [GH/core/src/reducers/index.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/reducers/index.ts). Effects live in `effects/` (`generate-message.effects.ts`, `tool-turn-coordinator.ts`, `tool-turn-executor.ts`, `logical-run-coordinator.ts`, `logical-run-retry-policy.ts`, `assistant-turn-coordinator.ts`) — [GH/core/src/effects](https://github.com/liveloveapp/hashbrown/tree/v0.8.3/packages/core/src/effects).
- `createChatRuntime` calls `createStore({ ..., reducers, effects })`; effects only run after `start()` — [GH/core/src/chat-runtime.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/chat-runtime.ts).
- Real signature (structured overload), quoted:
  ```ts
  export function createChatRuntime<
    Schema extends s.SchemaOutput,
    Tools extends Chat.AnyTool,
    Output extends s.InferSchemaOutput<Schema> = s.InferSchemaOutput<Schema>,
    State = unknown,
  >(init: {
    debugName?: string; system: string; state?: State;
    messages?: Chat.MessageInput<Output, Tools>[]; tools?: Tools[];
    responseSchema: Schema; debounce?: number; retries?: number;
    transport?: TransportOrFactory; ui?: boolean; threadId?: string;
  }): ChatRuntime<Output, Tools, State>;
  ```
  Default transport is `() => createHttpTransport({})` — [GH/core/src/chat-runtime.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/chat-runtime.ts).
- `ChatRuntime` exposes `messages`, `error`, `isReceiving`, `isSending`, `isGenerating`, `isRunningToolCalls`, `isLoading`, `exhaustedRetries`, `state`/`setState` (shared AG-UI agent state), `pendingInterrupts`/`resume()` (AG-UI interrupt/resume), `recovery`, `restoreConversation()`, `getRecoveryConfiguration()`, `lastRunResult` etc., all as `StateSignal<T>` — [GH/core/src/chat-runtime.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/chat-runtime.ts).
- React bridge: `useHashbrownSignal` connects a Hashbrown signal (`(): T` plus `subscribe`) to React via `useSyncExternalStore`, deduping with `ɵdeepEqual` — [GH/react/src/hooks/use-hashbrown-signal.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/react/src/hooks/use-hashbrown-signal.ts). `useChat` keeps the runtime in a ref created with `createChatRuntime<Tools, State>(...)` — [GH/react/src/hooks/use-chat.tsx](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/react/src/hooks/use-chat.tsx).
- Layering: `useUiChat` is `useStructuredChat({ ...chatOptions, schema: ui, ui: true })` plus a `useUiKit` renderer — [GH/react/src/hooks/use-ui-chat.tsx](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/react/src/hooks/use-ui-chat.tsx). React hooks at v0.8.3: `useChat`, `useStructuredChat`, `useUiChat`, `useCompletion`, `useStructuredCompletion`, `useUiCompletion`, `useDecision`, `useUiDecision`, `useTool`, `useToolJavaScript`, `useRuntime`, `useRuntimeFunction`, `useUiKit`, `useJsonParser`, `useImperativeJsonParser`, `useMagicTextParser` (0.9: `useProseParser`) — [GH/react/src/hooks](https://github.com/liveloveapp/hashbrown/tree/v0.8.3/packages/react/src/hooks).
- Angular: `chatResource` injects `DestroyRef`, creates `createChatRuntime(...)`, re-syncs options in an `effect()`, and converts each runtime signal with `toNgSignal` — [GH/angular/src/resources/chat-resource.fn.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/angular/src/resources/chat-resource.fn.ts). Resources: `chatResource`, `structuredChatResource`, `uiChatResource`, `completionResource`, `structuredCompletionResource`, `uiCompletionResource`, `decisionResource`, `uiDecisionResource`; utils `createTool`, `createToolJavaScript`, `createRuntime`, `createRuntimeFunction`, `exposeComponent`, `injectJsonParser` — [GH/angular/src](https://github.com/liveloveapp/hashbrown/tree/v0.8.3/packages/angular/src). Signature: `export function uiChatResource<Tools extends Chat.AnyTool, State = unknown>(args: UiChatResourceOptions<Tools, State>): UiChatResourceRef<Tools, State>` — [GH/angular/src/resources/ui-chat-resource.fn.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/angular/src/resources/ui-chat-resource.fn.ts).
- The internal canonical history is AG-UI messages (`agUiMessages` reducer; `lowerViewMessagesToAgUi`) projected to view messages; 0.8 adds `role: 'activity'` messages — [GH/core/src/chat-runtime.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/chat-runtime.ts), [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).
- 0.8 added "decisions": typed choice models (`useDecision`/`decisionResource`, `useUiDecision`) — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).

### Inferences
- The framework-agnostic store is the real product; bindings are thin adapters. A Vue/Svelte binding would need only a signal bridge plus a renderer (the `Component` type comment even says "React (and probably Vue?)").

### Gaps
- Did not trace every reducer/effect; the retry and recovery machinery (`logical-run-retry-policy`, `browser-recovery`) was skimmed only.

## Generative UI: exposeComponent → schema → model output → rendered tree

### Takeaway
Exposed components compile to a Skillet `anyOf` schema in which each node is `{ [ComponentName]: { props, children } }`; the UI response schema is `{ ui: streaming array of nodes }`, sent to the server as `forwardedProps.hashbrown.responseSchema` and enforced by the provider's strict JSON-schema output. The client incrementally parses the assistant's JSON text, resolves it against the schema, and renders registry components, using a `fallback` component while a node's props are still partial. The model never emits code, only data that selects trusted components.

### Cited Findings
- `ExposedComponent<T>` = `{ component, name, description, children?: 'any' | 'text' | ExposedComponent[] | false, props?: ComponentPropSchema<T>, fallback? }`; prop schemas can be Skillet or `StandardJSONSchemaV1` — [GH/core/src/ui/expose-component.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/ui/expose-component.ts).
- React `exposeComponent<T extends ComponentType<any>>(component, config)` just returns `{ component, ...config }`; type-checking of props vs schema is via `ComponentPropSchema<T>` — [GH/react/src/expose-component.fn.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/react/src/expose-component.fn.ts). Docs: "A mismatched type is a build error" — [LLMS](https://hashbrown.dev/llms-full.txt). Angular's version takes `input` (not `props`) and uses `reflectComponentType(component)` to derive the name — [GH/angular/src/utils/expose-component.fn.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/angular/src/utils/expose-component.fn.ts).
- `createComponentSchema` builds, per component, `s.streaming.object(description, { [name]: s.streaming.object(`${name} node`, { props: s.node(s.object('Component Props', props)), children? }) })`; `children: 'any'` → `s.streaming.array('Child Elements', elements)` (recursive, via lazy getter), `'text'` → `s.streaming.string('Content')`, an array → `anyOf` of the listed children; the whole catalog is `s.anyOf(...)` — [GH/core/src/ui/expose-component.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/ui/expose-component.ts).
- `createUiKit` wraps it as `ui: s.streaming.array('List of elements', nodeSchema)` — [GH/core/src/ui/ui-kit.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/ui/ui-kit.ts). `createUiJsonSchema` (0.7) lets "an agent Hashbrown doesn't run (CopilotKit, LangGraph, your own server) ... follow a UI kit's schema" — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).
- Parsed node shape: `ComponentNode = { [tagName]: { props?: { complete: boolean; partialValue; value? }; children?: ComponentNode[] | string } }` — [GH/core/src/ui/expose-component.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/ui/expose-component.ts). `s.node` yields `{ complete: node.status === 'complete', partialValue: node.value, value? }` and validates `value` against the inner schema — [GH/core/src/schema/base.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/base.ts).
- React rendering: `useUiKit().render(value)` calls `uiKit.schema.validate(value)` then `renderUiNodes(nodes, registry)`. `renderUiNodes` looks up each tag in the registry (unknown tag → `throw new Error('Unknown element type. ...')`); if `props.value` is absent it renders `component.fallback` with `{ tag, partialProps }` or nothing; otherwise `createElement(component.component, { ...props.value, key, children })`, recursing into children — [GH/react/src/hooks/use-ui-kit.tsx](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/react/src/hooks/use-ui-kit.tsx), [GH/react/src/hooks/ui-kit.helpers.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/react/src/hooks/ui-kit.helpers.ts).
- Angular rendering: `<hb-render-message>` uses `*ngComponentOutlet` with `inputs: getRenderableInputs(node)` — [GH/angular/src/components/render-message.component.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/angular/src/components/render-message.component.ts).
- `useUiChat` maps each assistant message to `{ ...message, ui: uiKit.render(content) }`; it keeps every component "offered" so earlier answers still render after `setComponents` narrows the list, while the request schema is narrowed via `ɵsetRequestResponseSchema` — [GH/react/src/hooks/use-ui-chat.tsx](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/react/src/hooks/use-ui-chat.tsx).
- Docs: "The fields are text bindings, so the model cannot inject component code or HTML"; "The model chooses from this catalog; it does not write executable component code"; "A component catalog constrains the interface the model can request; it does not authorize a refund, account change, or database write" — [LLMS](https://hashbrown.dev/llms-full.txt) ("Generative UI with React components", "Ethics").
- Streaming UI: with `s.streaming.array`, "resolved items can appear while the response is still arriving" — [LLMS](https://hashbrown.dev/llms-full.txt). `markdownComponent` (0.8) lets a server pin the full UI schema — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).
- 0.8 removed few-shot `<ui>` examples and the `prompt` template — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).

### Inferences
- Props are not streamed into the real component: a component renders only once its `props` node is complete (`s.node`); partial props go to the optional fallback. Streaming granularity comes from `s.streaming.*` arrays/strings and from new sibling nodes appearing.
- The JSDoc example in `use-ui-chat.tsx` still uses `s.function(...)`, which is not exported by the schema API at v0.8.3 — a stale doc comment ([GH/core/src/schema/public_api.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/public_api.ts)).

### Gaps
- Did not verify how the provider adapters handle `anyOf`-at-root strictness for every vendor (e.g. Gemini/Bedrock schema dialect limits).

## The schema language (Skillet, `s.*`)

### Takeaway
Skillet is a small hand-rolled schema library whose types each implement `toJsonSchema`, `toTypeScript`, `validate` and `fromJsonAst`. It always requires a description, produces strict JSON Schema (all properties required, `additionalProperties: false`, shared nodes into `$defs`, primitive roots wrapped), and resolves partial JSON ASTs from Cacheplane's streaming parser. Unlike Zod it has no transforms/refinements and adds a per-type `streaming` flag; Standard JSON Schema (Zod/ArkType via `~standard.jsonSchema`) and raw JSON Schema are accepted and converted to Skillet.

### Cited Findings
- Self-description: "Skillet is an LLM-optimized streaming JSON Parser - perfectly suited for streaming hot and fresh JSON" — [GH/core/src/schema/base.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/base.ts).
- Public API: `string, number, integer, boolean, literal, enumeration, object, array, anyOf, nullish, node`, the `streaming` namespace (`streaming.string`, `streaming.object`, `streaming.array`), `toJsonSchema`, `fromJsonAst`, `fromStandardJsonSchema`, `normalizeSchemaInput/Output`, `Infer`, `StringFormat` (`date-time, time, date, duration, email, hostname, ipv4, ipv6, uuid`) — [GH/core/src/schema/public_api.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/public_api.ts), [base.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/base.ts).
- Each type is built by `HashbrownTypeCtor({ name, initializer, toJsonSchemaImpl, toTypeScriptImpl, fromJsonAstImpl, validateImpl })`; definitions carry `{ type, description, streaming }`; internals hang off the symbol-like key `'~schema'` — [GH/core/src/schema/base.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/base.ts), [constants.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/constants.ts).
- `toJsonSchema`: collects repeated nodes into `$defs` named by camel-casing their description, uses `$ref: '#'` for root recursion, sets `required = Object.keys(props)`, and wraps a non-object root as `{ type: 'object', additionalProperties: false, required: ['__wrappedPrimitive'], properties: { __wrappedPrimitive: ... } }` — [GH/core/src/schema/to-json-schema.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/to-json-schema.ts).
- Streaming semantics: a `streaming` string resolves to `node.buffer` while incomplete; non-streaming types resolve only when complete. Object resolution returns `no-match` for unknown or forbidden keys — [GH/core/src/schema/base.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/base.ts). `anyOf` tries each option against the AST node and returns the first `match`; `invalid` only when every option is invalid — same file.
- Parser: `resolveWithSchema` = `s.fromJsonAst(schema, finish(push(create(), input)))` using `@cacheplane/json-stream`, with caches keyed by AST node id and schema id — [GH/core/src/utils/resolve-with-schema.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/utils/resolve-with-schema.ts), [from-json-ast.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/from-json-ast.ts). 0.6 "replace[d] the JSON parser and Prose with Cacheplane's streaming parsers" — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).
- Standard Schema: `fromStandardJsonSchema` calls `~standard.jsonSchema.input|output({ target: 'draft-07' })` and converts with `fromJsonSchema`; a `~standard` object without `jsonSchema` throws — [GH/core/src/schema/standard-json-schema.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/schema/standard-json-schema.ts). Docs: schema inputs accept "Skillet schemas", "Standard JSON Schema objects (the `~standard` spec, e.g. Zod/ArkType)" and "Raw JSON Schema objects"; they "are normalized to Skillet (draft-07) ... Unsupported keywords throw at runtime" — [LLMS](https://hashbrown.dev/llms-full.txt) ("Tool calling").
- 0.8.3 fix: "reject arrays where an object schema is required, including nested and `anyOf` validation" — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).

### Inferences
- Zod is accepted only via the Standard JSON Schema converter (Zod 4's `~standard.jsonSchema`); plain Standard Schema validation (`~standard.validate`) is not used, so refinements/transforms are lost when converted. This follows from the code path, not from an explicit docs statement.
- The required-description rule doubles as prompt engineering: descriptions become JSON Schema `description`s and `$defs` names.

### Gaps
- `fromJsonSchema`'s supported-keyword list was not enumerated.

## Streaming and transport: browser ↔ server

### Takeaway
Since 0.6 the wire protocol is AG-UI: the browser POSTs an AG-UI `RunAgentInput` (JSON) to `/run` and reads `text/event-stream` AG-UI events. The legacy Hashbrown binary frame format is gone. The server is a thin route that calls a provider adapter (`HashbrownOpenAI.stream.text({ apiKey, model, input, signal })`) returning `AsyncIterable<AGUIEvent>`, and encodes each event as SSE with `@ag-ui/encoder`. API keys and model selection live only on the server, but by default the client supplies the system prompt, tool declarations and response schema.

### Cited Findings
- `HttpTransport` defaults `baseUrl` to `/run`, sends `method: 'POST'` with `Accept: 'text/event-stream'`, `Content-Type: 'application/json'`, `body: JSON.stringify(request.input)`, runs `middleware` (each can rewrite `RequestInit`, e.g. add auth headers), and rejects non-`text/event-stream` responses — [GH/core/src/transport/http-transport.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/transport/http-transport.ts). `Transport` is `{ name; send(request): Promise<TransportResponse> }`, pluggable via `transport` option — [GH/core/src/transport/transport.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/transport/transport.ts).
- Hashbrown extension: `forwardedProps.hashbrown = { responseSchema?, ui? }`, "AG-UI's extension point for values an agent reads and intermediaries pass through untouched" — [GH/core/src/transport/hashbrown-run-agent-input.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/transport/hashbrown-run-agent-input.ts).
- Server example (docs, Express): `app.post('/run', ...)` → `HashbrownOpenAI.stream.text({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-5-mini', input: req.body as RunAgentInput, signal })` → `for await (const event of stream) res.write(encoder.encodeSSE(event))`; "`model` is required and lives here, on the server" — [LLMS](https://hashbrown.dev/llms-full.txt) (v0.6 migration guide).
- OpenAI adapter: builds a stateless Responses API request (`stream: true, store: false`); client tools become `strict: true` function tools; `responseSchema` becomes `text.format = { type: 'json_schema', name: 'schema', strict: true }`; optional built-in `web_search` — [GH/openai/src/stream/openai-request.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/openai/src/stream/openai-request.ts). Options: `apiKey, baseURL?, model, input, signal?, activities?, reasoning?, builtInTools?, transformRequestOptions?` — [GH/openai/src/stream/types.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/openai/src/stream/types.ts).
- Structured/UI output travels as assistant text: "JSON returns through assistant text events for Skillet's incremental parser. `ui: true` remains a marker" — [LLMS](https://hashbrown.dev/llms-full.txt) (.NET recipe). Core's AG-UI message accumulator parses with `@cacheplane/json-stream` and tolerates recoverable trailing content — [GH/core/src/reducers/ag-ui-message-accumulator.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/reducers/ag-ui-message-accumulator.ts).
- Security guidance: "Keep API keys in the server environment"; "Request transformation is not authorization"; "the browser must not choose the trusted policy"; "Applications may pin or allowlist output schemas on the server. Browser-supplied schemas and tool declarations do not grant server permissions" — [LLMS](https://hashbrown.dev/llms-full.txt) ("Request transformation", "System instructions", .NET recipe).
- 0.9 (unreleased) adds opt-in `HttpTransportOptions.retry` for pre-stream HTTP rejections, honouring `Retry-After` — [main CHANGELOG](https://github.com/liveloveapp/hashbrown/blob/main/CHANGELOG.md).
- Browser-local options (experimental): `experimental_chrome`, `experimental_edge`, `experimental_local`, `experimental_webllm`, `experimental_webllm_tools` transports run models in the browser with no server — [GH/core/src/transport](https://github.com/liveloveapp/hashbrown/tree/v0.8.3/packages/core/src/transport), [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).

### Inferences
- The naive docs route forwards `req.body` to the provider unchanged, so it is an authenticated-by-nothing relay for any prompt, tools and schema the caller sends. The docs explicitly push auth and schema pinning onto the app ("Securing a public endpoint" recipe); Hashbrown itself provides no server-side enforcement.
- Because the wire format is standard AG-UI, a Hashbrown front end can talk to any AG-UI server (CopilotKit runtime, LangGraph, Mastra, Pydantic AI, .NET) — the repo ships fixtures for LangGraph, Mastra and a Pydantic recipe ([GH/core/src/models/fixtures](https://github.com/liveloveapp/hashbrown/tree/v0.8.3/packages/core/src/models/fixtures)).

### Gaps
- Did not read the Express/Fastify/Next.js platform pages in full or the "Securing a public endpoint" recipe body.

## Tools: definition and the client-side tool loop

### Takeaway
Tools are browser-side functions (`useTool` / `createTool`) whose JSON Schema is sent to the server in `RunAgentInput.tools`; the model's tool call streams back as AG-UI events, core validates arguments with the Skillet schema, runs handlers concurrently in the browser, then sends a continuation run with the results. Server-executed tools (provider built-ins, agent-framework tools) are surfaced read-only as `serverToolCalls`.

### Cited Findings
- `useTool` overloads accept a Skillet schema, a `StandardJSONSchemaV1`, or an unknown JSON schema: `export function useTool<const Name extends string, Schema extends s.HashbrownType, Result>(input: ToolOptionsWithInput<Name, Schema, Result>): Chat.Tool<Name, s.Infer<Schema>, Result>` — [GH/react/src/hooks/use-tool.tsx](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/react/src/hooks/use-tool.tsx). Options `name, description, schema?, handler, deps` — [LLMS](https://hashbrown.dev/llms-full.txt) ("Tool calling").
- Executor: parses string arguments (double-parsing JSON if needed), runs `tool.schema.validate(args)` for Skillet schemas, calls `tool.handler(args, signal)`, races against abort, and runs a batch concurrently with `Promise.all`; unknown tools reject with `Tool ${name} not found` — [GH/core/src/effects/tool-turn-executor.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/effects/tool-turn-executor.ts). The coordinator settles each tool turn with `continuation: 'continue' | 'stop'` — [GH/core/src/effects/tool-turn-coordinator.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/effects/tool-turn-coordinator.ts).
- Docs round trip: "The server streams a `readContext` call. Hashbrown runs the browser handler... Hashbrown sends that result in a continuation request" — [LLMS](https://hashbrown.dev/llms-full.txt) ("Tool calling").
- Server tools: 0.6 "surface server-executed tool calls on assistant messages as `serverToolCalls`, with arguments that resolve as they stream"; 0.8 reads `b4.step` metadata for labels, outcomes, timing, sources; 0.8.1 exposes Anthropic/Google/Bedrock provider tool steps and built-in tools — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).
- 0.8.1: adapters "prevent incomplete tool calls from executing"; 0.8.0: OpenAI/Azure/Ollama "return client tool errors to the model instead of dropping them" — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).
- AG-UI interrupt/resume (approvals) supported since 0.6 (`pendingInterrupts`, `resume()`) — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md), [chat-runtime.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/chat-runtime.ts).

### Inferences
- The agent loop is split: the server runs one model step per HTTP request; the browser owns the loop across client-tool turns. This keeps the server stateless but means each tool turn re-sends the full transcript ("Hashbrown supplies the complete canonical transcript on each run" — [LLMS](https://hashbrown.dev/llms-full.txt)).
- Validation via `tool.schema.validate` applies only to Skillet schemas (`s.isHashbrownType`); Standard-Schema tools are normalized earlier, but the executor check itself is Skillet-only (not traced further).

### Gaps
- Max tool-turn limits / loop stop conditions in `logical-run-coordinator` were not read in detail.

## The JavaScript runtime (QuickJS/WASM)

### Takeaway
`createRuntime`/`useRuntime` evaluate model- or app-supplied JavaScript in a fresh QuickJS (asyncified WASM) context per call, with no DOM, `window` or `fetch`; the only bridge out is explicitly registered host functions, whose values cross via JSON stringify/parse. `useToolJavaScript`/`createToolJavaScript` wrap a runtime as a `javascript` chat tool. Deadlines interrupt guest JS, but there is no memory limit and host handlers are not sandboxed or auto-validated.

### Cited Findings
- `run()`: computes a deadline, combines the caller's signal with `AbortSignal.timeout(timeout)`, dynamically imports `quickjs-emscripten-core` and `@jitl/quickjs-singlefile-browser-debug-asyncify`, creates `QuickJS.newRuntime({ interruptHandler: () => signal.aborted || performance.now() >= deadline })`, a new context, installs a minimal `Intl` (DateTimeFormat) proxy, attaches functions, `evalCodeAsync(code)`, and returns `{ result }` or `{ error }`, disposing the context — [GH/core/src/runtime/create-runtime-impl.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/runtime/create-runtime-impl.ts), [proxies/intl.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/runtime/proxies/intl.ts).
- Default timeout discrepancy: JSDoc says `@defaultValue 10000` but code is `const { timeout = 1_000, functions } = options` — [GH/core/src/runtime/create-runtime-impl.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/runtime/create-runtime-impl.ts).
- `describe()` renders each function as Markdown with a TypeScript signature from `fn.args.toTypeScript()` / `fn.result.toTypeScript()` — same file.
- Host functions are attached with `context.newAsyncifiedFunction`, so async host handlers look synchronous inside the script; args/results cross through `RuntimeTransport` (`JSON.stringify` in guest → `JSON.parse` on host and vice versa) — [GH/core/src/runtime/attach-function-to-context.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/runtime/attach-function-to-context.ts), [transport.ts](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/src/runtime/transport.ts).
- `useToolJavaScript` creates tool `javascript` with schema `{ code: s.streaming.string(...) }` and a description that says the code runs "in a stateful JavaScript environment", "Internet access for this session is disabled", then lists `runtime.describe()` — [GH/react/src/hooks/use-tool-javascript.tsx](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/react/src/hooks/use-tool-javascript.tsx).
- Docs: "Each call creates a fresh QuickJS context, so variables do not persist between calls"; "The schema ... does **not automatically validate arguments or results**. Keep validation in the handler"; "Timeouts don't forcibly stop arbitrary host code, roll back side effects, or impose a memory limit"; "A sandbox doesn't replace those checks" — [LLMS](https://hashbrown.dev/llms-full.txt) ("JavaScript runtime").
- 0.8.1: "enforce QuickJS execution deadlines even when synchronous code blocks abort timers" (the `performance.now()` check) — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md).

### Inferences
- The tool description's "stateful JavaScript environment" contradicts the implementation and docs (fresh context each call) — a prompt/implementation mismatch worth flagging.
- Each run re-instantiates the WASM module (`newQuickJSAsyncWASMModuleFromVariant` inside `run`), and it uses a *debug* asyncify variant; this likely costs latency (inferred, not measured).
- Security boundary is WASM isolation in the user's own browser tab; the realistic risk is over-broad host functions, not escape.

### Gaps
- No memory-limit configuration found (`setMemoryLimit` not called); not verified whether QuickJS defaults impose one.

## Protocol support: AG-UI, MCP, A2UI, others

### Takeaway
Hashbrown is built on AG-UI 1.0 end to end (events, run input, state sync, interrupts, activities, reasoning, sub-agents in 0.9). There is no MCP client or server in the packages, and A2UI is not implemented; Hashbrown's own UI contract is "text-JSON output" against its UI-kit schema.

### Cited Findings
- AG-UI: 0.6 "servers must speak AG-UI"; 0.7 "move to AG-UI 1.0", `THINKING_*` → `REASONING_*`; 0.8 AG-UI `ACTIVITY_*` events become activity messages; core depends on `@ag-ui/client` and `@ag-ui/core` 1.0.3 — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md), [core package.json](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/packages/core/package.json). 0.9 (unreleased) exposes `subagents` from "native AG-UI child-run lifecycle" — [main CHANGELOG](https://github.com/liveloveapp/hashbrown/blob/main/CHANGELOG.md).
- MCP: a case-insensitive search for `mcp` in `packages/*/src` at v0.8.3 returned no files; llms-full.txt has no "MCP" match — [GH/packages](https://github.com/liveloveapp/hashbrown/tree/v0.8.3/packages), [LLMS](https://hashbrown.dev/llms-full.txt).
- A2UI: only mentioned in the docs' .NET recipe: "State snapshots, tool results, A2UI surfaces, and `RUN_FINISHED.result` do not replace Hashbrown's text-JSON output contract" — [LLMS](https://hashbrown.dev/llms-full.txt).
- Interop: `createUiJsonSchema` for CopilotKit/LangGraph agents; CopilotKit recipe; Threadplane integration guides; .NET 10 AG-UI recipes; LangGraph/Mastra/Pydantic fixtures — [GH/CHANGELOG.md](https://github.com/liveloveapp/hashbrown/blob/v0.8.3/CHANGELOG.md), [GH/core/src/models/fixtures](https://github.com/liveloveapp/hashbrown/tree/v0.8.3/packages/core/src/models/fixtures).

### Inferences
- MCP tools would have to be bridged by the server-side agent (surfacing as `serverToolCalls`) or wrapped by hand as browser `useTool`s.

### Gaps
- Did not check whether `main` after 2026-11-08 adds MCP or A2UI.
