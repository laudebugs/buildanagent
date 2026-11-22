/**
 * `createPermissionPipeline()`: one ordered, deny-first decision for every tool call. The order is hooks, deny rules,
 * ask rules, the mode, allow rules, the host callback and then the no-match default. A deny at any step ends the
 * decision, and the pipeline fails closed: anything it can't read or run is a denial.
 */
import { canonicalInputHash } from "@buildanagent/sdk";
import type { ToolRegistry } from "../tools/types.js";
import { PermissionConfigError } from "./errors.js";
import { isUnconditional, permits, restricts, type Target, targetOf, toolMatches } from "./rules.js";
import type {
  Decision,
  PermissionConfig,
  PermissionHook,
  PermissionPipeline,
  PolicyContext,
  PolicyInput,
  Rule,
  ToolCall,
} from "./types.js";

const DEFAULT_EDIT_TOOLS = ["write", "edit", "multi_edit", "apply_patch"];
const DEFAULT_READ_ONLY_TOOLS = ["read", "grep", "glob"];
const DECISIONS: readonly string[] = ["allow", "deny", "ask"];

const deny = (reason: string, rule?: string, by?: string): Decision => ({
  decision: "deny",
  reason,
  ...(rule === undefined ? {} : { rule }),
  ...(by === undefined ? {} : { by }),
});

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

class Pipeline implements PermissionPipeline {
  readonly #config: PermissionConfig;
  readonly #registry: ToolRegistry;

  constructor(config: PermissionConfig, registry: ToolRegistry) {
    this.#config = config;
    this.#registry = registry;
    this.#checkAllowRules();
  }

  /** A rule that allows every call to a registered tool leaves the host callback nothing to decide for that tool. */
  #checkAllowRules(): void {
    if (this.#config.hostCallback === undefined) return;
    (this.#config.allow ?? []).forEach((rule, index) => {
      if (!isUnconditional(rule)) return;
      const shadowed = this.#registry.list().find((tool) => toolMatches(rule.tool, this.#namesOf(tool.canonicalName)));
      if (shadowed !== undefined) {
        throw new PermissionConfigError(
          `allow[${index}] allows every call to ${shadowed.canonicalName}, so the host callback could never decide one; narrow the rule with paths or a commandPrefix, or remove it`,
        );
      }
    });
  }

  #namesOf(tool: string): string[] {
    const registered = this.#registry.get(tool);
    if (registered === undefined) return [tool];
    return registered.alias === undefined ? [registered.canonicalName] : [registered.canonicalName, registered.alias];
  }

  async decide(call: ToolCall, input: PolicyInput): Promise<Decision> {
    const ctx: PolicyContext = { ...input, mode: this.#config.mode, policyVersion: this.#config.policyVersion };
    let inputHash: string;
    let decision: Decision;
    try {
      inputHash = await canonicalInputHash(call.input);
      decision = await this.#evaluate(call, ctx);
    } catch (error) {
      if (error instanceof PermissionConfigError) throw error;
      // An input with no canonical form can't be hashed into its entry or compared on resume, so it is not run.
      inputHash = await canonicalInputHash("unhashable");
      decision = deny(`the call could not be checked: ${describe(error)}`, "unreadable_call");
    }
    await this.#record(call, ctx, decision, inputHash);
    return decision;
  }

  gate(context: Parameters<PermissionPipeline["gate"]>[0]): ReturnType<PermissionPipeline["gate"]> {
    return {
      beforeToolCall: async (event) => {
        try {
          const call: ToolCall = { callId: event.callId, tool: event.tool, input: event.input, initiator: "model" };
          const decision = await this.decide(call, await context(event));
          if (decision.decision === "ask") {
            return { decision: "ask", reason: decision.reason, policyVersion: this.#config.policyVersion };
          }
          return decision.decision === "allow"
            ? { decision: "allow", reason: decision.reason }
            : { decision: "deny", reason: decision.reason };
        } catch (error) {
          return {
            decision: "deny",
            reason: `the permission check failed, so the call was refused: ${describe(error)}`,
          };
        }
      },
    };
  }

  async #record(call: ToolCall, ctx: PolicyContext, decision: Decision, inputHash: string): Promise<void> {
    await ctx.session.append({
      type: "permission_decision",
      callId: call.callId,
      tool: this.#registry.get(call.tool)?.canonicalName ?? call.tool,
      decision: decision.decision,
      ...(decision.rule === undefined ? {} : { rule: decision.rule }),
      ...(decision.by === undefined ? {} : { by: decision.by }),
      policyVersion: ctx.policyVersion,
      inputHash,
    });
  }

  async #evaluate(call: ToolCall, ctx: PolicyContext): Promise<Decision> {
    const target = targetOf(this.#namesOf(call.tool), call.input);
    const hook = await this.#runHooks(call, ctx);
    if (hook?.decision === "deny") return hook;
    const denied = this.#firstMatch("deny", this.#config.deny, target);
    if (denied !== undefined) return denied;
    // Nothing runs in shadow mode, so a question to a person would have no call to wait for.
    const shadow = ctx.mode === "shadow";
    if (hook !== undefined && !shadow) return hook;
    const asked = shadow ? undefined : this.#firstMatch("ask", this.#config.ask, target);
    if (asked !== undefined) return asked;
    return (
      this.#byMode(target, ctx.mode) ??
      this.#byAllowRule(target) ??
      (await this.#byHostCallback(call, ctx)) ??
      this.#noMatch()
    );
  }

  /** Runs every hook in order. The first deny ends the run of hooks, and the first ask is held in case a later step denies. */
  async #runHooks(call: ToolCall, ctx: PolicyContext): Promise<Decision | undefined> {
    let held: Decision | undefined;
    for (const [index, hook] of (this.#config.hooks ?? []).entries()) {
      const result = await this.#runHook(hook, index, call, ctx);
      if (result?.decision === "deny") return result;
      held ??= result;
    }
    return held;
  }

  async #runHook(hook: PermissionHook, index: number, call: ToolCall, ctx: PolicyContext) {
    const rule = `hook[${index}]`;
    try {
      const result = await hook(call, ctx);
      if (result === undefined) return undefined;
      const { decision, reason } = result as { decision?: unknown; reason?: unknown };
      if ((decision !== "deny" && decision !== "ask") || typeof reason !== "string") {
        return deny(`${rule} returned ${JSON.stringify(decision)}, and a hook may only deny or ask`, rule, "hook");
      }
      return { decision, reason, rule: result.rule ?? rule, by: "hook" } satisfies Decision;
    } catch (error) {
      return deny(`${rule} failed, so the call was refused: ${describe(error)}`, rule, "hook");
    }
  }

  #firstMatch(list: "deny" | "ask", rules: readonly Rule[] | undefined, target: Target): Decision | undefined {
    const index = (rules ?? []).findIndex((rule) => restricts(rule, target));
    const rule = rules?.[index];
    if (rule === undefined) return undefined;
    return { decision: list, reason: rule.reason ?? `${list}[${index}] matched`, rule: `${list}[${index}]` };
  }

  #byMode(target: Target, mode: PermissionConfig["mode"]): Decision | undefined {
    const named = (tools: readonly string[]) => tools.some((tool) => toolMatches(tool, target.names));
    const allow = (): Decision => ({
      decision: "allow",
      reason: `${mode} mode allows this`,
      rule: `mode:${mode}`,
      by: "mode",
    });
    if (mode === "bypass" || mode === "shadow") return allow();
    if (mode === "accept_edits") return named(this.#config.editTools ?? DEFAULT_EDIT_TOOLS) ? allow() : undefined;
    if (mode !== "read_only") return undefined;
    return named(this.#config.readOnlyTools ?? DEFAULT_READ_ONLY_TOOLS)
      ? allow()
      : deny("read_only mode allows only read-only tools", "mode:read_only", "mode");
  }

  #byAllowRule(target: Target): Decision | undefined {
    const rules = this.#config.allow ?? [];
    const index = permits(rules, target);
    const rule = index === undefined ? undefined : rules[index];
    if (index === undefined || rule === undefined) return undefined;
    if (this.#config.hostCallback !== undefined && isUnconditional(rule)) {
      throw new PermissionConfigError(`allow[${index}] allows every call to a tool the host callback should decide`);
    }
    return { decision: "allow", reason: rule.reason ?? `allow[${index}] matched`, rule: `allow[${index}]` };
  }

  async #byHostCallback(call: ToolCall, ctx: PolicyContext): Promise<Decision | undefined> {
    const callback = this.#config.hostCallback;
    if (callback === undefined) return undefined;
    try {
      const result = await callback(call, ctx);
      if (!DECISIONS.includes(result?.decision) || typeof result.reason !== "string") {
        return deny(
          "the host callback returned something that is not a decision, so the call was refused",
          "host_callback",
          "host",
        );
      }
      return { ...result, by: result.by ?? "host" };
    } catch (error) {
      return deny(`the host callback failed, so the call was refused: ${describe(error)}`, "host_callback", "host");
    }
  }

  #noMatch(): Decision {
    return this.#config.interactive
      ? { decision: "ask", reason: "No rule covers this call, so a person decides.", rule: "no_match" }
      : deny("No rule covers this call and nobody can be asked, so it is refused.", "no_match");
  }
}

/**
 * Creates the pipeline. It throws a `PermissionConfigError` when an allow rule covers every call to a registered tool
 * while a host callback is set. Deny rules, hooks and a host callback with no allow rules never throw it.
 *
 * With no host callback, a call that no rule settles asks when `interactive` is true and is denied when it is false.
 */
export function createPermissionPipeline(config: PermissionConfig, registry: ToolRegistry): PermissionPipeline {
  return new Pipeline(config, registry);
}
