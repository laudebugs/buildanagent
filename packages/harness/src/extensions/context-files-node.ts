/** Reading the files `projectContext()` shows the model: `AGENTS.md`, `CLAUDE.md`, and the plan and progress files. Node-only. */
import { join, resolve } from "node:path";
import {
  CONTEXT_FILE_MAX_BYTES,
  type ContextFile,
  droppedNotice,
  fitContextFiles,
  PLAN_FILE,
  type PlanFiles,
  type PlanSource,
  PROGRESS_FILE,
} from "./context-files.js";
import { projectDirs, readProjectFile } from "./project-dirs.js";

/** The context files found, and why any were left out. */
export interface FoundContextFiles {
  /** Outermost folder first, so the file nearest the working directory comes last. `AGENTS.md` comes before `CLAUDE.md` in a folder. */
  readonly files: ContextFile[];
  readonly notices: string[];
}

const NAMES = ["AGENTS.md", "CLAUDE.md"];

/**
 * Reads the `AGENTS.md` and `CLAUDE.md` of `cwd` and of every folder above it up to the repository root (the first
 * folder with a `.git`; with none, `cwd` alone). These files load whether or not the project is trusted, because they
 * are text and not code, and `projectContext()` labels them untrusted. A `CLAUDE.md` that links to the `AGENTS.md`
 * beside it is read once. A link that leaves the project is skipped with a notice, so a cloned repository cannot pull
 * in a file such as `~/.ssh/id_rsa`. Each file is cut at 64 KiB, and past 128 KiB together the outermost files are
 * left out, with a notice.
 */
export async function contextFiles(cwd: string): Promise<FoundContextFiles> {
  const dirs = await projectDirs(cwd);
  const root = dirs.at(-1) as string;
  const result: FoundContextFiles = { files: [], notices: [] };
  const seen = new Set<string>();
  for (const dir of [...dirs].reverse()) {
    for (const name of NAMES) {
      const path = join(dir, name);
      const read = await readProjectFile(root, path, CONTEXT_FILE_MAX_BYTES);
      if (read === undefined) continue;
      if ("notice" in read) {
        result.notices.push(read.notice);
        continue;
      }
      if (seen.has(read.real)) continue;
      seen.add(read.real);
      result.files.push({ path, text: read.text, truncated: read.truncated });
    }
  }
  const { kept, dropped } = fitContextFiles(result.files);
  const left = droppedNotice(dropped);
  return { files: kept, notices: left === undefined ? result.notices : [...result.notices, left] };
}

/**
 * A plan source that reads `.agents/plan.md` and `.agents/progress.json` under `root` each time it is called. A file
 * that does not exist is left out, a link that leaves `root` is skipped with a notice, and a progress file that is not
 * valid JSON is still shown, with a notice, because a half-written file is what a crash leaves behind.
 */
export function planFileSource(root: string): PlanSource {
  const base = resolve(root);
  return async (): Promise<PlanFiles> => {
    const notices: string[] = [];
    const get = async (file: string) => {
      const read = await readProjectFile(base, join(base, file), CONTEXT_FILE_MAX_BYTES);
      if (read === undefined) return undefined;
      if ("notice" in read) {
        notices.push(read.notice);
        return undefined;
      }
      return read;
    };
    const plan = await get(PLAN_FILE);
    const progress = await get(PROGRESS_FILE);
    if (progress !== undefined && !progress.truncated) {
      try {
        JSON.parse(progress.text);
      } catch {
        notices.push(`${PROGRESS_FILE} is not valid JSON, so it is shown as written`);
      }
    }
    return {
      ...(plan === undefined ? {} : { plan: { text: plan.text, truncated: plan.truncated } }),
      ...(progress === undefined ? {} : { progress: { text: progress.text, truncated: progress.truncated } }),
      ...(notices.length === 0 ? {} : { notices }),
    };
  };
}
