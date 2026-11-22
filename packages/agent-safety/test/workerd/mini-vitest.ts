// A runner for the package's tests inside workerd, where Vitest itself can't run. A test file imports `test` and `expect`
// from "vitest"; the suite's bundle points that name here, so the same file runs unchanged in Node under Vitest and in
// workerd under this. It implements only what the portable tests use: `test`, `describe` (which only prefixes the names
// of the tests inside it) and the `expect` matchers `toContain` and `toBeGreaterThan`. It has no hooks, because hooks
// would need a scope for each file and each `describe`; a file that imports one fails to bundle, and stays Node-only.
interface Registered {
  readonly name: string;
  readonly run: () => unknown | Promise<unknown>;
}

const tests: Registered[] = [];
let prefix = "";

export function test(name: string, run: () => unknown | Promise<unknown>, _timeoutMs?: number): void {
  tests.push({ name: `${prefix}${name}`, run });
}

export function describe(name: string, body: () => void): void {
  const before = prefix;
  prefix = `${prefix}${name} > `;
  try {
    body();
  } finally {
    prefix = before;
  }
}

export function expect(actual: unknown) {
  return {
    toContain(expected: unknown) {
      const holds =
        typeof actual === "string" ? actual.includes(String(expected)) : (actual as unknown[]).includes(expected);
      if (!holds) throw new Error(`expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
    },
    toBeGreaterThan(expected: number) {
      if (!((actual as number) > expected))
        throw new Error(`expected ${String(actual)} to be greater than ${expected}`);
    },
  };
}

/** What one test did. */
export interface TestResult {
  readonly name: string;
  readonly error?: string;
}

/** Runs every registered test in order and reports each one. */
export async function runRegistered(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const registered of tests) {
    try {
      await registered.run();
      results.push({ name: registered.name });
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      results.push({ name: registered.name, error: message });
    }
  }
  return results;
}
