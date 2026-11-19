/** One line of a listing: its number in the source file and its text, with the region's indentation removed. */
export interface SourceLine {
  readonly number: number;
  readonly text: string;
  /** The id of the `// book:note <id>` marker the line ended with, which its text no longer holds. */
  readonly note?: string;
}

/** A failure inside the listed file, with the file's own line when one applies. */
export interface RegionError {
  readonly message: string;
  readonly line?: number;
}

const REGION = /^\s*\/\/\s*#region\b\s*(.*?)\s*$/;
const END_REGION = /^\s*\/\/\s*#endregion\b\s*(.*?)\s*$/;
/** A note marker at the end of a code line, `// book:note <id>`, with the space before it. */
const NOTE = /\s*\/\/\s*book:note\b\s*(.*?)\s*$/;
/** A region name: kebab-case, like every other id in the book. */
const REGION_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Region {
  readonly start: number;
  readonly end: number;
}

/**
 * Finds the `// #region <name>` and `// #endregion` markers in a file's lines. Regions may nest, and an `#endregion`
 * may repeat its region's name. Markers are found line by line, without parsing the code, so a line inside a template
 * literal or a block comment that starts with `// #region` also counts as a marker. Returns each region's marker lines (0-based) and the set of every marker line, or
 * the first malformed marker with its 1-based line.
 */
export function parseRegions(
  lines: readonly string[],
): { readonly regions: ReadonlyMap<string, Region>; readonly markers: ReadonlySet<number> } | RegionError {
  const regions = new Map<string, Region>();
  const markers = new Set<number>();
  const open: { name: string; start: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const start = REGION.exec(line);
    if (start) {
      const name = start[1] ?? "";
      if (!REGION_NAME.test(name)) {
        return {
          message: `#region needs a kebab-case name, as in // #region tool-loop; got "${name}"`,
          line: index + 1,
        };
      }
      if (regions.has(name) || open.some((region) => region.name === name)) {
        return { message: `#region ${name} appears twice`, line: index + 1 };
      }
      open.push({ name, start: index });
      markers.add(index);
      continue;
    }
    const end = END_REGION.exec(line);
    if (!end) continue;
    const region = open.pop();
    const name = end[1] ?? "";
    if (region === undefined) return { message: "#endregion has no #region before it", line: index + 1 };
    if (name !== "" && name !== region.name) {
      return { message: `#endregion ${name} closes #region ${region.name}`, line: index + 1 };
    }
    regions.set(region.name, { start: region.start, end: index });
    markers.add(index);
  }
  const unclosed = open.at(-1);
  if (unclosed !== undefined)
    return { message: `#region ${unclosed.name} has no #endregion`, line: unclosed.start + 1 };
  return { regions, markers };
}

/**
 * Takes the `// book:note <id>` markers off the ends of a file's lines. Each marker's id must be kebab-case and unique
 * in the file, and it must follow code on its line, because the note belongs to that line. Like region markers, a
 * marker is found by its text alone, so one inside a string or a block comment also counts. Returns each line's text
 * and note id, or the first malformed marker with its 1-based line.
 */
export function parseNotes(
  lines: readonly string[],
): readonly { readonly text: string; readonly note?: string }[] | RegionError {
  const seen = new Map<string, number>();
  const out: { text: string; note?: string }[] = [];
  for (const [index, line] of lines.entries()) {
    const match = NOTE.exec(line);
    if (!match) {
      out.push({ text: line });
      continue;
    }
    const id = match[1] ?? "";
    const text = line.slice(0, match.index);
    if (!REGION_NAME.test(id)) {
      return {
        message: `book:note needs a kebab-case id, as in // book:note first-call; got "${id}"`,
        line: index + 1,
      };
    }
    if (text.trim() === "") {
      return {
        message: `book:note ${id} must end the line of code it annotates, not stand on its own line`,
        line: index + 1,
      };
    }
    const earlier = seen.get(id);
    if (earlier !== undefined) {
      return { message: `book:note ${id} appears twice; it is already on line ${earlier}`, line: index + 1 };
    }
    seen.set(id, index + 1);
    out.push({ text, note: id });
  }
  return out;
}

/** Removes the indentation every non-blank line shares, so a region cut from inside a block starts at the margin. */
function dedent(lines: readonly SourceLine[]): SourceLine[] {
  const indents = lines.filter((line) => line.text.trim() !== "").map((line) => /^[ \t]*/.exec(line.text)?.[0].length);
  const shared = Math.min(...indents.map((n) => n ?? 0));
  return lines.map((line) => ({ ...line, text: line.text.slice(Math.min(shared, line.text.length)) }));
}

/**
 * The lines a listing shows: the named region of `text`, or the whole file when `region` is undefined, with every
 * region marker inside it left out, each note marker taken off its line, its shared indentation removed and blank lines
 * at either end dropped. Each line keeps its number in the file, so the caption and the line numbers name the lines a
 * reader finds in the file.
 */
export function cutRegion(text: string, region: string | undefined): readonly SourceLine[] | RegionError {
  const raw = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const parsed = parseRegions(raw);
  if ("message" in parsed) return parsed;
  const noted = parseNotes(raw);
  if ("message" in noted) return noted;
  const lines = noted.map((line) => line.text);
  let from = 0;
  let to = lines.length;
  if (region !== undefined) {
    const found = parsed.regions.get(region);
    if (found === undefined) {
      const names = [...parsed.regions.keys()].sort();
      const known = names.length === 0 ? "it marks no regions" : `its regions are ${names.join(", ")}`;
      return { message: `has no region "${region}"; ${known}` };
    }
    from = found.start + 1;
    to = found.end;
  }
  const kept: SourceLine[] = [];
  for (let index = from; index < to; index++) {
    if (parsed.markers.has(index)) continue;
    const note = noted[index]?.note;
    kept.push({ number: index + 1, text: lines[index] ?? "", ...(note === undefined ? {} : { note }) });
  }
  const first = kept.findIndex((line) => line.text.trim() !== "");
  const last = kept.findLastIndex((line) => line.text.trim() !== "");
  if (first === -1) return { message: region === undefined ? "is empty" : `has an empty region "${region}"` };
  return dedent(kept.slice(first, last + 1));
}
