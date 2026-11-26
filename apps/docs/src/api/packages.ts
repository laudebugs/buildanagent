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
  /**
   * Whether the sidebar lists every export (`"full"`, the default) or one link per entry-point module (`"modules"`).
   * A package with many entry points uses `"modules"` so its sidebar stays under the 200 KiB HTML page budget while
   * every export still gets a generated page and a Markdown twin.
   */
  readonly sidebar?: "full" | "modules";
  /**
   * A Markdown file, relative to this folder, that TypeDoc puts on the package's reference index. A package with one entry
   * point shows its `@module` comment there; one with many shows only a list of modules, so its quick-start link goes here.
   */
  readonly readme?: string;
}

/** The packages the reference covers, in the order the sidebar lists them. */
export const API_PACKAGES: readonly ApiPackage[] = [
  { name: "@buildanagent/gateway", folder: "gateway", label: "Gateway API", output: "reference/gateway" },
  { name: "@buildanagent/sdk", folder: "sdk", label: "SDK API", output: "reference/sdk" },
  // Its tsconfig.json includes its tests, and TypeScript 6 reads the AI SDK's tool approval types in them differently
  // from TypeScript 7, so TypeDoc reads its sources alone.
  {
    name: "@buildanagent/agent-safety",
    folder: "agent-safety",
    label: "Agent safety API",
    output: "reference/agent-safety",
    tsconfig: "agent-safety.tsconfig.json",
    readme: "readmes/agent-safety.md",
  },
  { name: "@buildanagent/protocol", folder: "protocol", label: "Protocol API", output: "reference/protocol" },
  {
    name: "@buildanagent/harness",
    folder: "harness",
    label: "Harness API",
    output: "reference/harness",
    sidebar: "modules",
    readme: "readmes/harness.md",
  },
  { name: "@buildanagent/cli", folder: "cli", label: "CLI API", output: "reference/cli" },
];

/**
 * Every package the undocumented-export check covers. All six published packages now have generated reference pages,
 * so the checked set matches `API_PACKAGES`.
 */
export const CHECKED_PACKAGES: readonly CheckedPackage[] = API_PACKAGES;

/** The TypeDoc validation the check and the generated reference share. */
export const VALIDATION = { notExported: false, invalidLink: true, notDocumented: true } as const;

/** What a declaration must carry before the check passes. Members of a type are left to a reader's judgement. */
export const REQUIRED_TO_BE_DOCUMENTED = ["Enum", "Variable", "Function", "Class", "Interface", "TypeAlias"] as const;

/** TypeDoc's block tags, plus `@stable`, which marks the protocol's stable session-entry fields. */
export const BLOCK_TAGS = [...OptionDefaults.blockTags, "@stable"] as const;

/** The absolute source file of every entry in the package's `exports` map, in the map's order. */
export function entryPoints(pkg: CheckedPackage): string[] {
  const manifest = readManifest(pkg);
  return Object.values(manifest.exports).map((entry) => resolve(REPO_ROOT, "packages", pkg.folder, entry.source));
}

/**
 * A sidebar group listing one link per entry-point module in `pkg`'s `exports` map, used when `pkg.sidebar` is
 * `"modules"` so large packages stay inside the HTML page budget. Requires a multi-entry package because single-entry
 * packages have no per-module subdirectories.
 */
export function moduleSidebarGroup(pkg: ApiPackage): {
  label: string;
  collapsed: boolean;
  items: { label: string; link: string }[];
} {
  const manifest = readManifest(pkg);
  const subpaths = Object.keys(manifest.exports);
  if (subpaths.length <= 1) {
    throw new Error(`sidebar: "modules" requires a multi-entry package (${pkg.name} has ${subpaths.length})`);
  }
  const items = subpaths.map((subpath) => {
    if (subpath !== "." && !subpath.startsWith("./")) {
      throw new Error(`unexpected export key "${subpath}" in ${pkg.name}`);
    }
    const mod = subpath === "." ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, "")}`;
    return {
      label: mod,
      link: `/${pkg.output}/${mod.replace(/^@/, "").toLowerCase()}/`,
    };
  });
  return { label: pkg.name, collapsed: false, items };
}

function readManifest(pkg: CheckedPackage): { exports: Record<string, { source: string }> } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "packages", pkg.folder, "package.json"), "utf8")) as {
    exports: Record<string, { source: string }>;
  };
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
