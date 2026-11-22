// A runner for the package's tests inside workerd, where Vitest itself can't run. A test file imports `test`, `expect`
// and the hooks from "vitest"; the suite's bundle points that name here, so the same file runs unchanged in Node under
// Vitest and in workerd under this. It implements only what the portable tests use: `test`, `describe`, the four
// hooks, and the `expect` matchers `toContain` and `toBeGreaterThan`. A file that needs more is Node-only.
type Hook = () => unknown | Promise<unknown>;
interface Registered {
  readonly name: string;
  readonly run: () => unknown | Promise<unknown>;
  readonly beforeAll: readonly Hook[];
  readonly afterAll: readonly Hook[];
  readonly beforeEach: readonly Hook[];
  readonly afterEach: readonly Hook[];
}

const tests: Registered[] = [];
let prefix = "";
const hooks = { beforeAll: [] as Hook[], afterAll: [] as Hook[], beforeEach: [] as Hook[], afterEach: [] as Hook[] };

export function test(name: string, run: () => unknown | Promise<unknown>, _timeoutMs?: number): void {
  tests.push({
    name: `${prefix}${name}`,
    run,
    beforeAll: [...hooks.beforeAll],
    afterAll: [...hooks.afterAll],
    beforeEach: [...hooks.beforeEach],
    afterEach: [...hooks.afterEach],
  });
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

export const beforeAll = (hook: Hook): void => void hooks.beforeAll.push(hook);
export const afterAll = (hook: Hook): void => void hooks.afterAll.push(hook);
export const beforeEach = (hook: Hook): void => void hooks.beforeEach.push(hook);
export const afterEach = (hook: Hook): void => void hooks.afterEach.push(hook);

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

/** Runs one test with the hooks that surround it; each file-level `beforeAll` runs once, before its first test. */
async function runOne(registered: Registered, ranBeforeAll: Set<Hook>): Promise<TestResult> {
  try {
    for (const hook of registered.beforeAll.filter((each) => !ranBeforeAll.has(each))) {
      ranBeforeAll.add(hook);
      await hook();
    }
    for (const hook of registered.beforeEach) await hook();
    try {
      await registered.run();
    } finally {
      for (const hook of registered.afterEach) await hook();
    }
    return { name: registered.name };
  } catch (error) {
    return { name: registered.name, error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
  }
}

/** Runs every registered test in order, with its file-level hooks, and reports each one. */
export async function runRegistered(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const ranBeforeAll = new Set<Hook>();
  for (const registered of tests) results.push(await runOne(registered, ranBeforeAll));
  return results;
}
