/**
 * The sandbox conformance suite: what every `SandboxClient` must do, whatever its tier. The cases that need a backend to
 * enforce something run only when its `stops` claim it, so a `none` backend passes the rest and an honest `srt` or
 * Docker backend passes them all. A backend that can't start makes every case skip with its reason, never fail. The cases
 * import no test runner and no Node module, so any runner can call them, in workerd too.
 */
import { isHarnessError } from "../errors.js";
import { SandboxDeniedError, SandboxUnavailableError } from "../sandbox/errors.js";
import type { ExecResult, Sandbox, SandboxClient, SandboxPolicy } from "../sandbox/types.js";

/** What a factory returns: the backend, and the absolute folder to use as the workspace root. */
export interface SandboxUnderTest {
  readonly client: SandboxClient;
  /** An absolute folder that exists, empty. A sibling named `<root>-outside` stands for a path the policy refuses. */
  readonly root: string;
}

/** Makes a fresh backend and workspace for each case. */
export type SandboxFactory = () => SandboxUnderTest | Promise<SandboxUnderTest>;

/** The options of the suite. */
export interface SandboxConformanceOptions {
  /**
   * Builds a command that tries to reach `host` and exits 0 if it can, for the network case. Without it that case skips,
   * because a portable command to open a connection doesn't exist.
   */
  readonly networkProbe?: (host: string) => readonly string[];
}

/** One conformance case: a name a test runner can show, and a check that rejects if the backend breaks the rule. */
export interface SandboxCase {
  readonly name: string;
  /** Runs the check. It resolves with `{ skipped }` and a reason when the case doesn't apply to this backend. */
  run(): Promise<{ readonly skipped: string } | undefined>;
}

/** The outcome of `runSandboxConformance()`. */
export interface SandboxConformanceReport {
  readonly passed: readonly string[];
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
  readonly failed: readonly { readonly name: string; readonly error: string }[];
}

const STOPS = ["mistakes", "exfiltration", "hostile_process"];
const ALLOWED_HOST = "allowed.test";
// Variables a program may add to its own environment on start, which a case ignores when it counts the variables.
const ADDED_BY_RUNTIMES = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);
const CREDENTIALS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY"];

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Sandbox conformance: ${message}`);
}

const never = () => new AbortController().signal;
const text = (data: Uint8Array) => new TextDecoder().decode(data);

/** The skip a case answers with when the backend can't start. */
type Skip = { readonly skipped: string };

interface Context {
  readonly under: SandboxUnderTest;
  readonly options: SandboxConformanceOptions;
  readonly policy: SandboxPolicy;
  readonly outside: string;
}

/** Provisions a sandbox for a case, or the skip that a backend reporting itself unavailable gets. */
async function provision(context: Context): Promise<Sandbox | Skip> {
  try {
    return await context.under.client.provision({ root: context.under.root }, context.policy);
  } catch (error) {
    if (error instanceof SandboxUnavailableError) return { skipped: error.message };
    throw error;
  }
}

/** Wraps a case's check so it provisions first, disposes after, and skips when the backend is unavailable. */
function withSandbox(
  factory: SandboxFactory,
  options: SandboxConformanceOptions,
  body: (sandbox: Sandbox, context: Context) => Promise<Skip | undefined>,
) {
  return async (): Promise<Skip | undefined> => {
    const under = await factory();
    const root = under.root;
    const policy: SandboxPolicy = {
      readRoots: [root],
      writeRoots: [root],
      network: { allow: [ALLOWED_HOST], deny: [] },
    };
    const context: Context = { under, options, policy, outside: `${root}-outside` };
    const sandbox = await provision(context);
    if ("skipped" in sandbox) return sandbox;
    try {
      return await body(sandbox, context);
    } finally {
      await sandbox.dispose();
    }
  };
}

async function exec(
  sandbox: Sandbox,
  command: readonly string[],
  extra: { env?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ExecResult> {
  return sandbox.exec(command, {
    env: extra.env ?? {},
    signal: extra.signal ?? never(),
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
  });
}

function finished(result: ExecResult): { exitCode: number; stdout: string; stderr: string } {
  check(!("denied" in result), "a command inside the workspace must not be denied");
  return result;
}

type Sandboxed = (
  body: (sandbox: Sandbox, context: Context) => Promise<Skip | undefined>,
) => () => Promise<Skip | undefined>;

/** The case that checks a backend's claims about itself. */
function honestyCases(factory: SandboxFactory): readonly SandboxCase[] {
  return [
    {
      name: "a backend names its tier and stops honestly: a none tier stops nothing, and every stop is a known one",
      async run() {
        const { client } = await factory();
        check(
          ["none", "os", "container", "gvisor", "microvm"].includes(client.tier),
          `unknown tier ${String(client.tier)}`,
        );
        check(
          client.stops.every((stop) => STOPS.includes(stop)),
          "every stop must be a known one",
        );
        check(client.tier !== "none" || client.stops.length === 0, "a none tier must stop nothing");
        return undefined;
      },
    },
  ];
}

/** The cases that run in a provisioned sandbox. */
function workspaceCases(sandboxed: Sandboxed): readonly SandboxCase[] {
  return [
    {
      name: "a file written in the workspace reads back as the same bytes",
      run: sandboxed(async (sandbox) => {
        await sandbox.writeFile("notes/a.txt", new TextEncoder().encode("hello"));
        check(text(await sandbox.readFile("notes/a.txt")) === "hello", "the bytes written must be the bytes read");
        return undefined;
      }),
    },
    {
      name: "exec resolves with the exit code and output, and a failing command is a result, not an error",
      run: sandboxed(async (sandbox) => {
        const echoed = finished(await exec(sandbox, ["echo", "hello"]));
        check(echoed.exitCode === 0 && echoed.stdout.trim() === "hello", "echo must print its argument and exit 0");
        const failed = finished(await exec(sandbox, ["false"]));
        check(failed.exitCode !== 0, "a failing command must resolve with a non-zero exit code");
        return undefined;
      }),
    },
    {
      name: "exec's environment holds only the variables it was given, and no credential",
      run: sandboxed(async (sandbox) => {
        const given = { ALPHA: "1", BETA: "2" };
        const printed = finished(await exec(sandbox, ["env"], { env: given }));
        const lines = printed.stdout.split("\n").filter((line) => line !== "");
        const names = lines.map((line) => line.slice(0, line.indexOf("=")));
        check(lines.includes("ALPHA=1") && lines.includes("BETA=2"), "the given variables must reach the command");
        const extra = names.filter((name) => !(name in given) && !ADDED_BY_RUNTIMES.has(name));
        check(extra.length === 0, `the command saw variables that were not given: ${extra.join(", ")}`);
        check(!names.some((name) => CREDENTIALS.includes(name)), "no credential may be in the environment");
        return undefined;
      }),
    },
    {
      name: "an already aborted signal rejects exec before the command runs",
      run: sandboxed(async (sandbox) => {
        const controller = new AbortController();
        controller.abort(new Error("stop"));
        let rejected = false;
        await exec(sandbox, ["echo", "never"], { signal: controller.signal }).catch(() => {
          rejected = true;
        });
        check(rejected, "exec must reject for an aborted signal");
        return undefined;
      }),
    },
    {
      name: "a command that runs past its timeout is stopped with exit code 124",
      run: sandboxed(async (sandbox) => {
        const started = Date.now();
        const result = finished(await exec(sandbox, ["sleep", "10"], { timeoutMs: 200 }));
        check(result.exitCode === 124, `a timed out command must exit with 124, not ${result.exitCode}`);
        check(Date.now() - started < 5000, "the command must be stopped at the timeout");
        return undefined;
      }),
    },
  ];
}

/** The case that checks `dispose()`. */
function disposeCases(factory: SandboxFactory, options: SandboxConformanceOptions): readonly SandboxCase[] {
  return [
    {
      name: "dispose ends the sandbox: a later call rejects, and a second dispose does nothing",
      async run() {
        const under = await factory();
        const context: Context = {
          under,
          options,
          policy: { readRoots: [under.root], writeRoots: [under.root], network: { allow: [], deny: [] } },
          outside: `${under.root}-outside`,
        };
        const sandbox = await provision(context);
        if ("skipped" in sandbox) return sandbox;
        await sandbox.dispose();
        await sandbox.dispose();
        let code = "";
        await sandbox.readFile("a.txt").catch((error: unknown) => {
          code = isHarnessError(error) ? error.code : String(error);
        });
        check(code === "sandbox_disposed", `a call after dispose must reject with sandbox_disposed, not ${code}`);
        return undefined;
      },
    },
  ];
}

/** The cases that run in a provisioned sandbox. */
function policyCases(sandboxed: Sandboxed): readonly SandboxCase[] {
  return [
    {
      name: "a write outside the write roots is denied",
      run: sandboxed(async (sandbox, context) => {
        if (!context.under.client.stops.includes("mistakes"))
          return { skipped: "the backend does not claim to stop mistakes" };
        let denied = false;
        await sandbox.writeFile(`${context.outside}/x.txt`, new Uint8Array([1])).catch((error: unknown) => {
          denied = error instanceof SandboxDeniedError && error.denial.kind === "filesystem_write";
        });
        check(denied, "a write outside the write roots must be denied");
        return undefined;
      }),
    },
    {
      name: "a read outside the read roots is denied",
      run: sandboxed(async (sandbox, context) => {
        if (!context.under.client.stops.includes("mistakes"))
          return { skipped: "the backend does not claim to stop mistakes" };
        let denied = false;
        await sandbox.readFile(`${context.outside}/x.txt`).catch((error: unknown) => {
          denied = error instanceof SandboxDeniedError && error.denial.kind === "filesystem_read";
        });
        check(denied, "a read outside the read roots must be denied");
        return undefined;
      }),
    },
    {
      name: "the network is denied unless the host is on the allowlist",
      run: sandboxed(async (sandbox, context) => {
        const probe = context.options.networkProbe;
        if (!context.under.client.stops.includes("exfiltration"))
          return { skipped: "the backend does not claim to stop exfiltration" };
        if (probe === undefined) return { skipped: "no networkProbe was given" };
        const blocked = await exec(sandbox, probe("blocked.test"));
        check("denied" in blocked || blocked.exitCode !== 0, "a host that is not allowed must not be reached");
        return undefined;
      }),
    },
  ];
}

/** The cases, for a backend from `factory`. Run each one; a case that doesn't apply resolves with `{ skipped }`. */
export function sandboxConformanceCases(
  factory: SandboxFactory,
  options: SandboxConformanceOptions = {},
): readonly SandboxCase[] {
  const sandboxed: Sandboxed = (body) => withSandbox(factory, options, body);
  return [
    ...honestyCases(factory),
    ...workspaceCases(sandboxed),
    ...disposeCases(factory, options),
    ...policyCases(sandboxed),
  ];
}

/**
 * Runs every case against backends from `factory` and reports which passed, which skipped with a reason and which
 * failed. A backend that reports itself unavailable skips; any other error fails the case.
 */
export async function runSandboxConformance(
  factory: SandboxFactory,
  options: SandboxConformanceOptions = {},
): Promise<SandboxConformanceReport> {
  const passed: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const conformance of sandboxConformanceCases(factory, options)) {
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
