// Runs a test Worker in workerd, Cloudflare's runtime, through Miniflare, for the tests that need a real `AIChatAgent`
// Durable Object with SQLite storage. The Worker is bundled with esbuild, and every outbound request is refused and
// recorded, so nothing leaves the machine.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

// Our workspace packages resolve to their `source` entries, as they do in every other test, so a Worker bundles the
// gateway's src/ and needs no build. Only these packages go through `source`: a third-party package's `source`
// condition may name files its tarball lacks.
const workspaceSource: Plugin = {
  name: "workspace-source",
  setup(b) {
    for (const [name, dir] of [
      ["@buildanagent/gateway", "../../gateway/"],
      ["@buildanagent/agent-safety", "../"],
    ] as const) {
      b.onResolve({ filter: new RegExp(`^${name}(/|$)`) }, (args) => {
        const root = fileURLToPath(new URL(dir, import.meta.url));
        const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
          exports: Record<string, { source?: string }>;
        };
        const source = manifest.exports[`.${args.path.slice(name.length)}`]?.source;
        return source === undefined ? undefined : { path: join(root, source) };
      });
    }
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

/**
 * Bundles `entry` and starts it in workerd, with each class in `durableObjects` as a SQLite Durable Object. `alias`
 * maps a module name to a file for the bundle, as the suite's runner stands in for "vitest".
 */
export async function startWorker(
  entry: string,
  durableObjects: readonly string[],
  bindings: Record<string, string> = {},
  alias: Record<string, string> = {},
): Promise<TestWorker> {
  const outDir = mkdtempSync(join(tmpdir(), "agent-safety-workerd-"));
  try {
    return await start(entry, durableObjects, bindings, outDir, alias);
  } catch (error) {
    // Nothing returned a dispose() yet, so the bundle's folder would outlive a failed build or startup.
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }
}

async function start(
  entry: string,
  durableObjects: readonly string[],
  bindings: Record<string, string>,
  outDir: string,
  alias: Record<string, string>,
): Promise<TestWorker> {
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
    alias,
    // The package says `sideEffects: false`, which esbuild would honour by dropping a test file imported only for
    // the tests it registers as it loads.
    ignoreAnnotations: true,
    plugins: [nodeBuiltins, workspaceSource],
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
