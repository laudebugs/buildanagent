// The names the README's TypeScript blocks use without defining them, for scripts/docs-check.mjs, which type-checks
// each block as a module beside this file. A block's own imports and declarations shadow these.
import type * as gateway from "@buildanagent/gateway";
import type * as anthropicEntry from "@buildanagent/gateway/anthropic";
import type * as testing from "@buildanagent/gateway/testing";

declare global {
  const createModel: typeof gateway.createModel;
  const transformMessages: typeof gateway.transformMessages;
  const anthropic: typeof anthropicEntry.anthropic;
  const startMockServer: typeof testing.startMockServer;

  const adapter: gateway.ModelAdapter;
  const apiKey: string;
  const catalog: gateway.PriceCatalog;
  const context: gateway.ModelContext;
  const inspect: (event: unknown) => void;
  const events: readonly { readonly type: string }[];
  const localKey: string;
  const model: gateway.Model;
  const myEntry: gateway.CatalogEntry;
  const script: testing.MockServerOptions["script"];
  const transcript: readonly gateway.Message[];
}
