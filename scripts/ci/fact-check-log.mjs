// Checks the shared fact-check logs, docs/plans/reviews/fact-check-*.md, and keeps their totals lines true.
//
// For each log it reads every table whose header has a `#` column and a `Verdict` column, and fails when:
// - a row has more or fewer cells than its header (an unescaped `|` in a cell; write `\|`),
// - a row id is malformed or used twice (an id is a legacy number, `T31-2` for a todo's rows, or
//   `docs/fix-links-1` for a branch without a todo; ID below),
// - a verdict cell is anything but ✅, ✏️ or ⚠️,
// - a row cites `row X` or `rows X–Y` (or `X-Y`, `X to Y`) and no such row exists in the log,
// - the `**Totals:** N claims: a ✅, b ✏️, c ⚠️.` line disagrees with the rows. A log without a totals line has its
//   rows checked and no totals.
//
// `--write` rewrites each totals line from the rows instead of failing on it; the other checks still fail, and a
// log with any other problem is left unwritten.
// Pass log paths to check only those; with none it checks every docs/plans/reviews/fact-check-*.md.
// Chapter logs in apps/manual/fact-checks/ are not covered: each has one writer, keeps plain numbers that the
// chapter's `{checked=row-N}` markers cite, and ends with a tally table that `check:book` reads.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VERDICTS = ["✅", "✏️", "⚠️"];

// A todo id, as the files in docs/todos/ name them: T31, B11b, L4a.
const TODO = String.raw`[A-Z]\d+[a-z]?`;
// A branch name without a todo, its `/` kept: docs/fix-links, chore/fact-check-row-ids, deps/astro-5.2, fix/a_b.
// It starts with a lower-case letter, holds letters, digits, `.`, `_`, `-` and `/`, and ends in a letter, digit or
// `_`. A todo id starts upper case, so the two never meet, and the row count is the digits after the last hyphen.
const BRANCH = "[a-z](?:[A-Za-z0-9._/-]*[A-Za-z0-9_])?";
// A row id: a todo's or branch's prefix and a count within it (T31-2, docs/fix-links-1), or a legacy number (1, 575),
// which may carry a letter for a row inserted later (8a).
const ID = String.raw`(?:(?:${TODO}|${BRANCH})-[1-9]\d*|[1-9]\d*[a-z]?)`;
export const ROW_ID = new RegExp(`^${ID}$`);

const TOTALS = /^\*\*Totals:\*\*/;
const TOTALS_LINE = /^\*\*Totals:\*\* (\d+) claims: (\d+) ✅, (\d+) ✏️, (\d+) ⚠️\.$/;

// `row 12`, `rows 401–404`, `rows 26, 42 and 70`, `row T31-3`, `rows T31-1–T31-4`, `rows 3-5`, `rows 3 to 5`: the
// word, then ids joined by commas, "and", "or", a dash or "to". A range takes an en dash, an em dash or "to"; a
// hyphen makes a range only after a legacy number, because after a todo or branch id it belongs to the id.
const RANGE_SEP = String.raw`(?:\s*[–—]\s*|\s+to\s+|-(?=\d))`;
const LIST_SEP = String.raw`(?:${RANGE_SEP}|,\s+(?:and\s+|or\s+)?|\s+(?:and|or)\s+)`;
const REFERENCE = new RegExp(String.raw`\b[Rr]ows?\s+(${ID}(?:${LIST_SEP}${ID})*)(?![\w-])`, "g");
const ID_AT = new RegExp(ID, "y");
const LIST_SEP_AT = new RegExp(LIST_SEP, "y");

/**
 * The cells of a Markdown table row, split as GitHub splits them: a backslash escapes the character after it, so `\|`
 * stays inside its cell, while `\\|` is an escaped backslash followed by a cell break.
 */
export function cells(line) {
  const text = line.trim();
  const found = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) {
      cell += text[i] + text[i + 1];
      i++;
    } else if (text[i] === "|") {
      found.push(cell);
      cell = "";
    } else {
      cell += text[i];
    }
  }
  found.push(cell);
  // A leading pipe opens the first cell and a trailing one closes the last; neither adds a cell.
  if (text.startsWith("|")) found.shift();
  if (found.length > 0 && found.at(-1) === "" && text.endsWith("|") && text !== "|") found.pop();
  return found.map((c) => c.trim());
}

const isTableLine = (line) => line.trimStart().startsWith("|");
const isSeparator = (line) => isTableLine(line) && cells(line).every((cell) => /^:?-+:?$/.test(cell));
const isFence = (line) => /^\s{0,3}(?:```|~~~)/.test(line);

/**
 * The claim rows of a log, with the line each sits on (counting from 1), and the problems in its tables' shape.
 * A table's columns come from its header. A row set apart from its table only by blank lines keeps that table's
 * columns; any other line, a code fence among them, ends the table, and nothing inside a fence is read.
 */
export function readRows(text) {
  const lines = text.split("\n");
  const rows = [];
  const problems = [];
  let columns;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isFence(line)) {
      fenced = !fenced;
      columns = undefined;
      continue;
    }
    if (fenced) continue;
    if (!isTableLine(line)) {
      if (line.trim() !== "") columns = undefined;
      continue;
    }
    if (isSeparator(line)) continue;
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
    // The id cell itself is not a reference, so `rest` leaves it out wherever the header puts it.
    const rest = row.filter((_, k) => k !== columns.id).join(" | ");
    rows.push({ line: i + 1, id: row[columns.id], verdict: row[columns.verdict], text: line, rest });
  }
  return { rows, problems };
}

// Text just before `row` that names another log, whose rows these are:
// - a todo id, "its" or "their" before "fact-check": "U18 fact-check row 85", "its fact-check row 93";
// - a link to a fact-check file, or one whose text says fact-check: "[U12 fact-check](…), rows 88 and 90",
//   "[fact-check-browser-use.md](…) rows 112";
// - "its" or "their" alone, for the log the sentence just named: "its row 90".
// Or text just after it: "Row 85 of [U19's fact-check](…)". "This fact-check row 5" names this log and is checked.
const LINK_TO_LOG = String.raw`\[[^\]]*\]\([^)]*fact-check[^)]*\)|\[[^\]]*fact-check[^\]]*\]\([^)]*\)`;
const ANOTHER_LOG_BEFORE = new RegExp(
  String.raw`(?:(?:\b${TODO}(?:'s)?|\bits|\btheir)\s+fact-check|${LINK_TO_LOG}|\bits|\btheir)[\s,]*$`,
  "i",
);
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
    // Read id, separator, id, …; a range separator joins the id before it and the id after it into a range.
    const list = match[1];
    let at = 0;
    let joinsRange = false;
    for (;;) {
      ID_AT.lastIndex = at;
      const id = ID_AT.exec(list);
      if (id === null) break;
      if (joinsRange) ids.push(...range(ids.pop(), id[0]));
      else ids.push(id[0]);
      at = ID_AT.lastIndex;
      LIST_SEP_AT.lastIndex = at;
      const sep = LIST_SEP_AT.exec(list);
      if (sep === null) break;
      joinsRange = /^(?:\s*[–—]\s*|\s+to\s+|-)$/.test(sep[0]);
      at = LIST_SEP_AT.lastIndex;
    }
  }
  return [...new Set(ids)];
}

/** The ids from `from` to `to`, both included, when both share a prefix and the range is short and ascending. */
function range(from, to) {
  // The count is the digits after the last hyphen, so `deps/astro-5.2-3` splits into deps/astro-5.2 and 3.
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

/** A string's code points, such as "U+270F U+FE0F", so a look-alike verdict shows what it holds. */
export function codePoints(text) {
  if (text === "") return "empty";
  return [...text].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
}

const VERDICT_HELP = VERDICTS.map((v) => `${v} (${codePoints(v)})`)
  .join(", ")
  .replace(/, (?=[^,]*$)/, " or ");

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
        message:
          `has the id "${row.id}"; use a legacy number, <todo id>-<n> such as T31-2, or <branch>-<n> such as ` +
          "docs/fix-links-1, where the branch starts with a lower-case letter, holds letters, digits, ., _, - and /, " +
          "and ends in a letter, digit or _",
      });
    } else if (seen.has(row.id)) {
      problems.push({ line: row.line, message: `repeats row ${row.id}, first used on line ${seen.get(row.id)}` });
    } else {
      seen.set(row.id, row.line);
    }
    if (!VERDICTS.includes(row.verdict)) {
      problems.push({
        line: row.line,
        message: `row ${row.id}'s verdict is "${row.verdict}" (${codePoints(row.verdict)}); use ${VERDICT_HELP}`,
      });
    }
  }
  for (const row of rows) {
    for (const id of references(row.rest)) {
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
    // With --write, a wrong totals line is fixed rather than reported; every other problem still fails the run.
    const blocking = result.problems.filter((problem) => !(write && problem.totals));
    for (const problem of blocking) console.error(`${file}:${problem.line}: ${problem.message}`);
    if (blocking.length > 0) failed = true;
    if (write && result.text !== text && blocking.length > 0) {
      console.error(`${file}: wrote nothing; fix the problems above first`);
    } else if (write && result.text !== text) {
      writeFileSync(full, result.text);
      console.log(`${file}:${result.totals.line}: wrote "${result.totals.is}" (was "${result.totals.was}")`);
    }
  }
  if (failed) {
    console.error(
      "\nFact-check logs: fix the rows above. Run `pnpm fact-check-logs --write` to rewrite a totals line; " +
        "never renumber rows.",
    );
    process.exit(1);
  }
  console.log(`Fact-check logs: ${files.length} checked, no problems.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
