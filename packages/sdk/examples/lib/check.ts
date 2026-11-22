// Shared helpers for the book's examples on our own packages: an assertion helper and a scripted model behind
// createModel(). The book lists these examples beside the third-party ones (apps/manual), and
// scripts/transcripts/book-examples.ts runs each one offline and records its transcript.
//
// The offline setup comes first, as in every test under packages/: a set provider key stops the example, and no
// request can leave this machine.
import "@buildanagent/gateway/testing/setup";
import { createModel, type Model } from "@buildanagent/gateway";
import { ScriptedModel, type ScriptStep } from "@buildanagent/sdk/testing";
// Attaches the transcript recorder to ScriptedModel when the test preloads it (scripts/transcripts/).
import { lendCallerLine, recordedSteps, SCRIPTED_MODEL_ID } from "./transcript.js";

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}

/** A `ScriptedModel` that plays back `steps`, one per model call, behind createModel() as a run receives it. */
export function scripted(steps: ScriptStep[]): { adapter: ScriptedModel; model: Model } {
  const script = recordedSteps(steps);
  const adapter = new ScriptedModel(script.steps);
  script.belongsTo(adapter);
  const model = createModel({ adapter, id: SCRIPTED_MODEL_ID });
  return { adapter, model: lendCallerLine(model) };
}

/**
 * Like `scripted()`, but the model reports itself as Anthropic's `claude-sonnet-5-5`, so `createModel()` prices every
 * answer from the shipped catalog. A run with a `budgetUsd` needs that price.
 */
export function pricedScripted(steps: ScriptStep[]): { adapter: ScriptedModel; model: Model } {
  const script = recordedSteps(steps);
  const adapter = new ScriptedModel(script.steps, { ref: { api: "anthropic-messages", provider: "anthropic" } });
  script.belongsTo(adapter);
  return { adapter, model: lendCallerLine(createModel({ adapter, id: "claude-sonnet-5-5" })) };
}
