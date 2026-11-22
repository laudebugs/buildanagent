// A workspace for the book's examples on the harness: a sandbox that lives in memory, holding the files an example
// names, and a registry with the built-in tools bound to it. The book lists these examples beside the third-party ones
// (apps/manual), so no example touches the host's files.
import type { SandboxPolicy } from "@buildanagent/harness/sandbox";
import { fakeSandbox } from "@buildanagent/harness/testing";
import { builtinTools, createToolRegistry, type ToolRegistry } from "@buildanagent/harness/tools";

/** The folder every example's files sit in. */
export const WORKSPACE_ROOT = "/repo";

/**
 * A registry holding `read`, `write`, `edit`, `bash`, `grep` and `glob` (no `fetch`, which needs a proxy), bound to an
 * in-memory sandbox that holds `files`, a map from a path below the workspace root to its text.
 */
export async function builtinRegistry(files: Readonly<Record<string, string>> = {}): Promise<ToolRegistry> {
  const client = fakeSandbox();
  const policy: SandboxPolicy = { readRoots: [], writeRoots: [WORKSPACE_ROOT], network: { allow: [], deny: [] } };
  const sandbox = await client.provision({ root: WORKSPACE_ROOT }, policy);
  for (const [path, text] of Object.entries(files)) await sandbox.writeFile(path, new TextEncoder().encode(text));
  const registry = createToolRegistry();
  for (const tool of builtinTools(sandbox, undefined, { root: WORKSPACE_ROOT, policy })) registry.register(tool);
  return registry;
}
