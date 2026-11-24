/**
 * `createHarness()`: a harness from its options, with the defaults filled in and `invokeTool()` bound to the code-call
 * runner. It is apart from the harness's types because the runner imports them.
 */
import { type AblationConfig, ablationHash, validateAblation } from "./ablation.js";
import type { ExtensionLoadedRecord } from "./extensions/types.js";
import type { Harness, HarnessOptions } from "./harness.js";
import { invokeCodeCall } from "./session/code-call.js";

function filterExtensionRecords(
  records: readonly ExtensionLoadedRecord[] | undefined,
  ablation: AblationConfig | undefined,
): readonly ExtensionLoadedRecord[] | undefined {
  if (ablation === undefined || records === undefined) return records;
  const mcpEnabled = ablation.mcp && ablation.extensions.mcp;
  return records.filter((record) => {
    if (record.tier === "in_process") return ablation.extensions.inProcess;
    if (record.tier === "mcp") return mcpEnabled;
    if (record.tier === "skill") return ablation.extensions.skills;
    return true;
  });
}

/** Creates a harness. `H` types the host context of each turn, so `runTurn()` checks it. */
export function createHarness<H = unknown>(options: HarnessOptions<H>): Harness<H> {
  const ablation = options.ablation;
  if (ablation !== undefined) validateAblation(ablation);
  const extensionRecords = filterExtensionRecords(options.extensionRecords, ablation);
  const { extensionRecords: _origRecords, skills: _origSkills, observers: _origObservers, ...rest } = options;
  const skills = ablation?.extensions.skills === false ? undefined : options.skills;
  const observers = ablation?.telemetry === false ? undefined : options.observers;
  return {
    ...rest,
    ...(extensionRecords === undefined ? {} : { extensionRecords }),
    ...(skills === undefined ? {} : { skills }),
    ...(observers === undefined ? {} : { observers }),
    tenant: options.tenant ?? "local",
    env: {
      cwd: options.env?.cwd ?? "/",
      permissionMode: options.env?.permissionMode ?? "default",
      approvalPolicy: options.env?.approvalPolicy ?? "on-request",
      sandbox: options.env?.sandbox ?? ablation?.sandbox ?? "none",
    },
    harnessVersion: options.harnessVersion ?? "0.0.0",
    ablationHash: options.ablationHash ?? (ablation === undefined ? "none" : ablationHash(ablation)),
    // `this`, not a captured harness, so a copy made with a spread runs with its own settings.
    invokeTool(session, call) {
      return invokeCodeCall(this, session, call);
    },
  };
}
