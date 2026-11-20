/**
 * The AI SDK's provider-level types, read off the `LanguageModelMiddleware` that `ai` exports, so this subpath needs
 * no peer dependency beyond `ai` itself. They are the `@ai-sdk/provider` 4.x types `ai` 7.0.162 builds on.
 */
import type { LanguageModelMiddleware } from "ai";

type WrapGenerate = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;
type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;

/** The options one provider request carries: `LanguageModelV4CallOptions`. */
export type CallOptions = Parameters<WrapGenerate>[0]["params"];
/** The model a middleware wraps: `LanguageModelV4`. */
export type InnerModel = Parameters<WrapGenerate>[0]["model"];
/** What `doGenerate` resolves to: `LanguageModelV4GenerateResult`. */
export type GenerateResult = Awaited<ReturnType<WrapGenerate>>;
/** What `doStream` resolves to: `LanguageModelV4StreamResult`. */
export type StreamResult = Awaited<ReturnType<WrapStream>>;
/** One part of a model's stream: `LanguageModelV4StreamPart`. */
export type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
/** The prompt one request sends: `LanguageModelV4Prompt`. */
export type Prompt = CallOptions["prompt"];
/** One message of a prompt: `LanguageModelV4Message`. */
export type PromptMessage = Prompt[number];
/** A response's token counts: `LanguageModelV4Usage`. */
export type ModelUsage = GenerateResult["usage"];
/** A tool one request offers: `LanguageModelV4FunctionTool` or `LanguageModelV4ProviderTool`. */
export type CallTool = NonNullable<CallOptions["tools"]>[number];
