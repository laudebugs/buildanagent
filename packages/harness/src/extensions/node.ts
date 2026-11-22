/**
 * `@buildanagent/harness/extensions/node`: loading the extensions a project supplies, with the trust file and the lock
 * file. It needs Node's file system; the portable parts are in `@buildanagent/harness/extensions`.
 */

export { contextFiles, type FoundContextFiles, planFileSource } from "./context-files-node.js";
export { type LoadOptions, loadProjectExtensions, type ProjectExtensions, pinProjectExtensions } from "./load.js";
export { hashExtensionDir, readLock, writeLock } from "./lock.js";
export { type DiscoveredSkills, type DiscoverSkillsOptions, discoverSkills } from "./skills-node.js";
export { fileTrustStore } from "./trust-file.js";
export { realPathTrustStore } from "./trust-store-node.js";
