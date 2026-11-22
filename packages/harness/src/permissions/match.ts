/**
 * What a rule reads from a call: the paths in its input, and the commands in its shell command. The reading is
 * heuristic, and the limits are in the README: a path in a field this file doesn't know, or a command built by a shell
 * feature it doesn't parse, is not seen.
 */

const PATH_KEYS = ["path", "file", "file_path", "filePath", "target", "destination", "source"];
const PATH_LIST_KEYS = ["paths", "files"];
const COMMAND_KEYS = ["command", "cmd"];
// Words that start a command without changing which program runs, so a deny or ask rule looks past them. The value is
// the options that take a value, which are skipped with it.
const WRAPPERS: ReadonlyMap<string, readonly string[]> = new Map([
  ["sudo", ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"]],
  ["env", ["-u", "-C", "-S"]],
  ["nice", ["-n"]],
  ["time", ["-f", "-o"]],
  ["exec", ["-a"]],
  ["command", []],
  ["nohup", []],
  ["doas", ["-u", "-C"]],
  ["xargs", ["-I", "-n", "-P", "-L", "-s", "-d", "-E"]],
  ["timeout", ["-s", "-k"]],
]);
// Wrappers whose options are followed by positional words that are not the program, such as timeout's duration.
const WRAPPER_POSITIONALS: ReadonlyMap<string, number> = new Map([["timeout", 1]]);

/** A program's name without its directory, so `/usr/bin/git` is `git`. */
const programName = (word: string): string => word.split("/").at(-1) || word;
// Shell syntax that starts a command without being its program: a group, a negation or a keyword.
const LEADERS = new Set(["{", "}", "!", "if", "then", "else", "elif", "do", "while", "until"]);
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

const escapeRegExp = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

const isRelative = (pattern: string): boolean => !pattern.startsWith("/") && !pattern.startsWith("**");

/**
 * A glob as a regular expression: `*` is any run of characters but `/`, `**` any run, `?` one character but `/`. With
 * `anywhere`, a relative glob also matches below any directory, because the pipeline doesn't know the working
 * directory and a deny or ask rule must not miss `/repo/secrets/a` for `secrets/**`.
 */
export function globToRegExp(glob: string, anywhere = false): RegExp {
  const pattern = normalizePath(glob);
  const prefix = anywhere && isRelative(pattern) ? "(?:.*/)?" : "";
  return new RegExp(`^${prefix}${globBody(pattern)}$`);
}

/** The regular expression source of a glob's text. */
function globBody(pattern: string): string {
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
  return source;
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
  /** True when a substitution or `-c` script lay deeper than the parser reads, so a rule can't tell what it runs. */
  readonly unreadable: boolean;
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

/** The length of the separator that starts at `i`, or 0. A `(` or `)` ends a command, as a subshell's edges do. */
function separatorAt(text: string, i: number): number {
  const pair = text.slice(i, i + 2);
  if (pair === "&&" || pair === "||" || pair === "|&") return 2;
  // An & beside a redirection, as in 2>&1 and &>file, is part of it and not a separator.
  if (text[i] === "&" && (text[i - 1] === ">" || text[i - 1] === "<" || text[i + 1] === ">")) return 0;
  return ";|&\n()".includes(text[i] as string) ? 1 : 0;
}

/** Reads one quoted run starting at the quote at `i` and returns where it ended. */
function readQuoted(text: string, i: number, scan: Scan): number {
  const quote = text[i] as string;
  // `$'...'` is ANSI-C quoting, and the `$` is not part of the word.
  if (quote === "'" && scan.word === "$") scan.word = "";
  scan.inWord = true;
  let at = i + 1;
  for (; at < text.length && text[at] !== quote; at += 1) {
    if (quote === '"' && text[at] === "\\" && at + 1 < text.length) at += 1;
    scan.word += text[at];
  }
  return at;
}

/** Adds the plain character at `i` to the current word, and returns where reading goes on. A backslash escapes the next one. */
function readPlain(text: string, i: number, scan: Scan): number {
  if (text[i] !== "\\" || i + 1 >= text.length) {
    scan.word += text[i];
    scan.inWord = true;
    return i;
  }
  // A backslash-newline joins the lines, so the word goes on without it.
  if (text[i + 1] !== "\n") {
    scan.word += text[i + 1];
    scan.inWord = true;
  }
  return i + 1;
}

function splitWords(text: string): string[][] {
  const scan: Scan = { parts: [], words: [], word: "", inWord: false };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    const separator = separatorAt(text, i);
    if (separator > 0 && !(char === "(" && text[i - 1] === "$")) {
      endPart(scan);
      i += separator - 1;
    } else if (char === "'" || char === '"') i = readQuoted(text, i, scan);
    else if (/\s/.test(char)) endWord(scan);
    else i = readPlain(text, i, scan);
  }
  endPart(scan);
  return scan.parts;
}

/** The text between the parenthesis at `open` and its match, with nesting, or the rest of the text when unbalanced. */
function balanced(text: string, open: number): string {
  let level = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") level += 1;
    else if (text[i] === ")") {
      level -= 1;
      if (level === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/** The texts a command runs inside `$( )`, backticks and process substitution, which the outer words don't show. */
function substitutions(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if ((text[i] === "$" || text[i] === "<" || text[i] === ">") && text[i + 1] === "(")
      found.push(balanced(text, i + 1));
    else if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      found.push(text.slice(i + 1, end < 0 ? text.length : end));
      if (end < 0) break;
      i = end;
    }
  }
  return found;
}

/** The script a `bash -c` style part runs, when it is one: a shell whose options include `-c`. */
function shellScript(words: readonly string[]): string | undefined {
  const [program, ...rest] = strippedWords(words);
  if (program === "eval") return rest.join(" ");
  if (program === undefined || !SHELLS.has(program)) return undefined;
  const flag = rest.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));
  return flag < 0 ? undefined : rest.slice(flag + 1).find((word) => !word.startsWith("-"));
}

/**
 * The commands of `base`, of the substitutions `inner` and of the `-c` scripts of any of them, read to a fixed depth.
 * A command still unread at the limit is `unreadable`, which a deny or ask rule treats as a match.
 */
function assemble(base: string[][], inner: readonly string[], depth: number, opaque: boolean): ParsedCommand {
  const read = depth < MAX_DEPTH;
  const nested = read ? inner.map((text) => parseCommandAt(text, depth + 1)) : [];
  const parts = [...base, ...nested.flatMap((command) => command.parts)];
  const scripts = parts.map(shellScript).filter((script): script is string => script !== undefined);
  const scripted = read ? scripts.map((text) => parseCommandAt(text, depth + 1)) : [];
  const deeper = [...nested, ...scripted];
  return {
    parts: [...parts, ...scripted.flatMap((command) => command.parts)],
    opaque: opaque || inner.length > 0,
    unreadable: (!read && (inner.length > 0 || scripts.length > 0)) || deeper.some((command) => command.unreadable),
  };
}

function parseCommandAt(text: string, depth: number): ParsedCommand {
  return assemble(splitWords(text), substitutions(text), depth, /\$'[^']*\\/.test(text));
}

/** The commands an input carries, or `undefined` when it has no command field. A list is one command's words. */
export function commandOf(input: unknown): ParsedCommand | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  for (const key of COMMAND_KEYS) {
    const value = record[key];
    if (typeof value === "string") return parseCommandAt(value, 0);
    if (Array.isArray(value) && value.every((word) => typeof word === "string")) {
      return assemble(value.length === 0 ? [] : [value as string[]], [], 0, false);
    }
  }
  return undefined;
}

/** The index after a wrapper's options, skipping the value of each option that takes one. */
function skipOptions(words: readonly string[], from: number, withValue: readonly string[]): number {
  let at = from;
  while (at < words.length && (words[at] as string).startsWith("-")) {
    if ((words[at] as string) === "--") return at + 1;
    at += withValue.includes(words[at] as string) ? 2 : 1;
  }
  return at;
}

/**
 * A command's words without leading `NAME=value` words, group and keyword leaders such as `{` and `!`, and wrappers
 * such as `sudo -u root` or `env -i`, for a deny or ask rule.
 */
export function strippedWords(words: readonly string[]): string[] {
  let at = 0;
  while (at < words.length) {
    const word = programName(words[at] as string);
    const options = WRAPPERS.get(word);
    if (options !== undefined) at = skipOptions(words, at + 1, options) + (WRAPPER_POSITIONALS.get(word) ?? 0);
    else if (LEADERS.has(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) at += 1;
    else break;
  }
  if (at >= words.length) return [];
  const program = programName(words[at] as string);
  return program === "git" ? ["git", ...words.slice(skipGitOptions(words, at + 1))] : [program, ...words.slice(at + 1)];
}

// Options that go before a git subcommand, and take a value as the next word when written without `=`.
const GIT_VALUE_OPTIONS = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"];

/** The index of git's subcommand: after its global options and their values. */
function skipGitOptions(words: readonly string[], from: number): number {
  let at = from;
  while (at < words.length && (words[at] as string).startsWith("-")) {
    at += GIT_VALUE_OPTIONS.includes(words[at] as string) ? 2 : 1;
  }
  return at;
}

/** Whether `words` begins with `prefix`, word for word. */
export function startsWithWords(words: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length > 0 && prefix.length <= words.length && prefix.every((word, index) => words[index] === word);
}
