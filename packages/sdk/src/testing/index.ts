/**
 * `@agent-speak/sdk/testing`: the strict scripted test model and deterministic seams.
 *
 * B18 adds `autoResponder`, seam doubles and record and replay.
 */
export { type Clock, fixedClock, seededRandom, sequentialIds } from "./determinism.ts";
export {
  type AssistantScript,
  type RecordedRequest,
  ScriptedModel,
  type ScriptedModelOptions,
  type ScriptStep,
  UnexpectedModelCallError,
} from "./scripted-model.ts";
