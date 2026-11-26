// Runs the Cloudflare adapters' test Worker in workerd, Cloudflare's runtime, through Miniflare, because a Durable
// Object's SQLite storage, alarm and hibernatable WebSockets exist only there. The Worker is bundled with esbuild, and
// every outbound request is refused and recorded, so nothing leaves the machine. It follows agent-safety's
// test/miniflare.ts, with the harness's own workspace packages added.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from "miniflare";

// The date of the pinned workerd release, as in the other workerd tests.
export const COMPAT_DATE = "2026-11-03";
const BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith("_")));

const nodeBuiltins: Plugin = {
  name: "node-builtins",
  setup(b) {
    b.onResolve({ filter: /^[a-z_/]+$/ }, (args) => {
      const name = args.path.replace(/\/$/, "");
      return BUILTINS.has(name) ? { path: `node:${name}`, external: true } : undefined;
    });
  },
};

// Our workspace packages resolve to their `source` entries, as in every other test, so the Worker needs no build. Only
// these packages go through `source`: a third-party package's `source` condition may name files its tarball lacks.
const WORKSPACE = [
  ["@buildanagent/gateway", "../../../gateway/"],
  ["@buildanagent/sdk", "../../../sdk/"],
  ["@buildanagent/protocol", "../../../protocol/"],
  ["@buildanagent/agent-safety", "../../../agent-safety/"],
  ["@buildanagent/harness", "../../"],
] as const;

const workspaceSource: Plugin = {
  name: "workspace-source",
  setup(b) {
    for (const [name, dir] of WORKSPACE) {
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

/** Bundles the Worker at `entry` into one ES module at `outfile`, as workerd and Wrangler load it. */
export async function bundleWorker(entry: string, outfile: string): Promise<void> {
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
    // The package says `sideEffects: false`, which esbuild would honour by dropping modules imported for effect.
    ignoreAnnotations: true,
    plugins: [nodeBuiltins, workspaceSource],
    logLevel: "silent",
  });
}

/** A Worker running in workerd. */
export interface TestWorker {
  /** The running Miniflare, for requests, WebSocket upgrades and the Secrets Store admin API. */
  readonly mf: Miniflare;
  /** The hostnames of the outbound requests the Worker tried, which were all refused. */
  readonly blocked: readonly string[];
  /** Stops workerd and removes the bundle. */
  dispose(): Promise<void>;
}

/** What `startWorker()` binds besides the Durable Objects. */
export interface WorkerBindings {
  readonly vars?: Record<string, string>;
  readonly secretsStoreSecrets?: Record<string, { readonly storeId: string; readonly secretName: string }>;
}

/** Bundles `entry` and starts it in workerd, with each class in `durableObjects` as a SQLite Durable Object. */
export async function startWorker(
  entry: string,
  durableObjects: readonly string[],
  bindings: WorkerBindings = {},
): Promise<TestWorker> {
  const outDir = mkdtempSync(join(tmpdir(), "harness-workerd-"));
  try {
    const outfile = join(outDir, "worker.mjs");
    await bundleWorker(entry, outfile);
    const blocked: string[] = [];
    const options = {
      log: new Log(LogLevel.WARN),
      modules: true,
      scriptPath: outfile,
      modulesRoot: outDir,
      compatibilityDate: COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      bindings: bindings.vars ?? {},
      // The version 4 options name a Secrets Store binding's fields as the Wrangler config does.
      secretsStoreSecrets: Object.fromEntries(
        Object.entries(bindings.secretsStoreSecrets ?? {}).map(([name, secret]) => [
          name,
          { store_id: secret.storeId, secret_name: secret.secretName },
        ]),
      ),
      durableObjects: Object.fromEntries(durableObjects.map((name) => [name, { className: name, useSQLite: true }])),
      outboundService: (request: Request) => {
        blocked.push(new URL(request.url).hostname);
        return new Response("network disabled in this test", { status: 403 });
      },
    };
    const mf = new Miniflare(convertV4MiniflareOptions(options as never));
    await mf.ready;
    return {
      mf,
      blocked,
      async dispose() {
        await mf.dispose();
        rmSync(outDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }
}
