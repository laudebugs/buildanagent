/**
 * `@buildanagent/harness/extensions/node`: loading the extensions a project supplies, with the trust file and the lock
 * file, the lock file's MCP tool pins, and the MCP servers a project's `.mcp.json` declares. It needs Node's file system; the portable parts are in
 * `@buildanagent/harness/extensions`.
 *
 * @module @buildanagent/harness/extensions/node
 */

export { contextFiles, type FoundContextFiles, planFileSource } from "./context-files-node.js";
export { type LoadOptions, loadProjectExtensions, type ProjectExtensions, pinProjectExtensions } from "./load.js";
export {
  hashExtensionDir,
  readLock,
  readMcpConfigPins,
  readMcpPins,
  writeLock,
  writeMcpConfigPin,
  writeMcpPins,
} from "./lock.js";
export {
  describeProjectMcpServer,
  loadProjectMcpServers,
  PROJECT_MCP_CONFIG,
  type ProjectMcpFiles,
  type ProjectMcpOptions,
  type ProjectMcpServer,
  type ProjectMcpServers,
  pinProjectMcpServer,
} from "./mcp-config-node.js";
export { fileMcpPinStore } from "./mcp-pins-node.js";
export { type DiscoveredSkills, type DiscoverSkillsOptions, discoverSkills } from "./skills-node.js";
export { fileTrustStore } from "./trust-file.js";
export { realPathTrustStore } from "./trust-store-node.js";
