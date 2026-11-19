// Checks the shared fact-check logs, docs/plans/reviews/fact-check-*.md, and keeps their totals lines true.
//
// For each log it reads every table whose header has a `#` column and a `Verdict` column, and fails when:
// - a row has more or fewer cells than its header (an unescaped `|` in a cell; write `\|`),
// - a row id is malformed or used twice (an id is a legacy number, `T31-2` for a todo's rows, or
//   `docs/fix-links-1` for a branch without a todo; ID below),
// - a verdict cell is anything but ✅, ✏️ or ⚠️,
// - a row cites `row X` or `rows X–Y` and no such row exists in the log,
// - the `**Totals:** N claims: a ✅, b ✏️, c ⚠️.` line disagrees with the rows. A log without a totals line has its
//   rows checked and no totals.
//
// `--write` rewrites each totals line from the rows instead of failing on it; the other checks still fail.
// Pass log paths to check only those; with none it checks every docs/plans/reviews/fact-check-*.md.
// Chapter logs in apps/manual/fact-checks/ are not covered: each has one writer, keeps plain numbers that the
// chapter's `{checked=row-N}` markers cite, and ends with a tally table that `check:book` reads.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VERDICTS = ["✅", "✏️", "⚠️"];

// A todo id, as the files in docs/todos/ name them: T31, B11b, L4a.
const TODO = String.raw`[A-Z]\d+[a-z]?`;
// A branch name without a todo, lower case, its `/` kept: docs/fix-links, chore/fact-check-row-ids.
const BRANCH = "[a-z][a-z0-9]*(?:[-/][a-z0-9]+)*";
// A row id: a todo's or branch's prefix and a count within it (T31-2, docs/fix-links-1), or a legacy number (1, 575),
// which may carry a letter for a row inserted later (8a).
const ID = String.raw`(?:(?:${TODO}|${BRANCH})-[1-9]\d*|[1-9]\d*[a-z]?)`;
export const ROW_ID = new RegExp(`^${ID}$`);

const TOTALS = /^\*\*Totals:\*\*/;
const TOTALS_LINE = /^\*\*Totals:\*\* (\d+) claims: (\d+) ✅, (\d+) ✏️, (\d+) ⚠️\.$/;

// `row 12`, `rows 401–404`, `rows 26, 42 and 70`, `row T31-3`, `rows T31-1–T31-4`: the word, then ids joined by
// commas, "and", "or" or a dash. A range takes an en dash (or an em dash); a hyphen belongs to the id.
const LIST_SEP = String.raw`(?:\s*[–—]\s*|,\s+(?:and\s+|or\s+)?|\s+(?:and|or)\s+)`;
const REFERENCE = new RegExp(String.raw`\b[Rr]ows?\s+(${ID}(?:${LIST_SEP}${ID})*)(?![\w-])`, "g");

/** The cells of a Markdown table row, split on every `|` that is not escaped as `\|`. */
export function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

const isTableLine = (line) => line.trimStart().startsWith("|");
const isSeparator = (line) => isTableLine(line) && cells(line).every((cell) => /^:?-+:?$/.test(cell));

/**
 * The claim rows of a log, with the line each sits on (counting from 1), and the problems in its tables' shape.
 * A table's columns come from its header; a row set apart from its table by a blank line keeps that table's columns.
 */
export function readRows(text) {
  const lines = text.split("\n");
  const rows = [];
  const problems = [];
  let columns;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isTableLine(line) || isSeparator(line)) continue;
    const row = cells(line);
    if (i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const id = row.indexOf("#");
      const verdict = row.findIndex((cell) => cell.toLowerCase() === "verdict");
      columns = id !== -1 && verdict !== -1 ? { id, verdict, count: row.length } : undefined;
      continue;
    }
    if (columns === undefined) continue;
    if (row.length !== columns.count) {
      problems.push({
        line: i + 1,
        message: `has ${row.length} cells where its header has ${columns.count}; escape a | inside a cell as \\|`,
      });
      continue;
    }
    rows.push({ line: i + 1, id: row[columns.id], verdict: row[columns.verdict], text: line });
  }
  return { rows, problems };
}

// Text just before `row` that names another log, whose rows these are: "U18 fact-check row 85", "its row 90",
// "[U12 fact-check](…), rows 88 and 90", "[fact-check-browser-use.md](…) rows 112"; or just after it:
// "Row 85 of [U19's fact-check](…)".
const ANOTHER_LOG_BEFORE = /(?:fact-check\S*|\]\([^)]*\)|\bits|\btheir)[\s,]*$/i;
const ANOTHER_LOG_AFTER = /^\s+(?:of|in)\s+\[?[^|]{0,40}?fact-check/i;

/**
 * Every id of this log's rows that a row's text cites, with ranges expanded; a range that cannot be expanded is
 * returned as its two ends. A citation of another log's rows is skipped.
 */
export function references(text) {
  const ids = [];
  for (const match of text.matchAll(REFERENCE)) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    if (ANOTHER_LOG_BEFORE.test(before) || ANOTHER_LOG_AFTER.test(after)) continue;
    const parts = match[1].split(new RegExp(`(${LIST_SEP})`));
    // parts alternates id, separator, id, …; a dash joins the id before it and the id after it into a range.
    for (let k = 0; k < parts.length; k += 2) {
      if (k > 0 && /[–—]/.test(parts[k - 1])) ids.push(...range(ids.pop(), parts[k]));
      else ids.push(parts[k]);
    }
  }
  return [...new Set(ids)];
}

/** The ids from `from` to `to`, both included, when both share a prefix and the range is short and ascending. */
function range(from, to) {
  const split = (id) => {
    const m = /^(?:(.+)-)?(\d+)$/.exec(id);
    return m === null ? undefined : { prefix: m[1] ?? "", n: Number(m[2]) };
  };
  const a = split(from);
  // A legacy id with a letter, such as 8a, starts or ends no range we expand.
  if (a === undefined || split(to) === undefined) return [from, to];
  // `rows T31-1–3` is read as T31-1 to T31-3.
  const b = /^\d+$/.test(to) && a.prefix !== "" ? { prefix: a.prefix, n: Number(to) } : split(to);
  if (a.prefix !== b.prefix || b.n < a.n || b.n - a.n > 200) return [from, to];
  const ids = [];
  for (let n = a.n; n <= b.n; n++) ids.push(a.prefix === "" ? String(n) : `${a.prefix}-${n}`);
  return ids;
}

/** Counts of each verdict over the rows. */
export function count(rows) {
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const row of rows) if (row.verdict in counts) counts[row.verdict]++;
  return counts;
}

/** The totals line for the given counts. */
export function totalsLine(counts) {
  const total = VERDICTS.reduce((sum, v) => sum + counts[v], 0);
  return `**Totals:** ${total} claims: ${counts["✅"]} ✅, ${counts["✏️"]} ✏️, ${counts["⚠️"]} ⚠️.`;
}

/**
 * Checks one log's text. Returns its problems, each with a line number, and the text with its totals line
 * rewritten from the rows, which equals the input when the line was already right or the log has none.
 */
export function checkLog(text) {
  const { rows, problems } = readRows(text);
  const seen = new Map();
  for (const row of rows) {
    if (!ROW_ID.test(row.id)) {
      problems.push({
        line: row.line,
        message: `has the id "${row.id}"; use a legacy number, <todo id>-<n> such as T31-2, or <branch>-<n>`,
      });
    } else if (seen.has(row.id)) {
      problems.push({ line: row.line, message: `repeats row ${row.id}, first used on line ${seen.get(row.id)}` });
    } else {
      seen.set(row.id, row.line);
    }
    if (!VERDICTS.includes(row.verdict)) {
      problems.push({ line: row.line, message: `row ${row.id}'s verdict is "${row.verdict}"; use ✅, ✏️ or ⚠️` });
    }
  }
  for (const row of rows) {
    // The id cell itself is not a reference.
    const rest = cells(row.text).slice(1).join(" | ");
    for (const id of references(rest)) {
      if (!seen.has(id))
        problems.push({ line: row.line, message: `row ${row.id} cites row ${id}, which the log lacks` });
    }
  }

  const lines = text.split("\n");
  const at = lines.findIndex((line) => TOTALS.test(line));
  if (at === -1) return { problems, rows, text, totals: undefined };
  const again = lines.findIndex((line, i) => i > at && TOTALS.test(line));
  if (again !== -1) problems.push({ line: again + 1, message: `repeats the totals line of line ${at + 1}; keep one` });
  const expected = totalsLine(count(rows));
  const fixed = [...lines];
  fixed[at] = expected;
  if (lines[at] !== expected) {
    const written = TOTALS_LINE.test(lines[at]) ? "says" : "is not in the form";
    problems.push({
      line: at + 1,
      totals: true,
      message: `the totals line ${written} "${lines[at]}"; the rows give "${expected}"`,
    });
  }
  return { problems, rows, text: fixed.join("\n"), totals: { line: at + 1, was: lines[at], is: expected } };
}

/** Every shared fact-check log under a repository root, as paths relative to it. */
export function defaultLogs(root) {
  const dir = path.join("docs", "plans", "reviews");
  return readdirSync(path.join(root, dir))
    .filter((name) => /^fact-check-.+\.md$/.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

function main(argv) {
  const write = argv.includes("--write");
  const given = argv.filter((arg) => arg !== "--write");
  const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const files = given.length > 0 ? given : defaultLogs(root);
  let failed = false;
  for (const file of files) {
    const full = path.resolve(root, file);
    const text = readFileSync(full, "utf8");
    const result = checkLog(text);
    for (const problem of result.problems) {
      if (write && problem.totals) continue;
      failed = true;
      console.error(`${file}:${problem.line}: ${problem.message}`);
    }
    if (write && result.text !== text) {
      writeFileSync(full, result.text);
      console.log(`${file}:${result.totals.line}: wrote "${result.totals.is}" (was "${result.totals.was}")`);
    }
  }
  if (failed) {
    console.error(
      "\nFact-check logs: fix the rows above. Run `pnpm fact-check-logs --write` to rewrite a totals line; never renumber rows.",
    );
    process.exit(1);
  }
  console.log(`Fact-check logs: ${files.length} checked, no problems.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
