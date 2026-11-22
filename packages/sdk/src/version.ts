/**
 * The SDK's own version, read from its package.json so it can't drift from the published version. `run_start`
 * carries it, so a stored session records which SDK wrote it.
 */
import packageJson from "../package.json" with { type: "json" };

/** The version of `@buildanagent/sdk` in use, such as `0.1.0-alpha.13`. */
export const SDK_VERSION: string = packageJson.version;
