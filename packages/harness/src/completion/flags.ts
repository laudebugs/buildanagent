/**
 * The diff flags: patterns in what a turn changed that suggest the checks were gamed instead of met. A flag is a
 * sentence for a person to read, never a verdict, because every pattern has honest causes.
 */

/** The text of each file the workspace held at one moment, by path relative to the workspace root. */
export type WorkspaceSnapshot = ReadonlyMap<string, string>;

/** The most flags one check records. The last entry says how many more there were. */
export const MAX_FLAGS = 100;

const SKIP_MARKER = /\.skip\(|\bxit\(|@pytest\.mark\.skip/;
const PLACEHOLDER = /\b(?:TODO|FIXME)\b|not implemented/i;
const FAKE_NAME = /mock|stub|fake/i;
const TEST_DIRECTORY = /(?:^|\/)(?:tests?|__tests__)\//;
const TEST_NAME = /(?:\.(?:test|spec)\.[a-z]+|_test\.[a-z]+)$|^test_.*\.py$/;
// An assertion line: `expect(`, `assert(`, `assert.x(`, `assertEqual(`, `self.assertX(` or a Python `assert` statement.
const ASSERTION = /\bexpect\s*\(|\bassert\w*\s*[.(]|^\s*assert\s/;
const LINE_LIMIT = 80;

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** Whether a path looks like a test file: in a `test`, `tests` or `__tests__` folder, or named as a test. */
export function isTestFile(path: string): boolean {
  return TEST_DIRECTORY.test(path) || TEST_NAME.test(baseName(path));
}

const clip = (line: string): string => {
  const text = line.trim();
  return text.length > LINE_LIMIT ? `${text.slice(0, LINE_LIMIT)}...` : text;
};

/** The lines of `after` that `before` lacks, counting repeats, so a moved line is not an added one. */
function addedLines(before: string, after: string): string[] {
  const seen = new Map<string, number>();
  for (const line of before.split("\n")) seen.set(line, (seen.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of after.split("\n")) {
    const left = seen.get(line) ?? 0;
    if (left > 0) seen.set(line, left - 1);
    else added.push(line);
  }
  return added;
}

const countAssertions = (text: string): number => text.split("\n").filter((line) => ASSERTION.test(line)).length;

/** The flags for the lines a modified or new file added: skip markers and placeholders. */
function lineFlags(path: string, before: string | undefined, after: string): string[] {
  const flags: string[] = [];
  for (const line of addedLines(before ?? "", after)) {
    if (SKIP_MARKER.test(line)) flags.push(`skip marker added: ${path}: ${clip(line)}`);
    if (PLACEHOLDER.test(line)) flags.push(`placeholder added: ${path}: ${clip(line)}`);
  }
  return flags;
}

function assertionFlags(path: string, before: string, after: string): string[] {
  if (!isTestFile(path)) return [];
  const was = countAssertions(before);
  const now = countAssertions(after);
  return now < was ? [`fewer assertion lines in ${path}: ${was} before, ${now} after`] : [];
}

function flagsForFile(path: string, before: string | undefined, after: string | undefined): string[] {
  if (after === undefined) return before !== undefined && isTestFile(path) ? [`test file deleted: ${path}`] : [];
  const flags =
    before === undefined && FAKE_NAME.test(baseName(path)) ? [`mock, stub or fake file added: ${path}`] : [];
  flags.push(...lineFlags(path, before, after));
  if (before !== undefined) flags.push(...assertionFlags(path, before, after));
  return flags;
}

/**
 * Compares the workspace at the start of a turn with the end, and returns one sentence for each pattern the plan names:
 * an added skip marker (`.skip(`, `xit(` or `@pytest.mark.skip`), an added placeholder (`TODO`, `FIXME` or "not
 * implemented"), a new file whose name has `mock`, `stub` or `fake` in it, a deleted test file, and a test file with
 * fewer assertion lines than before. Paths come out in sorted order, so the same change gives the same flags.
 */
export function flagChanges(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const flags = paths.flatMap((path) => flagsForFile(path, before.get(path), after.get(path)));
  if (flags.length <= MAX_FLAGS) return flags;
  return [...flags.slice(0, MAX_FLAGS), `${flags.length - MAX_FLAGS} more flags not listed`];
}
