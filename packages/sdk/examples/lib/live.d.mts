// The types of live.mjs, which stays plain JavaScript because it imports scripts/live/live.ts by its .ts path, as the
// live run's Node scripts do, and this package's type-check allows no .ts import path.
import type { Model, ModelAdapter, ModelContext, ModelRef, StreamOptions } from "@buildanagent/gateway";

/** The run's provider and model, without the key, or undefined when the example runs against its script. */
export declare const liveRun: { readonly provider: "anthropic" | "openai"; readonly model: string } | undefined;

/** One call the live model received, as `ScriptedModel.calls` records it. */
export interface LiveCall {
  readonly model: ModelRef;
  readonly context: ModelContext;
  readonly options: Readonly<Pick<StreamOptions, "maxOutputTokens">>;
}

/**
 * The live run's model on our gateway's real adapter, and the calls it received, counted above the gateway's retries.
 * Throws outside a live run. `record` wraps the adapter for the transcript recorder, and `answered(options)` tells it
 * whether the provider answered the attempt that received `options` with a 2xx status.
 */
export declare function liveModel(
  record: (adapter: ModelAdapter, answered: (options: StreamOptions) => boolean) => ModelAdapter,
): {
  model: Model;
  run: { readonly calls: readonly LiveCall[]; assertComplete(): void };
};
