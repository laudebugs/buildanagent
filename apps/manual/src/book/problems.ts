/** One broken rule: the file it is in, the line when one applies, and what to fix. */
export interface Problem {
  readonly file: string;
  readonly line?: number;
  readonly message: string;
}

/** Formats a problem the way compilers do, `file:line: message`, so editors can jump to it. */
export function formatProblem({ file, line, message }: Problem): string {
  return line === undefined ? `${file}: ${message}` : `${file}:${line}: ${message}`;
}

/**
 * The book's data breaks one or more rules. It carries every problem found, not just the first, so one run of
 * `check:book` or the build lists everything to fix.
 */
export class BookError extends Error {
  override readonly name = "BookError";
  readonly problems: readonly Problem[];

  constructor(problems: readonly Problem[]) {
    super(`The book has ${problems.length} problem(s):\n${problems.map(formatProblem).join("\n")}`);
    this.problems = problems;
  }
}

/** Collects problems while a check runs, then throws them together. */
export class ProblemList {
  readonly #problems: Problem[] = [];

  add(file: string, message: string, line?: number): void {
    this.#problems.push(line === undefined ? { file, message } : { file, line, message });
  }

  get all(): readonly Problem[] {
    return this.#problems;
  }

  throwIfAny(): void {
    if (this.#problems.length > 0) throw new BookError(this.#problems);
  }
}
