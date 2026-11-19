/** A fact-check verdict: ✅ confirmed, ✏️ corrected or ⚠️ unverified, or the text of a cell that is none of them. */
export type Verdict = "✅" | "✏️" | "⚠️" | { readonly other: string };

/** The verdicts a hand-checked marker may cite: the claim was confirmed, or corrected and then confirmed. */
export const CHECKED_VERDICTS: readonly Verdict[] = ["✅", "✏️"];

/** A chapter's fact-check log, read for its rows: each row number's verdict, and any number used twice. */
export interface FactCheckRows {
  readonly verdicts: ReadonlyMap<number, Verdict>;
  readonly repeated: ReadonlySet<number>;
}

/** The cells of a Markdown table row, split on every `|` that is not escaped as `\|`. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

function verdictOf(cell: string): Verdict {
  if (cell.startsWith("✅")) return "✅";
  // The emoji forms carry a variation selector, U+FE0F, which a writer may leave out.
  if (cell.startsWith("✏")) return "✏️";
  if (cell.startsWith("⚠")) return "⚠️";
  return { other: cell };
}

/**
 * The rows of every table in a log whose header has a `#` column and a `Verdict` column, in the format
 * `fact-checks/README.md` gives. A row whose `#` cell is not a whole number is skipped, such as a tally's row.
 */
export function readFactCheckRows(text: string): FactCheckRows {
  const verdicts = new Map<number, Verdict>();
  const repeated = new Set<number>();
  let columns: { readonly number: number; readonly verdict: number } | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("|")) {
      columns = undefined;
      continue;
    }
    const row = cells(line);
    if (columns === undefined) {
      const number = row.indexOf("#");
      const verdict = row.findIndex((cell) => cell.toLowerCase() === "verdict");
      if (number !== -1 && verdict !== -1) columns = { number, verdict };
      continue;
    }
    const id = row[columns.number] ?? "";
    if (!/^\d+$/.test(id)) continue;
    const n = Number(id);
    if (verdicts.has(n)) repeated.add(n);
    else verdicts.set(n, verdictOf(row[columns.verdict] ?? ""));
  }
  return { verdicts, repeated };
}
