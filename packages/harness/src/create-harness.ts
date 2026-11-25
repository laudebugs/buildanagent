/**
 * `createHarness()`: a harness from its options, with the defaults filled in and `invokeTool()` bound to the code-call
 * runner. It is apart from the harness's types because the runner imports them.
 */
import { type AblationConfig, ablationHash, validateAblation } from "./ablation.js";
import { HarnessError } from "./errors.js";
import type { ExtensionLoadedRecord } from "./extensions/types.js";
import type { Harness, HarnessOptions } from "./harness.js";
import { invokeCodeCall } from "./session/code-call.js";

function filterExtensionRecords(
  records: readonly ExtensionLoadedRecord[] | undefined,
  ablation: AblationConfig | undefined,
): readonly ExtensionLoadedRecord[] | undefined {
  if (ablation === undefined || records === undefined) return records;
  const allowed: Record<ExtensionLoadedRecord["tier"], boolean> = {
    in_process: ablation.extensions.inProcess,
    mcp: ablation.mcp && ablation.extensions.mcp,
    skill: ablation.extensions.skills,
  };
  return records.filter((record) => allowed[record.tier]);
}

function resolveSandboxTier(options: HarnessOptions<unknown>): Harness["env"]["sandbox"] {
  const { ablation, env } = options;
  if (ablation === undefined) return env?.sandbox ?? "none";
  if (env?.sandbox !== undefined && env.sandbox !== ablation.sandbox) {
    throw new HarnessError(
      "invalid_sandbox_options",
      `env.sandbox ("${env.sandbox}") disagrees with ablation.sandbox ("${ablation.sandbox}")`,
    );
  }
  return ablation.sandbox;
}

function ablatedComponents<H>(options: HarnessOptions<H>) {
  const ablation = options.ablation;
  const mcpEnabled = ablation === undefined || (ablation.mcp && ablation.extensions.mcp);
  const extensionRecords = filterExtensionRecords(options.extensionRecords, ablation);
  const skills = ablation?.extensions.skills === false ? undefined : options.skills;
  const observers = ablation?.telemetry === false ? undefined : options.observers;
  const turnBoundaries = mcpEnabled ? options.turnBoundaries : undefined;
  return {
    ...(extensionRecords === undefined ? {} : { extensionRecords }),
    ...(skills === undefined ? {} : { skills }),
    ...(observers === undefined ? {} : { observers }),
    ...(turnBoundaries === undefined ? {} : { turnBoundaries }),
  };
}

/** Creates a harness. `H` types the host context of each turn, so `runTurn()` checks it. */
export function createHarness<H = unknown>(options: HarnessOptions<H>): Harness<H> {
  const ablation = options.ablation;
  if (ablation !== undefined) validateAblation(ablation);
  const sandbox = resolveSandboxTier(options as HarnessOptions<unknown>);
  const {
    extensionRecords: _origRecords,
    skills: _origSkills,
    observers: _origObservers,
    turnBoundaries: _origBoundaries,
    ...rest
  } = options;
  return {
    ...rest,
    ...ablatedComponents(options),
    tenant: options.tenant ?? "local",
    env: {
      cwd: options.env?.cwd ?? "/",
      permissionMode: options.env?.permissionMode ?? "default",
      approvalPolicy: options.env?.approvalPolicy ?? "on-request",
      sandbox,
    },
    harnessVersion: options.harnessVersion ?? "0.0.0",
    ablationHash: ablation === undefined ? (options.ablationHash ?? "none") : ablationHash(ablation),
    // `this`, not a captured harness, so a copy made with a spread runs with its own settings.
    invokeTool(session, call) {
      return invokeCodeCall(this, session, call);
    },
  };
}
