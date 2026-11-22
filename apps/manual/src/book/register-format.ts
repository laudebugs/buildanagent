/**
 * The canonical layout of the three registers (`src/data/sources.json`, `src/data/glossary.json` and
 * `src/content/analogies.json`): a JSON array with one entry per line, sorted by id. Git merges by line, so two
 * branches that each add an entry merge cleanly unless they add at the same place in the order, and a conflict shows
 * whole entries and not halves of two. `format-registers.ts` writes the layout and `registers.test.ts` checks it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The three registers, by the path from the app's folder. */
export const REGISTER_FILES = [
  "src/data/sources.json",
  "src/data/glossary.json",
  "src/content/analogies.json",
] as const;

type Entry = Record<string, unknown> & { id: string };

/** Compares ids by code point, so the order is the same on every machine and locale. */
const byId = (a: Entry, b: Entry): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Parses a register's text, refusing JSON with a repeated key inside one entry, which `JSON.parse` would hide. */
export function parseRegister(text: string, file = "register"): Entry[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${file} must be a JSON array of entries`);
  for (const [index, entry] of parsed.entries()) {
    if (typeof entry !== "object" || entry === null || typeof (entry as Entry).id !== "string") {
      throw new Error(`${file}: entry ${index} needs a string id`);
    }
  }
  return parsed as Entry[];
}

/** The canonical text of a register: entries sorted by id, one compact JSON object per line. */
export function formatRegister(entries: readonly Entry[]): string {
  const lines = [...entries].sort(byId).map((entry) => `  ${JSON.stringify(entry)}`);
  return `[\n${lines.join(",\n")}\n]\n`;
}

/** The ids that appear more than once, in the order they first repeat. */
export function repeatedIds(entries: readonly Entry[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { id } of entries) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
}

/** Rewrites every register in canonical form, and returns the files whose text changed. */
export function writeRegisters(appDir: string): string[] {
  const changed: string[] = [];
  for (const file of REGISTER_FILES) {
    const path = join(appDir, file);
    const before = readFileSync(path, "utf8");
    const after = formatRegister(parseRegister(before, file));
    if (after !== before) {
      writeFileSync(path, after);
      changed.push(file);
    }
  }
  return changed;
}
