/**
 * The canonical layout of the three registers (`src/data/sources.json`, `src/data/glossary.json` and
 * `src/content/analogies.json`): a JSON array with one entry per line, sorted by id. Git merges by line, so two
 * branches that each add an entry merge cleanly unless they add at the same place in the order, and a conflict shows
 * whole entries and not halves of two. An entry that sorts last also edits the old last line's comma, so near-end adds can conflict. `format-registers.ts` writes the layout and `registers.test.ts` checks it.
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

/** Compares ids by UTF-16 code unit, so the order is the same on every machine and locale. */
const byId = (a: Entry, b: Entry): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The first key that an object of the JSON text repeats, or `undefined`. `JSON.parse` keeps the last value of a repeated
 * key and hides the first, so a register is scanned before it is parsed.
 */
export function repeatedKey(text: string): string | undefined {
  const stack: Set<string>[] = [];
  const keyAt = /"((?:[^"\\]|\\.)*)"\s*:/y;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === "{") stack.push(new Set());
    else if (char === "}") stack.pop();
    else if (char === '"') {
      keyAt.lastIndex = i;
      const key = keyAt.exec(text);
      const keys = stack.at(-1);
      if (key !== null && keys !== undefined) {
        const name = JSON.parse(`"${key[1]}"`) as string;
        if (keys.has(name)) return name;
        keys.add(name);
        i = keyAt.lastIndex - 1;
      } else {
        inString = true;
      }
    }
  }
  return undefined;
}

/** Parses a register's text, refusing a repeated key inside an entry, a syntax error, and an entry with no string id. */
export function parseRegister(text: string, file = "register"): Entry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const repeated = repeatedKey(text);
  if (repeated !== undefined) throw new Error(`${file}: an entry repeats the key "${repeated}"`);
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
  if (entries.length === 0) return "[]\n";
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
