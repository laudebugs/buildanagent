// Offline tests for fact-check-log.mjs; run with `node --test scripts/ci/*.test.mjs`. Most tests check a small log
// held in a string; the last ones run the script on a copy in a temporary directory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { cells, checkLog, codePoints, ROW_ID, readRows, references } from "./fact-check-log.mjs";

const script = fileURLToPath(new URL("./fact-check-log.mjs", import.meta.url));

/** A log with one table of the given rows and, unless `totals` is null, the given totals line. */
const log = (rows, totals = "**Totals:** 3 claims: 1 ✅, 1 ✏️, 1 ⚠️.") =>
  [
    "# Fact-check: a demo",
    "",
    "## Section",
    "",
    "| # | Claim | Where | Verdict | Source and reason |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...(totals === null ? [] : [totals, ""]),
  ].join("\n");

const legacy = [
  "| 1 | A claim | BK1 | ✅ | A source |",
  "| 2 | Corrects row 1 | BK1 | ✏️ | A source |",
  "| 3 | Our inference | BK2 | ⚠️ | Rows 1–2 |",
];

const messages = (text) => checkLog(text).problems.map((p) => p.message);

test("a log whose rows and totals agree has no problems", () => {
  assert.deepEqual(messages(log(legacy)), []);
});

test("legacy numbers and todo or branch ids may sit in one log, in any order", () => {
  const rows = [
    "| T31-1 | A claim | T31 | ✅ | A source |",
    legacy[0],
    "| docs/fix-links-1 | Corrects rows 1 and T31-1 | AGENTS.md | ✏️ | A source |",
    "| T31-2 | Corrected by row docs/fix-links-1 | T31 | ⚠️ | Rows T31-1–T31-2 |",
  ];
  assert.deepEqual(messages(log(rows, "**Totals:** 4 claims: 2 ✅, 1 ✏️, 1 ⚠️.")), []);
});

test("the id pattern takes legacy numbers, todo ids and branch names", () => {
  const good = ["1", "575", "8a", "T31-1", "B11b-3", "L4a-12", "docs/fix-links-2", "chore/fact-check-row-ids-1"];
  // Git allows `.`, `_` and upper case in a branch name; the count is still the digits after the last hyphen.
  good.push("deps/astro-5.2-1", "fix/node_modules.cache-3", "docs/Fix-README-2");
  for (const id of good) assert.ok(ROW_ID.test(id), id);
  const bad = ["", "0", "01", "T31", "T31-0", "T-1", "Docs/x-1", "docs/x", "#5", "5.1", "docs/x.-1", "docs/-1"];
  for (const id of bad) {
    assert.ok(!ROW_ID.test(id), id);
  }
});

test("a malformed or repeated id fails", () => {
  const rows = [legacy[0], "| T31 | A claim | T31 | ✅ | A source |", "| 1 | Again | BK1 | ✅ | A source |"];
  assert.deepEqual(messages(log(rows, null)), [
    'has the id "T31"; use a legacy number, <todo id>-<n> such as T31-2, or <branch>-<n> such as docs/fix-links-1. ' +
      "A branch starts with a lower-case letter, holds letters, digits, ., _, - and /, " +
      "and ends in a letter, digit or _",
    "repeats row 1, first used on line 7",
  ]);
});

test("a verdict cell must be exactly one of the three verdicts, and the message shows its code points", () => {
  const use = "use ✅ (U+2705), ✏️ (U+270F U+FE0F) or ⚠️ (U+26A0 U+FE0F)";
  // Row 4's pencil lacks the variation selector U+FE0F, so it looks right and is not ✏️.
  const rows = [
    "| 1 | A | B | ✅ ok | C |",
    "| 2 | A | B | ❌ | C |",
    "| 3 | A | B |  | C |",
    "| 4 | A | B | \u270F | C |",
  ];
  assert.deepEqual(messages(log(rows, null)), [
    `row 1's verdict is "✅ ok" (U+2705 U+0020 U+006F U+006B); ${use}`,
    `row 2's verdict is "❌" (U+274C); ${use}`,
    `row 3's verdict is "" (empty); ${use}`,
    `row 4's verdict is "\u270F" (U+270F); ${use}`,
  ]);
  assert.equal(codePoints("✏️"), "U+270F U+FE0F");
});

test("an escaped pipe stays inside its cell, and an unescaped one is reported", () => {
  assert.deepEqual(cells(String.raw`| 1 | \`a \| b\` | x |`), ["1", String.raw`\`a \| b\``, "x"]);
  const rows = [String.raw`| 1 | Both \|\| forms | BK1 | ✅ | A source |`, "| 2 | A `|| b` | BK1 | ✅ | A source |"];
  assert.deepEqual(messages(log(rows, null)), [
    String.raw`has 7 cells where its header has 5; escape a | inside a cell as \|`,
  ]);
});

test("a backslash escapes the character after it, as in GitHub, so \\\\| ends a cell", () => {
  assert.deepEqual(cells(String.raw`| 1 | a \\| b |`), ["1", String.raw`a \\`, "b"]);
  assert.deepEqual(cells(String.raw`| 1 | a \\\| b |`), ["1", String.raw`a \\\| b`]);
  assert.deepEqual(cells(String.raw`| 1 | ends in \\|`), ["1", String.raw`ends in \\`]);
  // Read as `\|`, the old reading, this row had four cells and failed; GitHub shows five.
  const row = String.raw`| 1 | A path C:\\| BK1 | ✅ | A source |`;
  assert.deepEqual(messages(log([row], null)), []);
  assert.equal(readRows(log([row], null)).rows[0].verdict, "✅");
});

test("a row set apart from its table by a blank line keeps the table's columns", () => {
  const text = log([legacy[0], "", legacy[1], "", legacy[2]]);
  assert.deepEqual(messages(text), []);
  assert.equal(checkLog(text).rows.length, 3);
});

test("prose or a code fence ends a table, and nothing inside a fence is read", () => {
  const after = [
    "",
    "Some prose after the table.",
    "",
    "| 9 | Not a row | x | ❌ | y |",
    "",
    "```text",
    "| 9 | Not a row | x | ❌ |",
    "```",
  ];
  const text = log(legacy, null) + after.join("\n");
  assert.deepEqual(messages(text), []);
  assert.equal(checkLog(text).rows.length, 3);
  const fenced = ["```", "| # | Claim | Verdict |", "| --- | --- | --- |", "| 1 | A | ✅ |", "```"].join("\n");
  assert.deepEqual(readRows(fenced).rows, []);
  // A fence right after the table, with no blank line, ends it too.
  const tight = log([legacy[0], "```", "| 9 | x |", "```"], null);
  assert.deepEqual(messages(tight), []);
});

test("the id column is found by its header, wherever it sits", () => {
  const text = [
    "| Claim | # | Verdict | Source |",
    "| --- | --- | --- | --- |",
    "| Corrects row 2 | 1 | ✅ | A |",
    "| A claim | 2 | ✏️ | Row 3 |",
  ].join("\n");
  const { rows } = readRows(text);
  assert.deepEqual(
    rows.map((r) => [r.id, r.verdict, r.rest]),
    [
      ["1", "✅", "Corrects row 2 | ✅ | A"],
      ["2", "✏️", "A claim | ✏️ | Row 3"],
    ],
  );
  assert.deepEqual(messages(text), ["row 2 cites row 3, which the log lacks"]);
});

test("tables without a # and a Verdict column are not read", () => {
  const text = `${log(legacy)}\n| Verdict | Rows |\n| --- | --- |\n| ✅ confirmed | 1 |\n`;
  assert.deepEqual(messages(text), []);
});

test("a cited row must exist in the log", () => {
  const rows = [...legacy, "| 4 | Corrects rows 3, 9 and T31-1 | BK1 | ✏️ | Rows 2–5 |"];
  assert.deepEqual(messages(log(rows, null)), [
    "row 4 cites row 9, which the log lacks",
    "row 4 cites row T31-1, which the log lacks",
    "row 4 cites row 5, which the log lacks",
  ]);
});

test('every row a range names is checked, whether it takes a dash, a hyphen or "to"', () => {
  assert.deepEqual(references("rows 3-5"), ["3", "4", "5"]);
  assert.deepEqual(references("rows 3 to 5 and 8–9"), ["3", "4", "5", "8", "9"]);
  assert.deepEqual(references("rows T31-1 to T31-3"), ["T31-1", "T31-2", "T31-3"]);
  assert.deepEqual(references("rows deps/astro-5.2-1–3"), ["deps/astro-5.2-1", "deps/astro-5.2-2", "deps/astro-5.2-3"]);
  // After a branch id a hyphen belongs to the id: its count is the digits after the last hyphen.
  assert.deepEqual(references("row docs/x-1-2"), ["docs/x-1-2"]);
  const rows = [...legacy, "| 4 | Rereads rows 2-6 and rows 1 to 7 | BK1 | ✅ | A source |"];
  assert.deepEqual(messages(log(rows, null)), [
    "row 4 cites row 5, which the log lacks",
    "row 4 cites row 6, which the log lacks",
    "row 4 cites row 7, which the log lacks",
  ]);
});

test("references read lists and ranges, and skip another log's rows", () => {
  assert.deepEqual(references("rows 26, 42 and 70; Row 8a; rows 401–403"), [
    "26",
    "42",
    "70",
    "8a",
    "401",
    "402",
    "403",
  ]);
  assert.deepEqual(references("rows T31-1–3 or T31-5"), ["T31-1", "T31-2", "T31-3", "T31-5"]);
  assert.deepEqual(references("rows T31-2–T31-3 and docs/fix-x-1"), ["T31-2", "T31-3", "docs/fix-x-1"]);
  assert.deepEqual(references("U18 fact-check rows 85 and 123; its row 90; its fact-check row 93"), []);
  assert.deepEqual(references("[U12 fact-check](../x.md), rows 88 and 90; [log](fact-check-y.md) row 3"), []);
  assert.deepEqual(references("Row 85 of [U19's fact-check](../x.md)"), []);
});

test("a row named after this log, or after a link to another kind of file, is checked", () => {
  assert.deepEqual(references("this fact-check row 5"), ["5"]);
  assert.deepEqual(references("see the fact-check, row 6"), ["6"]);
  assert.deepEqual(references("[the plan](../build-book.md), row 7"), []);
  assert.deepEqual(references("[the plan](../build-book.md#rows) row 7"), []);
  assert.deepEqual(references("[the config](../tsconfig.json), row 7"), ["7"]);
  assert.deepEqual(references("see the plan, row 7"), ["7"]);
  assert.deepEqual(references("a row, a 12-factor app, rows of numbers"), []);
});

test("references stay linear on input built to make a pattern backtrack", () => {
  // The first input once ran for minutes; the bound is coarse, about a thousand times what a linear scan needs.
  const inputs = [
    `${"[a](fact-check".repeat(3000)} row 5`,
    "row 5 [x](y) ".repeat(5000),
    "[a](fact-check row 5 ".repeat(5000),
  ];
  const started = performance.now();
  for (const input of inputs) references(input);
  assert.ok(performance.now() - started < 5000, "references took more than 5 s on adversarial input");
});

test("a wrong totals line fails, and the fixed text carries the computed line", () => {
  const result = checkLog(log(legacy, "**Totals:** 4 claims: 2 ✅, 1 ✏️, 1 ⚠️."));
  assert.deepEqual(
    result.problems.map((p) => p.message),
    [
      'the totals line says "**Totals:** 4 claims: 2 ✅, 1 ✏️, 1 ⚠️."; ' +
        'the rows give "**Totals:** 3 claims: 1 ✅, 1 ✏️, 1 ⚠️."',
    ],
  );
  assert.equal(result.text, log(legacy));
});

test("a totals line in another form fails, and a second one fails too", () => {
  assert.match(messages(log(legacy, "**Totals:** three claims."))[0], /is not in the form/);
  const twice = `${log(legacy)}**Totals:** 3 claims: 1 ✅, 1 ✏️, 1 ⚠️.\n`;
  assert.deepEqual(messages(twice), ["repeats the totals line of line 11; keep one"]);
});

test("a log without a totals line has only its rows checked", () => {
  const result = checkLog(log(legacy, null));
  assert.deepEqual(result.problems, []);
  assert.equal(result.totals, undefined);
});

/** Runs the script on one copy of a log; returns its exit status, output and the file afterwards. */
function run(text, ...args) {
  const dir = mkdtempSync(join(tmpdir(), "fact-check-log-"));
  try {
    const file = join(dir, "fact-check-demo.md");
    writeFileSync(file, text);
    const out = spawnSync(process.execPath, [script, ...args, file], { encoding: "utf8" });
    return { status: out.status, output: out.stdout + out.stderr, after: readFileSync(file, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the script fails on a wrong totals line and leaves the file alone", () => {
  const wrong = log(legacy, "**Totals:** 2 claims: 1 ✅, 1 ✏️, 0 ⚠️.");
  const { status, output, after } = run(wrong);
  assert.equal(status, 1);
  assert.match(output, /the totals line says/);
  assert.equal(after, wrong);
});

test("--write rewrites the totals line and passes", () => {
  const { status, output, after } = run(log(legacy, "**Totals:** 2 claims: 1 ✅, 1 ✏️, 0 ⚠️."), "--write");
  assert.equal(status, 0, output);
  assert.match(output, /wrote "\*\*Totals:\*\* 3 claims: 1 ✅, 1 ✏️, 1 ⚠️\."/);
  assert.equal(after, log(legacy));
});

test("--write still fails on a problem outside the totals line", () => {
  const { status, output } = run(log([...legacy, "| 3 | Again | BK1 | ✅ | A source |"], null), "--write");
  assert.equal(status, 1);
  assert.match(output, /repeats row 3/);
});

test("--write writes nothing when the log has a second totals line", () => {
  const twice = `${log(legacy, "**Totals:** 2 claims: 1 ✅, 1 ✏️, 0 ⚠️.")}**Totals:** 3 claims: 1 ✅, 1 ✏️, 1 ⚠️.\n`;
  const { status, output, after } = run(twice, "--write");
  assert.equal(status, 1);
  assert.match(output, /repeats the totals line/);
  assert.match(output, /wrote nothing/);
  assert.equal(after, twice);
});

test("--write writes nothing when another problem would block", () => {
  const wrong = log([...legacy, "| 3 | Again | BK1 | ✅ | A source |"], "**Totals:** 2 claims: 1 ✅, 1 ✏️, 0 ⚠️.");
  const { status, output, after } = run(wrong, "--write");
  assert.equal(status, 1);
  assert.match(output, /repeats row 3/);
  assert.equal(after, wrong);
});
