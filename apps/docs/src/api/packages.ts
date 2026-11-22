/**
 * The packages whose API reference the docs generate, and the TypeDoc options for each. The entry points come from the
 * package's own `exports` map, through each entry's `source` condition, so the reference matches what users import.
 * The astro config, the undocumented-export check and its tests all read this one list.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** A package the reference covers. */
export interface ApiPackage {
  /** The npm name, such as `@buildanagent/gateway`. */
  readonly name: string;
  /** The folder under `packages/`. */
  readonly folder: string;
  /** The title of the package's sidebar group. */
  readonly label: string;
  /** The path under `src/content/docs/` that the generated pages are written to. */
  readonly output: string;
}

export const API_PACKAGES: readonly ApiPackage[] = [
  { name: "@buildanagent/gateway", folder: "gateway", label: "Gateway API", output: "reference/gateway" },
  { name: "@buildanagent/sdk", folder: "sdk", label: "SDK API", output: "reference/sdk" },
];

/** What a declaration must carry before the check passes. Members of a type are left to a reader's judgement. */
export const REQUIRED_TO_BE_DOCUMENTED = ["Enum", "Variable", "Function", "Class", "Interface", "TypeAlias"] as const;

/** The absolute source file of every entry in the package's `exports` map, in the map's order. */
export function entryPoints(pkg: ApiPackage): string[] {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "packages", pkg.folder, "package.json"), "utf8")) as {
    exports: Record<string, { source: string }>;
  };
  return Object.values(manifest.exports).map((entry) => resolve(REPO_ROOT, "packages", pkg.folder, entry.source));
}

/** The package's tsconfig, which resolves its own and its sibling packages' sources through the `source` condition. */
export function tsconfigOf(pkg: ApiPackage): string {
  return join(REPO_ROOT, "packages", pkg.folder, "tsconfig.json");
}

/** The TypeDoc options that the generated reference and the check share. */
export function typeDocOptions(pkg: ApiPackage) {
  return {
    entryPoints: entryPoints(pkg),
    tsconfig: tsconfigOf(pkg),
    validation: { notExported: false, invalidLink: true, notDocumented: true },
    requiredToBeDocumented: [...REQUIRED_TO_BE_DOCUMENTED],
    treatWarningsAsErrors: true,
  };
}
