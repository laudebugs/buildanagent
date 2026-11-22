/**
 * The sandbox conformance suite: what every `SandboxClient` must do, whatever its tier. The cases that need a backend to
 * enforce something run only when its `stops` claim it, so a `none` backend passes the rest and an honest `srt` or
 * Docker backend passes them all. A backend that can't start makes every case skip with its reason, never fail. The cases
 * import no test runner and no Node module, so any runner can call them, in workerd too.
 */
import { isHarnessError } from "../errors.js";
import type { ExecResult, Sandbox, SandboxClient, SandboxDenial, SandboxPolicy } from "../sandbox/types.js";

/** What a factory returns: the backend, and the absolute folder to use as the workspace root. */
export interface SandboxUnderTest {
  readonly client: SandboxClient;
  /** An absolute folder that exists, empty. A sibling named `<root>-outside` stands for a path the policy refuses. */
  readonly root: string;
  /**
   * Makes `link` an absolute path inside the workspace that stands for `target`, as a symlink does, before or after the
   * sandbox starts. Without it the symlink case skips, because a portable command to make one doesn't exist.
   */
  readonly symlink?: (link: string, target: string) => void | Promise<void>;
}

/** Makes a fresh backend and workspace for each case. */
export type SandboxFactory = () => SandboxUnderTest | Promise<SandboxUnderTest>;

/** The options of the suite. */
export interface SandboxConformanceOptions {
  /**
   * The network case: `command(host)` is a command that exits 0 if it reaches `host`. The policy allows only `allowed`,
   * so both hosts must accept a connection from the test, such as two loopback listeners the test owns: a host that never
   * resolves would fail with no policy at all and prove nothing. The case checks that `allowed` is reached and `blocked`
   * is not. Without it that case skips, because a portable command to open a connection doesn't exist.
   */
  readonly network?: {
    readonly allowed: string;
    readonly blocked: string;
    readonly command: (host: string) => readonly string[];
  };
  /**
   * The case that checks an abort and a timeout end the command's whole tree. `command` starts a background process,
   * writes its process id to the file `pid` in the workspace and then waits for it, and `isAlive` says whether a process
   * is still running. Without it the case skips, because a portable command that forks doesn't exist.
   */
  readonly processTree?: {
    readonly command: readonly string[];
    readonly isAlive: (pid: number) => boolean | Promise<boolean>;
  };
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
const SETTLE_MS = 5000;
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

/** The error's `code` when it is a `HarnessError`, which works across two bundled copies of this package. */
function codeOf(error: unknown): string | undefined {
  return isHarnessError(error) ? error.code : undefined;
}

/** The denial a `sandbox_denied` error carries, or `undefined` for any other error. */
function denialOf(error: unknown): SandboxDenial | undefined {
  return codeOf(error) === "sandbox_denied" ? (error as { denial?: SandboxDenial }).denial : undefined;
}

/** Provisions a sandbox for a case, or the skip that a backend reporting itself unavailable gets. */
async function provision(context: Context): Promise<Sandbox | Skip> {
  try {
    return await context.under.client.provision({ root: context.under.root }, context.policy);
  } catch (error) {
    if (codeOf(error) === "sandbox_unavailable") return { skipped: (error as Error).message };
    throw error;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until `test` is true, for at most `SETTLE_MS`. */
async function eventually(test: () => boolean | Promise<boolean>): Promise<boolean> {
  const stop = Date.now() + SETTLE_MS;
  while (Date.now() < stop) {
    if (await test()) return true;
    await sleep(50);
  }
  return test();
}

/** Runs `action` and returns the denial it ended in, as a thrown error or as a command's `denied` result. */
async function denialFrom(action: () => Promise<unknown>): Promise<SandboxDenial | undefined> {
  try {
    const result = await action();
    return typeof result === "object" && result !== null && "denied" in result
      ? (result as { denied: SandboxDenial }).denied
      : undefined;
  } catch (error) {
    return denialOf(error);
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
      network: { allow: [options.network?.allowed ?? ALLOWED_HOST], deny: [] },
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
  extra: { env?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal; cwd?: string } = {},
): Promise<ExecResult> {
  return sandbox.exec(command, {
    env: extra.env ?? {},
    signal: extra.signal ?? never(),
    ...(extra.cwd === undefined ? {} : { cwd: extra.cwd }),
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
      name: "reading a file that doesn't exist rejects with sandbox_not_found",
      run: sandboxed(async (sandbox) => {
        const code = await sandbox.readFile("no/such/file.txt").then(
          () => "it resolved",
          (error: unknown) => codeOf(error) ?? String(error),
        );
        check(code === "sandbox_not_found", `a missing file must reject with sandbox_not_found, not ${code}`);
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
function disposeCases(
  factory: SandboxFactory,
  options: SandboxConformanceOptions,
  sandboxed: Sandboxed,
): readonly SandboxCase[] {
  return [
    {
      name: "dispose ends a command that is still running, which rejects with sandbox_disposed",
      run: sandboxed(async (sandbox) => {
        const running = exec(sandbox, ["sleep", "30"]).then(
          () => "it resolved",
          (error: unknown) => codeOf(error) ?? String(error),
        );
        await sleep(100);
        await sandbox.dispose();
        const outcome = await Promise.race([running, sleep(SETTLE_MS).then(() => "it never settled")]);
        check(
          outcome === "sandbox_disposed",
          `a command running at dispose must reject with sandbox_disposed, not ${outcome}`,
        );
        return undefined;
      }),
    },
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

const MISTAKES = "the backend does not claim to stop mistakes";

/** The name of the workspace's folder, for a path that climbs out of it and back into its sibling. */
function outsideViaParent(context: Context): string {
  const root = context.under.root;
  return `../${root.slice(root.lastIndexOf("/") + 1)}-outside`;
}

/** The cases that need a backend to enforce its policy, which run only when its `stops` claim it. */
function policyCases(sandboxed: Sandboxed): readonly SandboxCase[] {
  return [
    {
      name: "a write outside the write roots is denied",
      run: sandboxed(async (sandbox, context) => {
        if (!context.under.client.stops.includes("mistakes")) return { skipped: MISTAKES };
        const denial = await denialFrom(() => sandbox.writeFile(`${context.outside}/x.txt`, new Uint8Array([1])));
        check(denial?.kind === "filesystem_write", "a write outside the write roots must be denied");
        return undefined;
      }),
    },
    {
      name: "a read outside the read roots is denied",
      run: sandboxed(async (sandbox, context) => {
        if (!context.under.client.stops.includes("mistakes")) return { skipped: MISTAKES };
        const denial = await denialFrom(() => sandbox.readFile(`${context.outside}/x.txt`));
        check(denial?.kind === "filesystem_read", "a read outside the read roots must be denied");
        return undefined;
      }),
    },
    {
      name: "a path that climbs out of the workspace with .. is denied for reads and writes",
      run: sandboxed(async (sandbox, context) => {
        if (!context.under.client.stops.includes("mistakes")) return { skipped: MISTAKES };
        const climb = `${outsideViaParent(context)}/x.txt`;
        const write = await denialFrom(() => sandbox.writeFile(climb, new Uint8Array([1])));
        check(write?.kind === "filesystem_write", "a write that climbs out with .. must be denied");
        const read = await denialFrom(() => sandbox.readFile(climb));
        check(read?.kind === "filesystem_read", "a read that climbs out with .. must be denied");
        return undefined;
      }),
    },
    {
      name: "a symlink in the workspace that points outside it is denied for reads and writes",
      run: sandboxed(async (sandbox, context) => {
        if (!context.under.client.stops.includes("mistakes")) return { skipped: MISTAKES };
        const symlink = context.under.symlink;
        if (symlink === undefined) return { skipped: "the factory gave no symlink function" };
        await symlink(`${context.under.root}/link`, context.outside);
        const write = await denialFrom(() => sandbox.writeFile("link/x.txt", new Uint8Array([1])));
        check(write?.kind === "filesystem_write", "a write through a symlink that points outside must be denied");
        const read = await denialFrom(() => sandbox.readFile("link/x.txt"));
        check(read?.kind === "filesystem_read", "a read through a symlink that points outside must be denied");
        return undefined;
      }),
    },
    {
      name: "a working directory outside the workspace is denied",
      run: sandboxed(async (sandbox, context) => {
        if (!context.under.client.stops.includes("mistakes")) return { skipped: MISTAKES };
        const denial = await denialFrom(() => exec(sandbox, ["echo", "hi"], { cwd: "../.." }));
        check(denial !== undefined, "a command whose cwd climbs out of the workspace must be denied");
        return undefined;
      }),
    },
    {
      name: "the network is denied unless the host is on the allowlist",
      run: sandboxed(async (sandbox, context) => {
        const network = context.options.network;
        if (!context.under.client.stops.includes("exfiltration"))
          return { skipped: "the backend does not claim to stop exfiltration" };
        if (network === undefined) return { skipped: "no network probe was given" };
        const reached = await exec(sandbox, network.command(network.allowed));
        check(!("denied" in reached) && reached.exitCode === 0, "the allowed host must be reached");
        const blocked = await exec(sandbox, network.command(network.blocked));
        check("denied" in blocked || blocked.exitCode !== 0, "a host that is not allowed must not be reached");
        return undefined;
      }),
    },
  ];
}

type ProcessTree = NonNullable<SandboxConformanceOptions["processTree"]>;

/** Starts the tree's command, stops it by `stop`, and checks that exec settled the right way and the tree is dead. */
async function endTree(sandbox: Sandbox, tree: ProcessTree, stop: "abort" | "timeout"): Promise<void> {
  // Clear the previous round's id, so a stale one can't pass for this round's.
  await sandbox.writeFile("pid", new Uint8Array());
  const controller = new AbortController();
  const running = exec(sandbox, tree.command, {
    signal: controller.signal,
    ...(stop === "timeout" ? { timeoutMs: 1500 } : {}),
  }).then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
  let pid = Number.NaN;
  const wrote = await eventually(async () => {
    pid = Number(text(await sandbox.readFile("pid").catch(() => new Uint8Array())).trim());
    return Number.isInteger(pid) && pid > 0;
  });
  check(wrote, "the command must write its background process's id");
  if (stop === "abort") controller.abort(new Error("stop"));
  const outcome = await Promise.race([running, sleep(SETTLE_MS).then(() => undefined)]);
  check(outcome !== undefined, `exec must settle after ${stop}, though a background process held its pipes`);
  check(
    stop === "abort" ? "error" in outcome : "result" in outcome,
    `${stop} must ${stop === "abort" ? "reject" : "resolve"}`,
  );
  check(await eventually(async () => !(await tree.isAlive(pid))), `the background process must die on ${stop}`);
}

/** The case that checks an abort and a timeout end a command's whole process tree. */
function processCases(sandboxed: Sandboxed): readonly SandboxCase[] {
  return [
    {
      name: "an abort and a timeout end the command's whole process tree, and exec settles",
      run: sandboxed(async (sandbox, context) => {
        const tree = context.options.processTree;
        if (tree === undefined) return { skipped: "no processTree was given" };
        await endTree(sandbox, tree, "abort");
        await endTree(sandbox, tree, "timeout");
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
    ...processCases(sandboxed),
    ...disposeCases(factory, options, sandboxed),
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
