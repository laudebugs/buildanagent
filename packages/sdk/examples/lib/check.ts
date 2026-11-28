// Shared helpers for the book's examples on our own packages: an assertion helper and a scripted model behind
// createModel(). The book lists these examples beside the third-party ones (apps/manual), and
// scripts/transcripts/book-examples.ts runs each one offline and records its transcript.
//
// The live mode comes first, because it keeps the process's own fetch before the offline setup replaces it; without a
// live run it does nothing (live.mjs). The offline setup follows, as in every test under packages/: a set provider key
// stops the example, and no request but a live run's own can leave this machine.
import { liveModel, liveRun } from "./live.mjs";
import "@buildanagent/gateway/testing/setup";
import { createModel, type Model } from "@buildanagent/gateway";
import { ScriptedModel, type ScriptStep } from "@buildanagent/sdk/testing";
// Attaches the transcript recorder to ScriptedModel when the test preloads it (scripts/transcripts/).
import { lendCallerLine, recordedLiveAdapter, recordedSteps, SCRIPTED_MODEL_ID } from "./transcript.js";

// #region check
export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); // book:note fail
  console.log(`ok - ${msg}`); // book:note ok
}
// #endregion

/** What the examples read of a scripted model: the requests it received, and the check that its script played out. */
export type ScriptedRun = Pick<ScriptedModel, "calls" | "assertComplete">;

/**
 * A `ScriptedModel` that plays back `steps`, one per model call, behind createModel() as a run receives it. In a live
 * run (scripts/live/), the model is our gateway's real adapter for the run's provider instead, and `steps` go unused.
 */
export function scripted(steps: ScriptStep[]): { adapter: ScriptedRun; model: Model } {
  if (liveRun !== undefined) {
    const { model, run } = liveModel(recordedLiveAdapter);
    return { adapter: run, model: lendCallerLine(model) };
  }
  const script = recordedSteps(steps);
  const adapter = new ScriptedModel(script.steps);
  script.belongsTo(adapter);
  const model = createModel({ adapter, id: SCRIPTED_MODEL_ID });
  return { adapter, model: lendCallerLine(model) };
}

/**
 * Like `scripted()`, but the model reports itself as Anthropic's `claude-sonnet-5-5`, so `createModel()` prices every
 * answer from the shipped catalog. A run with a `budgetUsd` needs that price. `id` names another catalog model, such as
 * `claude-haiku-5-5`, for an example that runs two models.
 */
export function pricedScripted(
  steps: ScriptStep[],
  id = "claude-sonnet-5-5",
): { adapter: ScriptedModel; model: Model } {
  const script = recordedSteps(steps);
  const adapter = new ScriptedModel(script.steps, { ref: { api: "anthropic-messages", provider: "anthropic" } });
  script.belongsTo(adapter);
  return { adapter, model: lendCallerLine(createModel({ adapter, id })) };
}
