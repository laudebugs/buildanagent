/** The report a conformance suite returns: which cases passed, which skipped with a reason and which failed. */
export interface CaseReport {
  readonly passed: readonly string[];
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
  readonly failed: readonly { readonly name: string; readonly error: string }[];
}

/** A case a runner can call: a name, and a check that resolves with `{ skipped }` when the case doesn't apply. */
export interface RunnableCase {
  readonly name: string;
  run(): Promise<{ readonly skipped: string } | undefined>;
}

/** Runs each case once and sorts the outcomes: a rejection fails the case, and `{ skipped }` skips it with its reason. */
export async function runCases(cases: readonly RunnableCase[]): Promise<CaseReport> {
  const passed: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const conformance of cases) {
    try {
      const outcome = await conformance.run();
      if (outcome === undefined) passed.push(conformance.name);
      else skipped.push({ name: conformance.name, reason: outcome.skipped });
    } catch (error) {
      failed.push({ name: conformance.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { passed, skipped, failed };
}
