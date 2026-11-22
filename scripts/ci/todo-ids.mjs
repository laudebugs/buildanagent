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

/**
 * The comments of a TypeScript source as `{ line, text }`, one for each line a comment covers. It tracks quotes and
 * template text so a `//` inside a string does not start a comment; a regular expression that holds a quote can fool
 * it, which can only hide a comment, never invent one.
 */
export function commentsOf(source) {
  const found = [];
  let line = 1;
  let i = 0;
  let quote = "";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\n") line++;
    if (quote !== "") {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      else if (ch === "\n" && quote !== "`") quote = "";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
    } else if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      found.push({ line, text: source.slice(i, stop) });
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      const lines = source.slice(i, stop).split("\n");
      for (const [offset, text] of lines.entries()) found.push({ line: line + offset, text });
      line += lines.length - 1;
      i = stop;
    } else {
      i++;
    }
  }
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
