/**
 * Finding the skills a project holds. They are the folders under `.agents/skills` that hold a `SKILL.md`, in the
 * working directory and in every folder above it up to the repository root. Node-only.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "./compose.js";
import { projectTrusted } from "./load.js";
import { projectDirs, readProjectFile } from "./project-dirs.js";
import { parseSkill, type Skill } from "./skills.js";
import type { ExtensionLoadedRecord, TrustStore } from "./types.js";

/** The settings of `discoverSkills()`. */
export interface DiscoverSkillsOptions {
  /**
   * The project-trust gate, required as it is for extensions: a project's skills are listed only when the store trusts
   * the project and the run is not headless. A skill's name and description go into the system prompt, so an untrusted
   * checkout must not reach it. A host that trusts every project it opens says so with a store that trusts them.
   */
  readonly trust: TrustStore;
  /** True for a run nobody can answer: project skills are skipped unless `loadInHeadless` is set. Default false. */
  readonly headless?: boolean;
  /** Lets a headless run list a trusted project's skills. Default false. */
  readonly loadInHeadless?: boolean;
}

/** The skills found, what to record about them, and why any were left out. */
export interface DiscoveredSkills {
  /** Nearest folder first, then by path. A name found twice keeps the nearer one. */
  readonly skills: Skill[];
  /** `extension_loaded` records with tier `skill`, for `HarnessOptions.extensionRecords`. */
  readonly records: ExtensionLoadedRecord[];
  /** One line for each file or folder skipped and each skill that shares a name. */
  readonly notices: string[];
}

const MAX_DEPTH = 4;
/** The longest `SKILL.md` listed, our own limit. A longer one is skipped with a notice, so a record's hash covers the whole file. */
const SKILL_FILE_MAX_BYTES = 256 * 1024;

/** The `SKILL.md` files under `dir`, found by walking down at most `MAX_DEPTH` levels. Links are not followed. */
async function skillFiles(dir: string, depth = 0): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const found: string[] = [];
  if (entries.some((entry) => entry.name === "SKILL.md" && (entry.isFile() || entry.isSymbolicLink())))
    found.push(join(dir, "SKILL.md"));
  // A skill's own folder holds its references and scripts, and none of them is another skill.
  if (found.length > 0 || depth >= MAX_DEPTH) return found;
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "node_modules")
      found.push(...(await skillFiles(join(dir, entry.name), depth + 1)));
  }
  return found;
}

/** Why the project's skills are not listed, or `undefined` when they may be. */
async function skipReason(root: string, options: DiscoverSkillsOptions): Promise<string | undefined> {
  if (options.headless === true && options.loadInHeadless !== true) {
    return `the project skills of ${root} are skipped: this run is headless`;
  }
  if (!(await projectTrusted(options.trust, root))) {
    return `the project skills of ${root} are skipped: the project is not trusted`;
  }
  return undefined;
}

/** One `SKILL.md` read and checked: the skill with its record, a notice saying why it is skipped, or nothing when it is gone. */
async function loadSkill(
  root: string,
  file: string,
  taken: ReadonlySet<string>,
): Promise<
  { skill: Skill; record: ExtensionLoadedRecord; warning?: string } | { notice: string } | Record<string, never>
> {
  const read = await readProjectFile(root, file, SKILL_FILE_MAX_BYTES);
  if (read === undefined) return {};
  if ("notice" in read) return read;
  // The record's hash must cover the whole file, and a cut file's hash would not.
  if (read.truncated) return { notice: `${file} is longer than ${SKILL_FILE_MAX_BYTES} bytes, so it is not listed` };
  // The path the model reads is the one found, not a link's target.
  const parsed = parseSkill(read.text, file);
  if ("problem" in parsed) return { notice: `${parsed.problem}, so it is not listed` };
  if (taken.has(parsed.skill.name)) {
    return { notice: `${file} is skipped: a nearer skill is already named "${parsed.skill.name}"` };
  }
  const record = { name: parsed.skill.name, tier: "skill" as const, contentHash: await sha256(read.bytes) };
  return { skill: parsed.skill, record, ...(parsed.notice === undefined ? {} : { warning: parsed.notice }) };
}

/**
 * Finds the skills of the project `cwd` is in: each folder under `.agents/skills` holding a `SKILL.md`, in `cwd` and
 * every folder above it up to the repository root (the first folder with a `.git`). A `cwd` in no repository searches
 * only itself. A file that is not a skill, a `SKILL.md` that is a link leaving the project, and a name already taken by
 * a nearer skill are skipped with a notice, and the rest still load. The skills' paths are absolute. No skill file is read
 * until the trust store and `headless` allow it: an untrusted project, or a headless run without `loadInHeadless`,
 * lists no skills and returns one notice saying why.
 */
export async function discoverSkills(cwd: string, options: DiscoverSkillsOptions): Promise<DiscoveredSkills> {
  const dirs = await projectDirs(cwd);
  const root = dirs.at(-1) as string;
  const result: DiscoveredSkills = { skills: [], records: [], notices: [] };
  const reason = await skipReason(root, options);
  if (reason !== undefined) {
    result.notices.push(reason);
    return result;
  }
  const names = new Set<string>();
  for (const dir of dirs) {
    for (const file of await skillFiles(join(dir, ".agents", "skills"))) {
      const found = await loadSkill(root, file, names);
      if ("notice" in found) result.notices.push(found.notice);
      if (!("skill" in found)) continue;
      if (found.warning !== undefined) result.notices.push(found.warning);
      names.add(found.skill.name);
      result.skills.push(found.skill);
      result.records.push(found.record);
    }
  }
  return result;
}
