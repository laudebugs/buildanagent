/**
 * The trust store that keeps its folders in a JSON file. It uses Node's file system, so it has its own entry,
 * `@buildanagent/harness/extensions/node`. A folder in the file may load its own extensions; trust is not a sandbox, and
 * what an extension may do once loaded is the permission pipeline's decision.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HarnessError } from "../errors.js";
import { canonicalPath } from "./load.js";
import { parseObject } from "./lock.js";
import type { TrustStore } from "./types.js";

async function read(file: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  const roots = parseObject(text, file).trusted;
  if (!Array.isArray(roots) || !roots.every((root) => typeof root === "string")) {
    throw new HarnessError("invalid_extension", `the trust file ${file} is not a { "trusted": [paths] } object`);
  }
  return roots as string[];
}

/** A trust store in the file at `file`, created on the first `trust()`. A folder is compared by its real path, so a symlinked root and its target are one project. */
export function fileTrustStore(file: string): TrustStore {
  return {
    async isTrusted(projectRoot) {
      return (await read(file)).includes(await canonicalPath(projectRoot));
    },
    async trust(projectRoot) {
      const roots = new Set(await read(file));
      roots.add(await canonicalPath(projectRoot));
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${globalThis.crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify({ trusted: [...roots].sort() }, null, 2)}\n`, { mode: 0o600 });
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
  };
}
