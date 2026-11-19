/**
 * `@buildanagent/sdk/testing`: everything a test needs to drive an agent offline. The strict `ScriptedModel` and
 * `autoResponder()` stand in for the model, `scriptedApprovals()` and `scriptedMcpServer()` for the approval and MCP
 * seams, `testSigner()` signs reproducible pauses, `recordPairs()` and `replayPairs()` record a real model once and
 * replay it, and `fixedClock()` and `sequentialIds()` keep the run deterministic.
 */

export { TEST_KEY_ID, testSigner } from "../vendor/agent-safety/testing.js";
export {
  type AutoResponderOptions,
  autoResponder,
  DEFAULT_DENIED_TOOLS,
  synthesizeInput,
} from "./auto-responder.js";
export { type Clock, fixedClock, sequentialIds } from "./determinism.js";
export {
  type RecordedPair,
  type Recorder,
  RecordingError,
  type RecordingErrorCode,
  type RecordingStamp,
  type RecordOptions,
  recordPairs,
} from "./recording.js";
export { type ExpectedStamp, ReplayModel, type ReplayOptions, replayPairs } from "./replay.js";
export { type ScriptedAnswer, type ScriptedApprovals, scriptedApprovals } from "./scripted-approvals.js";
export {
  type ScriptedMcpCall,
  type ScriptedMcpServer,
  type ScriptedMcpServerOptions,
  type ScriptedMcpTool,
  type ScriptedToolStep,
  scriptedMcpServer,
} from "./scripted-mcp.js";
export {
  type AssistantScript,
  type RecordedRequest,
  ScriptedModel,
  type ScriptedModelOptions,
  type ScriptStep,
  type StreamScript,
  UnexpectedModelCallError,
} from "./scripted-model.js";
