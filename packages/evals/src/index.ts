/**
 * `@buildanagent/evals`, the buildanagent evals: reports that pair pass rates with cost, mini-swe-agent trajectories
 * and the rows an offline replay checks.
 *
 * @module @buildanagent/evals
 */
export { type Discordance, discordance } from "./discordance.js";
export { EvalsError, type EvalsErrorCode, isEvalsError } from "./errors.js";
export { type EvalRowMeta, toEvalRow } from "./from-entries.js";
export {
  type EvalReport,
  type HarnessReport,
  type OutcomeCounts,
  type PerTask,
  type ReportOptions,
  report,
} from "./report.js";
export type { EvalExit, EvalRow, UnscoredReason } from "./row.js";
export type { Interval } from "./stats.js";
export {
  MINI_SWE_TRAJECTORY_FORMAT,
  type MiniSweAssistantMessage,
  type MiniSweExitMessage,
  type MiniSweMessage,
  type MiniSweTextMessage,
  type MiniSweToolCall,
  type MiniSweToolMessage,
  type MiniSweTrajectoryOptions,
  type MiniSweTrajectoryV1_1,
  toMiniSweTrajectory,
} from "./trajectory.js";

/** The package's name, as npm and the workspace know it. */
export const PACKAGE_NAME = "@buildanagent/evals";
