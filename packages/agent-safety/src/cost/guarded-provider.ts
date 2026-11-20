/**
 * `guardedProvider()` and `guardedModel()`: apply cost guards to every language model of a provider, or to one model.
 * A model that never passes through a guard escapes its cap, so build every model a run uses, the ones `prepareStep`
 * switches to included, from one guarded provider.
 */
import { type LanguageModelMiddleware, wrapLanguageModel, wrapProvider } from "ai";

/** A provider the AI SDK accepts: a `ProviderV4`, `ProviderV3` or `ProviderV2`. */
export type GuardableProvider = Parameters<typeof wrapProvider>[0]["provider"];
/** A provider whose language models all run through the guards: a `ProviderV4`. */
export type GuardedProvider = ReturnType<typeof wrapProvider>;
/** A language model the AI SDK accepts: a `LanguageModelV4`, `LanguageModelV3` or `LanguageModelV2`. */
export type GuardableModel = Parameters<typeof wrapLanguageModel>[0]["model"];
/** A language model wrapped in guards: a `LanguageModelV4`. */
export type GuardedModel = ReturnType<typeof wrapLanguageModel>;

type Guards = LanguageModelMiddleware | readonly LanguageModelMiddleware[];

/**
 * The provider with `guards` around each language model it returns, through the AI SDK's `wrapProvider()`. Pass
 * several guards, such as a per-run and a per-session `costGuard()`, and a call goes out only when every guard allows
 * it. Call its `languageModel(id)` for each model; embedding, image and other models pass through unguarded.
 */
export function guardedProvider(provider: GuardableProvider, guards: Guards): GuardedProvider {
  return wrapProvider({ provider, languageModelMiddleware: [guards].flat() });
}

/** One model with `guards` around it, through the AI SDK's `wrapLanguageModel()`. */
export function guardedModel(model: GuardableModel, guards: Guards): GuardedModel {
  return wrapLanguageModel({ model, middleware: [guards].flat() });
}
