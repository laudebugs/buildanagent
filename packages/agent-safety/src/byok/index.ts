/**
 * `@buildanagent/agent-safety/byok`: model calls on the user's own key with no silent fallback, for the Vercel AI SDK.
 * `explicitProvider()` builds `@ai-sdk/anthropic` and `@ai-sdk/openai` providers from a key and base URL the caller
 * passes, behind `egressGuard()`, and `assertNoDefaultProvider()` makes string model ids fail. This subpath imports
 * both provider packages, which are optional peer dependencies.
 *
 * @module @buildanagent/agent-safety/byok
 */
export { assertNoDefaultProvider } from "./default-provider.js";
export { type ExplicitProviderName, type ExplicitProviderOptions, explicitProvider } from "./explicit-provider.js";
