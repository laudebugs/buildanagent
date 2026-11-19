// Runs a test Worker in workerd, Cloudflare's runtime, through Miniflare, for the tests that need a real `AIChatAgent`
// Durable Object with SQLite storage. The Worker is bundled with esbuild, and every outbound request is refused and
// recorded, so nothing leaves the machine.
import { mkdtempSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type Plugin } from "esbuild";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from "miniflare";

// The date of the pinned workerd release, as in the Cloudflare verify harness.
const COMPAT_DATE = "2026-11-03";
const BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith("_")));

// Bare Node built-ins that a dependency imports without the `node:` prefix resolve to workerd's nodejs_compat modules.
const nodeBuiltins: Plugin = {
  name: "node-builtins",
  setup(b) {
    b.onResolve({ filter: /^[a-z_/]+$/ }, (args) => {
      const name = args.path.replace(/\/$/, "");
      return BUILTINS.has(name) ? { path: `node:${name}`, external: true } : undefined;
    });
  },
};

/** A Worker running in workerd. */
export interface TestWorker {
  /** Sends a request to the Worker's fetch handler. */
  dispatch(path: string): Promise<Response>;
  /** The hostnames of the outbound requests the Worker tried, which were all refused. */
  readonly blocked: readonly string[];
  /** Stops workerd and removes the bundle. */
  dispose(): Promise<void>;
}

/** Bundles `entry` and starts it in workerd, with each class in `durableObjects` as a SQLite Durable Object. */
export async function startWorker(
  entry: string,
  durableObjects: readonly string[],
  bindings: Record<string, string> = {},
): Promise<TestWorker> {
  const outDir = mkdtempSync(join(tmpdir(), "agent-safety-workerd-"));
  const outfile = join(outDir, "worker.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["browser", "module", "main"],
    external: ["cloudflare:*", "node:*"],
    plugins: [nodeBuiltins],
    logLevel: "silent",
  });
  const blocked: string[] = [];
  const options = {
    log: new Log(LogLevel.WARN),
    modules: true,
    scriptPath: outfile,
    modulesRoot: outDir,
    compatibilityDate: COMPAT_DATE,
    compatibilityFlags: ["nodejs_compat"],
    bindings,
    durableObjects: Object.fromEntries(durableObjects.map((name) => [name, { className: name, useSQLite: true }])),
    outboundService: (request: Request) => {
      blocked.push(new URL(request.url).hostname);
      return new Response("network disabled in this test", { status: 403 });
    },
  };
  const mf = new Miniflare(convertV4MiniflareOptions(options as never));
  await mf.ready;
  return {
    dispatch: (path) => mf.dispatchFetch(`http://localhost${path}`) as unknown as Promise<Response>,
    blocked,
    async dispose() {
      await mf.dispose();
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}
