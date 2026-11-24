/**
 * `@buildanagent/harness/ablation`: switches for every removable harness component and the hash stamped into each
 * session header.
 *
 * The session log, the permission pipeline and the protocol are absent from `AblationConfig` on purpose: they are the
 * harness's non-removable spine (see `docs/guides/agent-harness.md` §11). Every other component can be switched off to
 * test its no-op path or measure its value in an ablation run.
 *
 * @module @buildanagent/harness/ablation
 */

import type { LayerName } from "./context/types.js";
import { HarnessError } from "./errors.js";
import { sha256HexSync } from "./extensions/digest.js";
import type { SandboxClient } from "./sandbox/types.js";

/** The five context layers in fixed canonical order for hashing. */
const LAYER_NAMES: readonly LayerName[] = ["write_cap", "mask", "summarize", "mid_turn", "overflow_retry"];

/** Per-tier switches for the three extension tiers. */
export interface AblationExtensions {
  /** Whether in-process extensions and their hooks/tools run. */
  readonly inProcess: boolean;
  /** Whether MCP-tier extensions run. */
  readonly mcp: boolean;
  /** Whether skills are discovered and listed in the system prompt. */
  readonly skills: boolean;
}

/**
 * Switches for every removable component of the harness.
 *
 * The session log, the permission pipeline and the protocol are intentionally omitted (see
 * `docs/guides/agent-harness.md` §11): they remain active in every ablation arm.
 */
export interface AblationConfig {
  /** Which of the five context-policy layers run. */
  readonly context: Readonly<Record<LayerName, boolean>>;
  /** Whether MCP servers and their tools are active. */
  readonly mcp: boolean;
  /** Which of the three extension tiers run. */
  readonly extensions: AblationExtensions;
  /** Whether deferred tool discovery (`tool_search`) is active. */
  readonly toolSearch: boolean;
  /**
   * Whether the egress credential proxy injects host-scoped credentials. Switching it off fails safe: tools receive no
   * credentials.
   */
  readonly credentialProxy: boolean;
  /** Whether telemetry observers and span projection run. */
  readonly telemetry: boolean;
  /** Whether the code-level completion check runs after a `done` turn. */
  readonly completionCheck: boolean;
  /** The sandbox tier the session stamps. `"none"` still requires `unsafe: true`. */
  readonly sandbox: SandboxClient["tier"];
  /** Explicit acknowledgement required when `sandbox` is `"none"`. */
  readonly unsafe?: boolean;
}

/** Partial overrides accepted by `defaultAblation()`. */
export interface AblationOverrides {
  /** Per-layer overrides merged onto all-on context layers. */
  readonly context?: Readonly<Partial<Record<LayerName, boolean>>>;
  /** Override for top-level MCP support. */
  readonly mcp?: boolean;
  /** Per-tier overrides merged onto all-on extension tiers. */
  readonly extensions?: Readonly<Partial<AblationExtensions>>;
  /** Override for deferred tool search. */
  readonly toolSearch?: boolean;
  /** Override for the egress credential proxy. */
  readonly credentialProxy?: boolean;
  /** Override for telemetry observers. */
  readonly telemetry?: boolean;
  /** Override for the post-turn completion check. */
  readonly completionCheck?: boolean;
  /** Override for the sandbox tier. `"none"` still requires `unsafe: true`. */
  readonly sandbox?: SandboxClient["tier"];
  /** Explicit acknowledgement required when `sandbox` is `"none"`. */
  readonly unsafe?: boolean;
}

/** Baseline ablation configuration with every removable component enabled on the `"os"` sandbox tier. */
export const DEFAULT_ABLATION: AblationConfig = {
  context: {
    write_cap: true,
    mask: true,
    summarize: true,
    mid_turn: true,
    overflow_retry: true,
  },
  mcp: true,
  extensions: {
    inProcess: true,
    mcp: true,
    skills: true,
  },
  toolSearch: true,
  credentialProxy: true,
  telemetry: true,
  completionCheck: true,
  sandbox: "os",
};

/**
 * Checks fail-safe invariants on `config`. Switching `sandbox` to `"none"` without `unsafe: true` throws
 * `HarnessError("unsafe_sandbox_not_acknowledged")`.
 */
export function validateAblation(config: AblationConfig): void {
  if (config.sandbox === "none" && config.unsafe !== true) {
    throw new HarnessError(
      "unsafe_sandbox_not_acknowledged",
      'ablation sandbox "none" disables isolation and requires unsafe: true',
    );
  }
}

/**
 * Builds a complete `AblationConfig` from `DEFAULT_ABLATION` plus `overrides`, and validates it with
 * `validateAblation()`.
 */
export function defaultAblation(overrides: AblationOverrides = {}): AblationConfig {
  const config: AblationConfig = {
    context: {
      ...DEFAULT_ABLATION.context,
      ...overrides.context,
    },
    mcp: overrides.mcp ?? DEFAULT_ABLATION.mcp,
    extensions: {
      ...DEFAULT_ABLATION.extensions,
      ...overrides.extensions,
    },
    toolSearch: overrides.toolSearch ?? DEFAULT_ABLATION.toolSearch,
    credentialProxy: overrides.credentialProxy ?? DEFAULT_ABLATION.credentialProxy,
    telemetry: overrides.telemetry ?? DEFAULT_ABLATION.telemetry,
    completionCheck: overrides.completionCheck ?? DEFAULT_ABLATION.completionCheck,
    sandbox: overrides.sandbox ?? DEFAULT_ABLATION.sandbox,
    ...(overrides.unsafe === undefined ? {} : { unsafe: overrides.unsafe }),
  };
  validateAblation(config);
  return config;
}

/**
 * Computes a deterministic `sha256:` digest of `config` to stamp into `session_header.ablationHash`. Validates
 * `config` first so an unacknowledged `sandbox: "none"` configuration cannot be stamped. Two configurations with the
 * same flag values always produce the same hash regardless of object key order; flipping any single flag changes it.
 */
export function ablationHash(config: AblationConfig): string {
  validateAblation(config);
  const contextEntries = LAYER_NAMES.map((layer) => [layer, Boolean(config.context[layer])] as const);
  const canonical = JSON.stringify({
    completionCheck: Boolean(config.completionCheck),
    context: Object.fromEntries(contextEntries),
    credentialProxy: Boolean(config.credentialProxy),
    extensions: {
      inProcess: Boolean(config.extensions.inProcess),
      mcp: Boolean(config.extensions.mcp),
      skills: Boolean(config.extensions.skills),
    },
    mcp: Boolean(config.mcp),
    sandbox: config.sandbox,
    telemetry: Boolean(config.telemetry),
    toolSearch: Boolean(config.toolSearch),
  });
  return `sha256:${sha256HexSync(canonical)}`;
}

/**
 * Returns the credential environment entries allowed under `config`. When `config.credentialProxy` is `false`, returns
 * an empty object so tools fail safe without receiving credentials.
 */
export function credentialEnvOf(
  config: AblationConfig,
  credentials: Readonly<Record<string, string>>,
): Record<string, string> {
  if (!config.credentialProxy) return {};
  return { ...credentials };
}
