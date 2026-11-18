// Host-side helpers: bundle an example into a Worker module with esbuild, then run it in workerd
// through Miniflare. Used by scripts/worker-run.mjs, which run-examples.mjs spawns per example.
//
// Bundling: the entry re-exports the example (so its Agent classes are exported Durable Object
// classes) and wraps its default handler with scripts/worker-harness.mjs. Model providers resolve
// to the shims in shims/ (mock language models): @ai-sdk/openai, @ai-sdk/anthropic,
// workers-ai-provider and agents/models/ai-sdk. Bare Node built-ins become `node:` imports, served
// by workerd's nodejs_compat.
//
// Running: one Worker ("example") with every Durable Object binding SQLite-backed, plus a Workers
// AI stand-in ("aimock", bound as AI) whose run() returns a canned answer. Every outbound fetch goes
// to outboundService, which loops localhost back into the example Worker and refuses every other
// host (recording it), so nothing leaves the machine.
import { writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from "miniflare";
import { MOCK_MARKER } from "./mock-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const PKG = resolve(here, "..");
export const COMPAT_DATE = "2026-11-03"; // the pinned workerd's release date
const SHIMS = {
  "@ai-sdk/openai": join(PKG, "shims/openai.mjs"),
  "@ai-sdk/anthropic": join(PKG, "shims/anthropic.mjs"),
  "workers-ai-provider": join(PKG, "shims/workers-ai-provider.mjs"),
  "agents/models/ai-sdk": join(PKG, "shims/agents-models-ai-sdk.mjs"),
};
const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));

const harnessPlugin = (mock) => ({
  name: "verify-harness",
  setup(b) {
    // Bare Node built-ins ("buffer", "events/") -> "node:" imports for nodejs_compat.
    b.onResolve({ filter: /^[a-z_/]+$/ }, (args) => {
      const name = args.path.replace(/\/$/, "");
      return BUILTINS.has(name) ? { path: `node:${name}`, external: true } : undefined;
    });
    if (!mock) return;
    b.onResolve({ filter: /^(@ai-sdk\/(openai|anthropic)|workers-ai-provider|agents\/models\/ai-sdk)$/ }, (args) =>
      args.importer.startsWith(join(PKG, "shims")) ? undefined : { path: SHIMS[args.path] },
    );
  },
});

/**
 * Bundle `example` (absolute path) into `outDir/worker.mjs`. With `mock`, model providers resolve
 * to the shims. Returns { ok, file } or { ok: false, error }.
 */
export async function bundle(example, outDir, { mock = true } = {}) {
  const entry = join(outDir, "entry.mjs");
  const spec = JSON.stringify(example);
  await writeFile(
    entry,
    `import * as mod from ${spec};\nimport { harness } from ${JSON.stringify(join(here, "worker-harness.mjs"))};\n` +
      `export * from ${spec};\nexport default harness(mod);\n`,
  );
  const file = join(outDir, "worker.mjs");
  try {
    await build({
      entryPoints: [entry],
      outfile: file,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022", // lowers TC39 decorators such as @callable()
      conditions: ["workerd", "worker", "browser"],
      mainFields: ["browser", "module", "main"],
      external: ["cloudflare:*", "node:*"],
      nodePaths: [join(PKG, "node_modules")],
      plugins: [harnessPlugin(mock)],
      logLevel: "silent",
      sourcemap: false,
      // Doc blocks that only declare types compile to nothing; keep their (empty) exports.
      treeShaking: true,
    });
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: (e.errors ?? []).map((x) => x.text).join("; ") || String(e) };
  }
}

const AI_MOCK = `
import { WorkerEntrypoint } from "cloudflare:workers";
export class AIMock extends WorkerEntrypoint {
  async run(model, inputs) {
    console.log(${JSON.stringify(MOCK_MARKER)});
    return { response: "Mock Workers AI: hello from the offline model." };
  }
}
export default { fetch() { return new Response("Workers AI mock"); } };
`;

/**
 * Start a Miniflare instance for a bundled Worker. `durableObjects` maps binding name to class.
 * Returns { mf, blocked } where `blocked` collects refused outbound hosts.
 */
export function start(file, { durableObjects = {}, compatibilityFlags = ["nodejs_compat"], vars = {}, onEvict } = {}) {
  const blocked = [];
  let mf;
  const options = {
    cf: {},
    log: new Log(LogLevel.WARN),
    workers: [
      {
        name: "example",
        modules: true,
        scriptPath: file,
        compatibilityDate: COMPAT_DATE,
        compatibilityFlags: [...new Set(["nodejs_compat", ...compatibilityFlags])],
        bindings: vars,
        durableObjects: Object.fromEntries(
          Object.entries(durableObjects).map(([name, className]) => [name, { className, useSQLite: true }]),
        ),
        serviceBindings: {
          AI: { name: "aimock", entrypoint: "AIMock" },
          HARNESS: async (request) => {
            const url = new URL(request.url);
            if (url.pathname === "/evict") {
              await mf.unsafeEvictDurableObject("example", url.searchParams.get("class"), {
                name: url.searchParams.get("name"),
                webSockets: "hibernate",
              });
              onEvict?.(url.searchParams.get("class"));
              return new Response("evicted");
            }
            return new Response("unknown harness request", { status: 404 });
          },
        },
        outboundService: (request) => {
          const host = new URL(request.url).hostname;
          // Loopback requests (an Agent's MCP client calling this Worker's own /mcp) are served
          // by the example Worker itself; nothing leaves the machine.
          if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return mf.dispatchFetch(request);
          blocked.push(host);
          return new Response(`verify harness: network disabled (blocked ${host})`, { status: 403 });
        },
      },
      { name: "aimock", modules: true, script: AI_MOCK, compatibilityDate: COMPAT_DATE },
    ],
  };
  mf = new Miniflare(convertV4MiniflareOptions(options));
  return { mf, blocked };
}
