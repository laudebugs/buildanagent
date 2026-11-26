// A support-triage agent on the harness. It looks the signed-in customer up, pauses before it pages an engineer and
// ends with a typed record. The session's log holds every step, so any process that can open the session and load the
// key ring can answer the pause. The permission pipeline decides the call again at that point, so a deny added since the
// pause wins.
import type { Model } from "@buildanagent/gateway";
import type { ContextPolicy } from "@buildanagent/harness/context";
import { createPermissionPipeline, type Rule } from "@buildanagent/harness/permissions";
import { createHarness, type Harness } from "@buildanagent/harness/server";
import * as log from "@buildanagent/harness/session";
import type { ToolRegistry } from "@buildanagent/harness/tools";
import type { ApprovalSigner, Resolution } from "@buildanagent/sdk";
import { submitTriage, type TriageApp } from "./triage-tools.js";

export const MAX_STEPS = 8;
export const BUDGET_USD = 0.25;
export const SYSTEM_PROMPT =
  "You triage support tickets. Look the customer up first. Escalate only a ticket an on-call engineer must see. Submit the triage last.";

/** What the harness is built from. Every pause records `policy.version`, and a rule in `policy.deny` overrides an approval. */
export interface TriageParts {
  readonly model: Model;
  readonly signer: ApprovalSigner;
  /** The agent's tools, from `triageRegistry()`. */
  readonly registry: ToolRegistry;
  readonly policy: { readonly version: string; readonly deny?: readonly Rule[] };
  /** How a long session stays inside the model's window. */
  readonly context?: ContextPolicy;
}

/** The agent's harness: the read runs, an escalation asks a person, and a denied tool never runs. */
export function triageHarness({ policy, ...parts }: TriageParts): Harness<TriageApp> {
  const config = {
    mode: "default",
    interactive: true,
    policyVersion: policy.version,
    allow: [{ tool: "lookup_customer" }, { tool: "submit_triage" }],
    ask: [{ tool: "escalate", reason: "An on-call engineer will be paged." }],
    deny: policy.deny ?? [],
  } as const;
  const pipeline = createPermissionPipeline(config, parts.registry);
  return createHarness<TriageApp>({ ...parts, system: SYSTEM_PROMPT, pipeline });
}

type Extra<O> = Omit<O, "input" | "hostContext" | "output" | "maxSteps" | "budgetUsd">;
const limits = { output: submitTriage, maxSteps: MAX_STEPS, budgetUsd: BUDGET_USD };

/** One customer's triage: the session it writes to, the harness it runs on and the signed-in customer. */
export interface TriageRun {
  readonly session: log.Session;
  readonly harness: Harness<TriageApp>;
  readonly app: TriageApp;
}

/** Triages `ticket` for the signed-in customer. The turn ends `awaiting_approval` when the model asks to escalate. */
export function startTriage(run: TriageRun, ticket: string, extra: Extra<log.TurnOptions> = {}) {
  // #region pause
  return log.runTurn(run.session, run.harness, { ...extra, ...limits, input: ticket, hostContext: run.app });
  // #endregion
}

/** Answers the paused escalation for the same customer, from this process or any other, and finishes the turn. */
export function answerTriage(run: TriageRun, answers: Resolution[], extra: Extra<log.ResolveOptions> = {}) {
  // #region answer
  return log.createApprovals(run.harness).resolve(run.session, answers, { ...extra, ...limits, hostContext: run.app });
  // #endregion
}
