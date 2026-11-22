/**
 * The trust store that keeps its folders in a JSON file. It uses Node's file system, so it has its own entry,
 * `@buildanagent/harness/extensions/node`. A folder in the file may load its own extensions; trust is not a sandbox, and
 * what an extension may do once loaded is the permission pipeline's decision.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { HarnessError } from "../errors.js";
import type { TrustStore } from "./types.js";

async function read(file: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  const roots = (parsed as { trusted?: unknown } | null)?.trusted;
  if (!Array.isArray(roots) || !roots.every((root) => typeof root === "string")) {
    throw new HarnessError("invalid_extension", `the trust file ${file} is not a { "trusted": [paths] } object`);
  }
  return roots as string[];
}

/** A trust store in the file at `file`, created on the first `trust()`. A folder is compared by its resolved path. */
export function fileTrustStore(file: string): TrustStore {
  return {
    async isTrusted(projectRoot) {
      return (await read(file)).includes(resolve(projectRoot));
    },
    async trust(projectRoot) {
      const roots = new Set(await read(file));
      roots.add(resolve(projectRoot));
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${globalThis.crypto.randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify({ trusted: [...roots].sort() }, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, file);
    },
  };
}
