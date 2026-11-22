/**
 * What a rule reads from a call: the paths in its input, and the commands in its shell command. The reading is
 * heuristic, and the limits are in the README: a path in a field this file doesn't know, or a command built by a shell
 * feature it doesn't parse, is not seen.
 */

const PATH_KEYS = ["path", "file", "file_path", "filePath", "target", "destination", "source"];
const PATH_LIST_KEYS = ["paths", "files"];
const COMMAND_KEYS = ["command", "cmd"];
// Words that start a command without changing which program runs, so a deny or ask rule looks past them.
const WRAPPERS = new Set(["sudo", "env", "command", "nohup", "time", "exec", "nice"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
const MAX_DEPTH = 3;

/** A path made absolute-or-relative but never containing `.`, `..` or a double slash, with `/` as the separator. */
export function normalizePath(path: string): string {
  const absolute = path.startsWith("/") || path.startsWith("\\");
  const kept: string[] = [];
  for (const part of path.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part !== "..") kept.push(part);
    else if (kept.length > 0 && kept.at(-1) !== "..") kept.pop();
    else if (!absolute) kept.push("..");
  }
  return `${absolute ? "/" : ""}${kept.join("/")}`;
}

/** The paths an input names, normalised. */
export function pathsOf(input: unknown): string[] {
  if (typeof input !== "object" || input === null) return [];
  const record = input as Record<string, unknown>;
  const found: unknown[] = PATH_KEYS.map((key) => record[key]);
  for (const key of PATH_LIST_KEYS) {
    const list = record[key];
    if (Array.isArray(list)) found.push(...list);
  }
  return found.filter((value): value is string => typeof value === "string").map(normalizePath);
}

const escapeRegExp = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** A glob as a regular expression: `*` is any run of characters but `/`, `**` any run, `?` one character but `/`. */
export function globToRegExp(glob: string): RegExp {
  const pattern = normalizePath(glob);
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] as string;
    if (char === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
}

/** A name pattern: a `*` matches any run of characters. */
export function nameMatches(pattern: string, name: string): boolean {
  if (!pattern.includes("*")) return pattern === name;
  return new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`).test(name);
}

/** A shell command as the words of each simple command in it. `opaque` is true when it hides commands in a substitution. */
export interface ParsedCommand {
  readonly parts: string[][];
  readonly opaque: boolean;
}

interface Scan {
  parts: string[][];
  words: string[];
  word: string;
  inWord: boolean;
}

function endWord(scan: Scan): void {
  if (scan.inWord) scan.words.push(scan.word);
  scan.word = "";
  scan.inWord = false;
}

function endPart(scan: Scan): void {
  endWord(scan);
  if (scan.words.length > 0) scan.parts.push(scan.words);
  scan.words = [];
}

/** The length of the separator that starts at `i`, or 0. */
function separatorAt(text: string, i: number): number {
  const pair = text.slice(i, i + 2);
  if (pair === "&&" || pair === "||") return 2;
  return ";|&\n".includes(text[i] as string) ? 1 : 0;
}

/** Reads one quoted run starting at the quote at `i` and returns where it ended. */
function readQuoted(text: string, i: number, scan: Scan): number {
  const quote = text[i] as string;
  scan.inWord = true;
  let at = i + 1;
  for (; at < text.length && text[at] !== quote; at += 1) {
    if (quote === '"' && text[at] === "\\" && at + 1 < text.length) at += 1;
    scan.word += text[at];
  }
  return at;
}

function splitWords(text: string): string[][] {
  const scan: Scan = { parts: [], words: [], word: "", inWord: false };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    const separator = separatorAt(text, i);
    if (separator > 0) {
      endPart(scan);
      i += separator - 1;
    } else if (char === "'" || char === '"') i = readQuoted(text, i, scan);
    else if (/\s/.test(char)) endWord(scan);
    else {
      if (char === "\\" && i + 1 < text.length) i += 1;
      scan.word += text[i];
      scan.inWord = true;
    }
  }
  endPart(scan);
  return scan.parts;
}

// `$( )`, backticks and process substitution run commands the outer words don't show.
const SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`|[<>]\(([^()]*)\)/g;

/** The commands inside a command text's substitutions, read the same way, to a fixed depth. */
function innerParts(text: string, depth: number): string[][] {
  if (depth >= MAX_DEPTH) return [];
  const found: string[][] = [];
  for (const match of text.matchAll(SUBSTITUTION)) {
    found.push(...parseCommandAt(match[1] ?? match[2] ?? match[3] ?? "", depth + 1).parts);
  }
  return found;
}

/** The text a `bash -c` style part runs, when it is one. */
function shellScript(words: readonly string[]): string | undefined {
  const [program, flag, script] = words;
  const isShell = program !== undefined && SHELLS.has(program.split("/").at(-1) as string);
  return isShell && flag !== undefined && /^-[a-z]*c[a-z]*$/.test(flag) ? script : undefined;
}

function parseCommandAt(text: string, depth: number): ParsedCommand {
  const parts = splitWords(text);
  const opaque = new RegExp(SUBSTITUTION.source).test(text);
  const inner = innerParts(text, depth);
  for (const words of [...parts]) {
    const script = shellScript(words);
    if (script !== undefined && depth < MAX_DEPTH) inner.push(...parseCommandAt(script, depth + 1).parts);
  }
  return { parts: [...parts, ...inner], opaque };
}

/** The commands an input carries, or `undefined` when it has no command field. A list is one command's words. */
export function commandOf(input: unknown): ParsedCommand | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  for (const key of COMMAND_KEYS) {
    const value = record[key];
    if (typeof value === "string") return parseCommandAt(value, 0);
    if (Array.isArray(value) && value.every((word) => typeof word === "string")) {
      return { parts: value.length === 0 ? [] : [value as string[]], opaque: false };
    }
  }
  return undefined;
}

/** A command's words without leading `NAME=value` words and wrappers such as `sudo`, for a deny or ask rule. */
export function strippedWords(words: readonly string[]): string[] {
  let at = 0;
  while (
    at < words.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at] as string) || WRAPPERS.has(words[at] as string))
  ) {
    at += 1;
  }
  return words.slice(at);
}

/** Whether `words` begins with `prefix`, word for word. */
export function startsWithWords(words: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length > 0 && prefix.length <= words.length && prefix.every((word, index) => words[index] === word);
}
