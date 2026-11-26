// Loading the extensions a project supplies. They load only from a project the host trusts, and only while their files
// match the lock file that a person wrote after reading them.
import {
  loadProjectExtensions,
  type ProjectExtensions,
  realPathTrustStore,
} from "@buildanagent/harness/extensions/node";

// #region load
/** The extensions of the project at `root`, if the host trusts it and the files still match the lock file. */
export function loadExtensions(root: string, options: { trusted: boolean }): Promise<ProjectExtensions> {
  const trust = realPathTrustStore(options.trusted ? [root] : []);
  return loadProjectExtensions(root, { trust, headless: false });
}
// #endregion
