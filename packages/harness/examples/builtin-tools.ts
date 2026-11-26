// A coding agent's tool set: the built-in tools bound to one sandbox and one egress proxy, with the write cap's spill
// files readable by `read`, so the model can see the whole of a long command's output.
import type { Model } from "@buildanagent/gateway";
import { createContextPolicy } from "@buildanagent/harness/context";
import { fileSpillStore } from "@buildanagent/harness/context/file";
import type { SandboxClient, SandboxPolicy } from "@buildanagent/harness/sandbox";
import { createHarness } from "@buildanagent/harness/server";
import type { SessionKey } from "@buildanagent/harness/session";
import { builtinTools, createToolRegistry, type FetchProxy } from "@buildanagent/harness/tools";

const SYSTEM = "You are a careful coding agent. Read before you edit, and run the tests after.";

/** A sandbox for `workspace` and a harness whose tools reach it, the web through `proxy`, and the session's spills. */
export async function codingAgent(
  client: SandboxClient,
  proxy: FetchProxy,
  model: Model,
  setup: { readonly workspace: string; readonly spillDir: string; readonly key: SessionKey },
) {
  const { workspace, spillDir, key } = setup;
  // #region tools
  const policy: SandboxPolicy = { readRoots: [], writeRoots: [workspace], network: { allow: [], deny: [] } };
  const sandbox = await client.provision({ root: workspace }, policy);
  const spill = fileSpillStore({ dir: spillDir });
  const registry = createToolRegistry();
  const spills = (path: string) => spill.read(key, path);
  for (const tool of builtinTools(sandbox, proxy, { root: workspace, policy, spills })) registry.register(tool);
  const harness = createHarness({ registry, model, system: SYSTEM, context: createContextPolicy({ spill }) });
  // #endregion
  return { sandbox, harness };
}
