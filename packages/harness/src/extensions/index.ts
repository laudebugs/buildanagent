/**
 * `@buildanagent/harness/extensions`: in-process extensions. `composeExtensions()` joins their hooks by the SDK's rules,
 * `registerExtensionTools()` registers their tools, and `recordsOf()` gives the `extension_loaded` records a harness
 * writes to the log. Loading an extension from a project folder needs Node's file system, so it has its own entry,
 * `@buildanagent/harness/extensions/node`.
 */
export { composeExtensions, memoryTrustStore, recordsOf, registerExtensionTools, sha256 } from "./compose.js";
export {
  CONTEXT_FILE_MAX_BYTES,
  CONTEXT_FILES_MAX_TOTAL_BYTES,
  type ContextFile,
  contextText,
  PLAN_FILE,
  type PlanFiles,
  type PlanSource,
  PROGRESS_FILE,
  type ProjectContextOptions,
  planPrompt,
  projectContext,
  withPlanConvention,
} from "./context-files.js";
export {
  type ParsedSkill,
  parseSkill,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  type Skill,
  skillOfRead,
  skillsPrompt,
  withSkills,
} from "./skills.js";
export type { Extension, ExtensionLoadedRecord, ExtensionTool, TrustStore } from "./types.js";
