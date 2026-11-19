/**
 * `@buildanagent/sdk/testing`: the strict scripted test model and deterministic seams.
 *
 * `autoResponder`, seam doubles and record and replay are planned here (SDK plan §3.3).
 */
export { type Clock, fixedClock, sequentialIds } from "./determinism.ts";
export {
  type AssistantScript,
  type RecordedRequest,
  ScriptedModel,
  type ScriptedModelOptions,
  type ScriptStep,
  UnexpectedModelCallError,
} from "./scripted-model.ts";
