/**
 * The version the docs show in the header. The six packages version as one fixed group, so the SDK's version names the
 * whole release. It is read from the package's own manifest when Astro builds, so no number is written down here and
 * the tag moves with each release.
 */
import sdkPackage from "../../../../packages/sdk/package.json";

/** The version in a package manifest, as `x.y.z` or `x.y.z-alpha.n`. Throws for any other value. */
export function versionOf(manifest: { readonly version?: unknown }): string {
  const { version } = manifest;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`expected a semantic version in package.json, found ${JSON.stringify(version)}`);
  }
  return version;
}

/** The SDK's version, such as `0.1.0-alpha.34`. */
export const SDK_VERSION: string = versionOf(sdkPackage);
