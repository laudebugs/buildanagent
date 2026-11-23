/**
 * The packages whose API reference the docs generate, and the TypeDoc options for each. The entry points come from the
 * package's own `exports` map, through each entry's `source` condition, so the reference matches what users import.
 * The astro config, the undocumented-export check and its tests all read this one list.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OptionDefaults } from "typedoc";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** A package whose exports the undocumented-export check covers. */
export interface CheckedPackage {
  /** The npm name, such as `@buildanagent/gateway`. */
  readonly name: string;
  /** The folder under `packages/`. */
  readonly folder: string;
  /**
   * A tsconfig for TypeDoc, relative to this folder, when the package's own one doesn't suit. TypeDoc compiles every
   * file a tsconfig includes, with the TypeScript 6 the docs app pins, so a config that includes tests checks them too.
   */
  readonly tsconfig?: string;
}

/** A package the reference covers. */
export interface ApiPackage extends CheckedPackage {
  /** The text of the package's sidebar topic tab. The title of its sidebar group is the package's `name`. */
  readonly label: string;
  /** The path under `src/content/docs/` that the generated pages are written to. */
  readonly output: string;
}

/** The packages the reference covers, in the order the sidebar lists them. */
export const API_PACKAGES: readonly ApiPackage[] = [
  { name: "@buildanagent/gateway", folder: "gateway", label: "Gateway API", output: "reference/gateway" },
  { name: "@buildanagent/sdk", folder: "sdk", label: "SDK API", output: "reference/sdk" },
];

/**
 * Every package the undocumented-export check covers: the ones the reference covers, then the protocol, harness, CLI and
 * agent-safety packages. Those four will publish after the gateway and SDK, so their TSDoc is held to the same rule
 * now, but the docs site generates no reference pages for them until they do.
 */
export const CHECKED_PACKAGES: readonly CheckedPackage[] = [
  ...API_PACKAGES,
  { name: "@buildanagent/protocol", folder: "protocol" },
  { name: "@buildanagent/harness", folder: "harness" },
  { name: "@buildanagent/cli", folder: "cli" },
  // Its tsconfig.json includes its tests, and TypeScript 6 reads the AI SDK's tool approval types in them differently
  // from TypeScript 7, so TypeDoc reads its sources alone.
  { name: "@buildanagent/agent-safety", folder: "agent-safety", tsconfig: "agent-safety.tsconfig.json" },
];

/** The TypeDoc validation the check and the generated reference share. */
export const VALIDATION = { notExported: false, invalidLink: true, notDocumented: true } as const;

/** What a declaration must carry before the check passes. Members of a type are left to a reader's judgement. */
export const REQUIRED_TO_BE_DOCUMENTED = ["Enum", "Variable", "Function", "Class", "Interface", "TypeAlias"] as const;

/** TypeDoc's block tags, plus `@stable`, which marks the protocol's stable session-entry fields. */
export const BLOCK_TAGS = [...OptionDefaults.blockTags, "@stable"] as const;

/** The absolute source file of every entry in the package's `exports` map, in the map's order. */
export function entryPoints(pkg: CheckedPackage): string[] {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "packages", pkg.folder, "package.json"), "utf8")) as {
    exports: Record<string, { source: string }>;
  };
  return Object.values(manifest.exports).map((entry) => resolve(REPO_ROOT, "packages", pkg.folder, entry.source));
}

/** The package's tsconfig, which resolves its own and its sibling packages' sources through the `source` condition. */
export function tsconfigOf(pkg: CheckedPackage): string {
  if (pkg.tsconfig !== undefined) return resolve(dirname(fileURLToPath(import.meta.url)), pkg.tsconfig);
  return join(REPO_ROOT, "packages", pkg.folder, "tsconfig.json");
}

/** The TypeDoc options that the generated reference and the check share. */
export function typeDocOptions(pkg: CheckedPackage) {
  return {
    entryPoints: entryPoints(pkg),
    tsconfig: tsconfigOf(pkg),
    validation: VALIDATION,
    requiredToBeDocumented: [...REQUIRED_TO_BE_DOCUMENTED],
    blockTags: [...BLOCK_TAGS],
  };
}
