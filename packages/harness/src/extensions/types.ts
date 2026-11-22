import type { Interceptors, Observer } from "@buildanagent/sdk";
import type { ToolRegistration } from "../tools/types.js";

/** One tool an extension adds. It is registered with source `extension`; `override` lets it replace a built-in. */
export type ExtensionTool = Omit<ToolRegistration, "source">;

/**
 * An in-process extension: hooks and tools that run in the harness's own process with its permissions. Nothing
 * isolates them, so loading one is a trust decision.
 *
 * The hooks compose by the SDK's rules, and each moment has one: `transformContext`, `beforeModelCall` and
 * `afterToolCall` chain in registration order; `beforeToolCall` is a gate where the first deny wins and any ask asks;
 * `afterModelCall` passes the message on, so the last override stands; `shouldStop` lets any stop win. Observers are
 * notified in order and can change nothing.
 */
export interface Extension {
  /** A name that is unique among the extensions of one harness. */
  readonly name: string;
  readonly version: string;
  readonly interceptors?: Interceptors;
  readonly observers?: readonly Observer[];
  readonly tools?: readonly ExtensionTool[];
}

/** What the log records about a loaded extension, so a session shows which code ran. */
export interface ExtensionLoadedRecord {
  readonly name: string;
  readonly tier: "in_process" | "mcp" | "skill";
  /**
   * `sha256:` and the hex digest of the extension's files as they were pinned and imported, or of its name and version
   * for one built in code. It is the hash that was checked, not proof of what ran: a file changed between the hash and
   * the import is not caught.
   */
  readonly contentHash: string;
}

/** Which project folders may load their own extensions. Trust gates loading and nothing else: it is not a sandbox. */
export interface TrustStore {
  isTrusted(projectRoot: string): Promise<boolean>;
  trust(projectRoot: string): Promise<void>;
}
