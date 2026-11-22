import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "astro/zod";
import type { ProblemList } from "./problems.js";

/**
 * One entry of `src/data/harnesses.json`: a harness directory and the package whose pin its listings show. A harness
 * is a `verify/` directory, whose main package is a pinned dependency, or one of our own packages, such as
 * `packages/sdk`, which is its own main package.
 */
const harnessSchema = z.tuple([
  z
    .string()
    .regex(
      /^[a-z0-9-]+(?:\/[a-z0-9-]+)+$/,
      "a harness is a directory path such as verify/vercel-ai-sdk or packages/sdk",
    ),
  z.string().trim().min(1, "a harness needs its main package's name"),
]);

/** An exact version, as `.npmrc`'s `save-exact` writes it: no range, tag or protocol. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The harness table: each harness directory, from the repository root, to its main package. */
export interface HarnessTable {
  readonly harnesses: ReadonlyMap<string, string>;
  /** The table's file, as messages name it. */
  readonly name: string;
}

/**
 * Reads the harness table. Each entry is checked on its own, so one bad entry is one problem and the others still give
 * their pins; problems name the table's file.
 */
export function readHarnesses(file: string, name: string, problems: ProblemList): HarnessTable {
  const harnesses = new Map<string, string>();
  try {
    const table: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof table !== "object" || table === null || Array.isArray(table)) {
      problems.add(name, "the harness table is an object from each harness directory to its main package");
    } else {
      for (const entry of Object.entries(table)) {
        const parsed = harnessSchema.safeParse(entry);
        if (parsed.success) harnesses.set(...parsed.data);
        else problems.add(name, `${entry[0]}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      }
    }
  } catch (error) {
    problems.add(name, `cannot read this file as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { harnesses, name };
}

/**
 * The version a transcript records for one of our own workspace packages in place of its version number, as
 * `scripts/transcripts/write.mjs` writes it: such a harness runs the package's source as it stands, whatever its
 * version says.
 */
export const WORKSPACE_VERSION = "workspace";

/** A harness's `package.json`, as far as the pin needs it. */
interface Manifest {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

/**
 * The version that a harness's `package.json` gives `name`: its exact pin, or, when the harness is the package
 * itself, as one of our own packages under `packages/` is, the version the package declares.
 */
export function manifestVersion(
  manifest: Manifest,
  name: string,
): { readonly version?: string; readonly self: boolean } {
  const self = manifest.name === name;
  const version = self ? manifest.version : (manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]);
  return version === undefined ? { self } : { version, self };
}

/**
 * The harness a repository path sits in, its main package's exact version as `name@version`, and the pin its
 * transcripts record, read from the harness's `package.json`; or why there is none. A `verify/` harness pins its
 * main package as a dependency, and its transcripts record that pin. One of our own packages is its own main
 * package: the caption shows the version it declares, such as `@buildanagent/sdk@0.1.0-alpha.19`, and its transcripts
 * record `@buildanagent/sdk@workspace`, so a release's version bump leaves them current.
 */
export function pinOf(
  path: string,
  table: HarnessTable,
  repoRoot: string,
): { readonly harness: string; readonly pin: string; readonly recordedPin: string } | { readonly message: string } {
  const harness = [...table.harnesses.keys()].find((dir) => path.startsWith(`${dir}/`));
  if (harness === undefined) {
    return { message: `${path} is in no harness that ${table.name} lists, so its listing has no pin` };
  }
  const name = table.harnesses.get(harness) ?? "";
  const manifest = join(repoRoot, harness, "package.json");
  const where = `${harness}/package.json`;
  if (!existsSync(manifest)) return { message: `${where} does not exist, so ${name} has no pin` };
  const { version, self } = manifestVersion(JSON.parse(readFileSync(manifest, "utf8")) as Manifest, name);
  if (version === undefined) {
    return {
      message: self
        ? `${where} declares no version, so ${name} has no pin`
        : `${where} does not depend on ${name}, the main package ${table.name} names for it`,
    };
  }
  if (!EXACT_VERSION.test(version)) {
    return { message: `${where} pins ${name} as "${version}", not an exact version, so the caption cannot show it` };
  }
  return { harness, pin: `${name}@${version}`, recordedPin: `${name}@${self ? WORKSPACE_VERSION : version}` };
}
