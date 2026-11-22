// Fails on a todo id, such as B4 or E2a, in a comment under packages/*/src (maintainability.md, "Names and comments
// explain the code, not its history"). A todo is done once, and its id stops meaning anything to the next reader, so
// ids belong in commit messages and plans. A decision id such as D3 or HD15, which an internal comment may cite, is
// not a todo id.
//
//   node scripts/ci/todo-ids.mjs [root]    root defaults to the repo root
//
// The ids come from the files in docs/todos/<state>/, named `<id>-<slug>.md`, so a new todo is covered the day its file
// lands and a string such as `T00:00:00Z` never counts. Only comments are read: the check skips string, template and
// regular-expression text, because a todo id in a string is data, not history.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STATES = ["ready", "ongoing", "done"];

/** The todo ids that docs/todos/<state>/ names, such as `B4`, `E2a` and `T31`. */
export function todoIds(root) {
  const ids = new Set();
  for (const state of STATES) {
    const dir = path.join(root, "docs", "todos", state);
    for (const name of safeList(dir)) {
      const id = /^([A-Z]\d+[a-z]?)-/.exec(name)?.[1];
      if (id !== undefined) ids.add(id);
    }
  }
  return ids;
}

function safeList(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// A `/` after one of these characters, or after one of these keywords, starts a regular expression and not a division.
const REGEX_AFTER = new Set([
  "",
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);
const KEYWORDS_BEFORE_REGEX = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "yield",
  "await",
  "void",
  "delete",
  "instanceof",
  "new",
  "throw",
]);
const WORD = /[A-Za-z0-9_$]/;

/**
 * The comments of a TypeScript source as `{ line, text }`, one for each line a comment covers. It skips string, template
 * (with any `${}` nested in it) and regular-expression text, so a `//` or a quote inside one starts nothing. A `/` after
 * `)`, a name or a number counts as a division; a regular expression there, which real code almost never has, can
 * misplace a comment.
 */
export function commentsOf(source) {
  const found = [];
  const length = source.length;
  let line = 1;
  let i = 0;
  let prev = ""; // the last significant character outside comments
  let word = ""; // the name that ends at `prev`, or ""

  function skipString(quote) {
    i++;
    while (i < length && source[i] !== quote && source[i] !== "\n") {
      if (source[i] === "\\") {
        if (source[i + 1] === "\n") line++;
        i++;
      }
      i++;
    }
    i++;
  }

  function skipRegex() {
    i++;
    let inClass = false;
    while (i < length && source[i] !== "\n") {
      const ch = source[i];
      if (ch === "\\") i++;
      else if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) break;
      i++;
    }
    i++;
    while (i < length && /[a-z]/i.test(source[i] ?? "")) i++;
  }

  function scanTemplate() {
    while (i < length) {
      const ch = source[i];
      if (ch === "\\") {
        if (source[i + 1] === "\n") line++;
        i += 2;
        continue;
      }
      if (ch === "\n") line++;
      i++;
      if (ch === "`") return;
      if (ch === "$" && source[i] === "{") {
        i++;
        scanCode(true);
      }
    }
  }

  function comment(stop) {
    const lines = source.slice(i, stop).split("\n");
    for (const [offset, text] of lines.entries()) found.push({ line: line + offset, text });
    line += lines.length - 1;
    i = stop;
  }

  /** Scans code; inside a `${}` it returns at the matching `}`. */
  function scanCode(inExpression) {
    let depth = 0;
    while (i < length) {
      const ch = source[i];
      const next = source[i + 1];
      if (ch === "\n") {
        line++;
        i++;
      } else if (/\s/.test(ch)) {
        i++;
      } else if (ch === "/" && next === "/") {
        const end = source.indexOf("\n", i);
        comment(end === -1 ? length : end);
      } else if (ch === "/" && next === "*") {
        const end = source.indexOf("*/", i + 2);
        comment(end === -1 ? length : end + 2);
      } else if (ch === '"' || ch === "'") {
        skipString(ch);
        [prev, word] = ["a", ""];
      } else if (ch === "`") {
        i++;
        scanTemplate();
        [prev, word] = ["a", ""];
      } else if (ch === "/" && (REGEX_AFTER.has(prev) || KEYWORDS_BEFORE_REGEX.has(word))) {
        skipRegex();
        [prev, word] = ["a", ""];
      } else if (WORD.test(ch)) {
        let end = i;
        while (end < length && WORD.test(source[end] ?? "")) end++;
        word = source.slice(i, end);
        prev = source[end - 1] ?? "";
        i = end;
      } else {
        if (ch === "{") depth++;
        if (ch === "}") {
          if (inExpression && depth === 0) {
            i++;
            return;
          }
          depth--;
        }
        [prev, word] = [ch, ""];
        i++;
      }
    }
  }

  scanCode(false);
  return found;
}

function* sourceFiles(dir) {
  for (const name of safeList(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) yield* sourceFiles(file);
    else if (/\.(?:ts|mts|tsx)$/.test(name) && !name.endsWith(".d.ts")) yield file;
  }
}

/** Every todo id in a comment under `<root>/packages/<name>/src`, as `{ file, line, id }`. */
export function findTodoIds(root) {
  const ids = todoIds(root);
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_])(${[...ids].map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9_])`,
    "g",
  );
  const hits = [];
  if (ids.size === 0) return hits;
  const packages = path.join(root, "packages");
  for (const name of safeList(packages)) {
    for (const file of sourceFiles(path.join(packages, name, "src"))) {
      for (const { line, text } of commentsOf(readFileSync(file, "utf8"))) {
        for (const match of text.matchAll(pattern)) hits.push({ file: path.relative(root, file), line, id: match[1] });
      }
    }
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const hits = findTodoIds(root);
  for (const { file, line, id } of hits)
    console.error(`${file}:${line}: the comment names todo ${id}; keep todo ids in commit messages and plans`);
  if (hits.length > 0) process.exit(1);
  console.log("No todo ids in comments under packages/*/src.");
}
