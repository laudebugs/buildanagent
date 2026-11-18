// Ambient types the Cloudflare docs assume. `wrangler types` generates a project's Env from its
// wrangler config; doc blocks have no config, so the harness types every binding as `any`.
declare namespace Cloudflare {
  interface Env {
    // biome-ignore lint/suspicious/noExplicitAny: bindings are untyped without a wrangler config
    [binding: string]: any;
  }
}
interface Env extends Cloudflare.Env {}
