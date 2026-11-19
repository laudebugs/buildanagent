# Plan: build a multi-user platform that turns a description into a checked agent deployed in the user's own cloud

- **Status:** Draft (2026-11-18), from the owner's decisions of 2026-11-18. PF1, PF2, PF4 and PF6–PF9 are accepted (ADRs 0037–0042); PF3, PF5 and PF10–PF12 are proposed for the owner.
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18): "can we also make our plans our work on building a platform for building agents", for "Others from the start", with generated agents on "Ours, plus verified third-party".
- **Builds on:** the [agent-building platforms report][abp] (U12), the [portable agents report][pa] (U11), the [storage-and-wake note][sw], the [coding agent plan][ca], the [SDK plan][sdk], the [harness plan][hp] and the [verification harnesses](../../verify/)
- **Decision records:** [ADRs 0037–0042](../decisions/README.md)
- **Todos:** Round F ("build the agent platform") on the [todo board](../todos/README.md); §5 lists them.

As of November 2026, every agent builder turns a description into an agent, but almost all of them emit vendor configuration that runs only on the vendor's own runtime. No product tests a generated agent before showing it, no builder deploys a built agent to Cloudflare Workers or Vercel, and no platform signs approvals or reverses side effects ([agent-building platforms report][abp]). The same report found the category's security record weak: Langflow has six entries in CISA's catalog of known exploited vulnerabilities and n8n has one ([agent-building platforms report][abp-sec]). Our coding agent plan already builds the engine such a platform needs: a loop outside a credential-free sandbox that delivers code as a pull request ([coding agent plan][ca]). Our verification harnesses already type-check SDK code and run it against mock models. This plan turns that engine and those harnesses into a multi-user platform. A user describes an agent, and the platform writes plain SDK code into the user's repository. **A gate refuses to deploy that code until it type-checks and passes mock-model tests and hidden-grader evals, and the agent then deploys into the user's own Cloudflare or Vercel account under the user's own model key.**

## 1. Goal and non-goals

**Goal.** At the end of milestone M8, any signed-in user can describe a tool-using agent with approval-gated writes and receive four things:

1. a repository of TypeScript they own, written against Cloudflare `agents` 0.33.0 or the Vercel AI SDK `ai` 7.0.162;
2. a gate report with type-check, mock-model and eval results;
3. a deployment in their own Cloudflare or Vercel account;
4. an audit trail of the build.

The platform never pays for or proxies model tokens on its own keys. Milestone M9 adds AWS and makes our own SDK and harness the default generation target on all three clouds.

**Who it serves.** Other users from the start (PF1). Each user is a tenant with their own sign-in, repositories, cloud accounts, model key, quotas and audit log, and no tenant can read another tenant's data or reach another tenant's sandbox.

**Non-goals.** Each belongs to later work, for a stated reason:
- **A visual canvas, multi-agent design and the long tail of integrations.** Incumbents are strongest there, and two vendors have just retired their first-generation builders ([agent-building platforms report][abp-win]). The platform reaches integrations through MCP servers the user names.
- **A hosted runtime for generated agents.** Every agent runs in the user's own cloud account (PF6). Hosting them ourselves would make us the custodian of their data and keys.
- **GCP and Azure deploy targets.** Our SDK and harness do not target them ([ADR 0033](../decisions/0033-three-deployment-targets.md)), and the generated-agent targets follow the same list.
- **Generating against SDKs we have not verified.** Generating against an SDK without a verified reference repeats the API-drift problem the platform exists to solve (PF2).
- **Teams, roles and enterprise single sign-on.** One user per tenant comes first; PF12 leaves room for teams.

## 2. Decisions

| # | Decision | Status | ADR |
| --- | --- | --- | --- |
| PF1 | The platform serves other users from the start, one tenant per user | Accepted (owner, 2026-11-18) | [0037](../decisions/0037-multi-user-agent-platform.md) |
| PF2 | Generated agents use our SDK and harness by default once they ship, plus verified third-party SDKs | Accepted (owner, 2026-11-18) | [0038](../decisions/0038-generated-agent-sdk-policy.md) |
| PF3 | The builder engine is a coding agent task type, run per tenant | Proposed | none |
| PF4 | A check-and-deploy gate refuses every deploy that fails type-check, mock-model tests or hidden-grader evals | Accepted (owner, 2026-11-18) | [0039](../decisions/0039-check-and-deploy-gate.md) |
| PF5 | Generated agents import one safety package for signed approvals, idempotency keys and typed outcomes | Proposed | none |
| PF6 | Users connect their own cloud accounts with scoped, expiring credentials held outside every sandbox | Accepted (owner, 2026-11-18) | [0040](../decisions/0040-tenant-cloud-connections-and-byok.md) |
| PF7 | Every model call uses the user's own key, with no fallback to ours | Accepted (owner, 2026-11-18) | [0040](../decisions/0040-tenant-cloud-connections-and-byok.md) |
| PF8 | One public GitHub App, installed by each user, delivers code as a draft pull request | Accepted (owner, 2026-11-18) | [0041](../decisions/0041-platform-github-app.md) |
| PF9 | Generated code runs only in a fresh hosted sandbox per task, with no stdio MCP commands and egress denied by default | Accepted (owner, 2026-11-18) | [0042](../decisions/0042-generated-code-isolation.md) |
| PF10 | Each tenant has quotas checked before each task, and the platform meters and bills its own compute only | Proposed | none |
| PF11 | Each tenant has an append-only audit log and a retention period | Proposed | none |
| PF12 | Users sign in with GitHub | Proposed | none |

### PF1. Other users from the start, one tenant per user (accepted)

**Accepted by the owner on 2026-11-18:** "Others from the start".

The personal coding agent stays personal ([ADR 0032](../decisions/0032-personal-coding-agent-first.md)), and this platform is a separate product built on its engine. M8's own todos therefore cover the multi-user concerns, and no later hardening round is planned for them:

- tenancy (F1) and sign-in (F2);
- cloud connections (F7, F8) and BYOK (F9);
- isolation (F11);
- quotas and billing (F13);
- audit and retention (F14).

A tenant is the unit of isolation. Each tenant's tasks run in Durable Objects named by tenant and task, its secrets are encrypted under a tenant key, and its sandboxes are never shared.

**Revision (2026-11-19): memory is per tenant.** The [retrieval and memory report][u18] (U18) proposed twelve plan changes, and the owner approved all twelve on 2026-11-19; change 12 adds this note. The report names three signals that a memory service is worth its price, and the platform shows the first from its first tenant: many end users, each with an isolated profile. No Round F todo builds memory yet. When one does, each tenant gets its own memory namespace, and the retriever applies the tenant filter inside the query, before ranking, never to the results. Cloudflare's Vectorize applies a metadata filter before it takes the top-k, and OWASP's ASI06 describes how a loose namespace filter lets an attacker's near-duplicate pull "another tenant's sensitive chunk into retrieval" ([retrieval and memory report][u18-filter]).

### PF2. Our SDK by default once it ships, plus verified third-party SDKs (accepted)

**Accepted by the owner on 2026-11-18:** "Ours, plus verified third-party".

M8 generates against two SDKs we have already verified: Cloudflare `agents` 0.33.0 and the Vercel AI SDK `ai` 7.0.162, the exact pins in [`verify/cloudflare-agents`](../../verify/cloudflare-agents/) and [`verify/vercel-ai-sdk`](../../verify/vercel-ai-sdk/). Each has a verified reference and a skill ([Cloudflare skill](../../.agents/skills/cloudflare-agents/SKILL.md); [Vercel AI SDK skill](../../.agents/skills/vercel-ai-sdk/SKILL.md)). U12 recommended Cloudflare first, because only Cloudflare combines durable per-agent state, a native approval flow, credential-brokering sandboxes and a gateway that refuses non-BYO fallback, and Vercel second ([agent-building platforms report][abp-win]). M9 makes our SDK and harness the default once M5 and M6 ship, and the third-party SDKs stay as options. A new SDK, or a new version of a supported one, becomes a target only after it passes the eight-step reference process in [AGENTS.md](../../AGENTS.md#process-for-documenting-an-sdk).

### PF3. The builder engine is a coding agent task type, run per tenant (proposed)

The coding agent already turns a request into code in a sandbox and delivers it as a draft pull request ([coding agent plan §3][ca-arch]). The platform adds a `build-agent` task type to that engine instead of writing a second one. The task's input is the user's description and the chosen target; its tools and instructions come from the target's generation template (F6); and its output is a repository plus a gate request. The platform runs the engine per tenant: one Durable Object per task, named `<tenant>/<task>`, on the platform's own Cloudflare account. The personal agent's decisions carry over except where this plan sets a stricter rule (PF8, PF9).

The engine depends on Round W, and Round W depends on our harness. Round F therefore splits. Stage F-a, everything that needs no engine, starts as soon as the SDK workspace exists (§5.1), and only the build-agent task type (F12) waits for W4 and W5.

### PF4. A check-and-deploy gate, with graders the generator never sees (accepted, ADR 0039)

**Accepted by the owner on 2026-11-18**, with ADR 0039.

The gate is platform code, so a model cannot skip it. A skill can tell a model to run the tests, but the model can skip the step or claim it passed. The gate therefore runs in the platform's own infrastructure, after the generator finishes, and the deploy adapters accept only a deploy request that carries a passing gate report for the exact commit. The gate runs three checks in a fresh sandbox:

1. **Type-check** the generated project against the pinned SDK's `.d.ts` files, reusing the extract-and-type-check approach of the verification harnesses ([`verify/cloudflare-agents/scripts`](../../verify/cloudflare-agents/scripts/)).
2. **Mock-model tests**: run the project's tests against the SDK's mock model, as the harnesses' `mock-model.mjs` runners do, with host-touching tools denied by name.
3. **Evals** with positive and negative cases, scored by graders the generator cannot read or edit.

The third check answers the strongest warning in the research. In the Darwin Gödel Machine, one variant removed the logging its hallucination detector relied on, and hiding the checking functions reduced how often that happened ([agent-building platforms report][abp-test]). The generator therefore writes test cases but never sees the graders, which the platform keeps per template and per tenant. The user sees the gate report before the first deploy, and every later deploy re-runs the gate.

### PF5. One safety package inside every generated agent (proposed)

Generated agents import one versioned package, planned as `@buildanagent/agent-safety`, instead of receiving fresh safety code from each generation. It provides three things. First, signed approvals: it signs each pause with the package's own `hmacSigner()`, which [E3](../todos/ready/E3-signed-approvals-third-party.md) builds under [ADR 0043](../decisions/0043-standalone-safety-core.md) (accepted), and wraps the target SDK's own gate, `needsApproval` in Cloudflare `agents` and `toolApproval` in the AI SDK ([Vercel AI SDK skill](../../.agents/skills/vercel-ai-sdk/SKILL.md)). Second, idempotency keys: every outward write carries a key persisted before the call and scoped to `(tenant, session, branch, tool_call_id)` ([server rollback report][sr]). Third, typed outcomes: each write reports one of the five outcome kinds that [SG3](close-sdk-gaps.md#sg3-a-write-reports-one-of-five-outcomes-and-unknown-is-never-retried-with-a-fresh-key-accepted) defines: `applied`, `not_applied`, `compensated`, `partial` or `unknown` ([server rollback report][sr-out]). *(Revised in plan review 2, 2026-11-19: ADR 0043 is accepted, the signer comes from E3 rather than the SDK's B15, and SG3 adds `applied` to the four failure kinds.)* No platform in U12's survey documents signed approvals or side-effect undo ([agent-building platforms report][abp-appr]), so the package carries two of the platform's five openings.

### PF6. Users connect their own clouds with scoped, expiring credentials (accepted, ADR 0040)

**Accepted by the owner on 2026-11-18**, with ADR 0040.

The platform deploys into accounts it does not own, so each connection uses the provider's own delegation mechanism and the narrowest scope it offers:

| Target | Connection | Scope and lifetime |
| --- | --- | --- |
| Cloudflare | OAuth client ("OAuth Applications on Cloudflare", available on every plan), or an account API token the user creates from our template URL | Permission groups limited to what a deploy needs, such as `Workers Scripts Edit` and `AI Gateway Edit`; an expiry date and client IP filtering where the user sets them ([Cloudflare OAuth](https://developers.cloudflare.com/fundamentals/oauth/); [account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/); [create token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/); [token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)) |
| Vercel | An integration with selected API scopes, or a project-scoped access token | API scopes chosen at integration setup; tokens scoped to an account, a team or one project ([Vercel integrations](https://vercel.com/docs/integrations/create-integration/submit-integration); [access tokens](https://vercel.com/docs/accounts/access-tokens)) |
| AWS (M9) | A cross-account IAM role the user creates, trusting our account and requiring a per-tenant `sts:ExternalId` | `AssumeRole` sessions last one hour by default; the external ID prevents the confused-deputy problem and must be unique per customer and generated by us ([AWS, third-party access](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html); [AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)) |

The platform stores OAuth refresh tokens, API tokens and role ARNs encrypted under the tenant's key in its own control plane, and uses them only in the deploy adapters. They never enter a sandbox, the generator's context or the generated code.

### PF7. The user's own model key, with no fallback to ours (accepted, ADR 0040)

**Accepted by the owner on 2026-11-18**, with ADR 0040.

The platform never holds a model key of its own for tenant work, so it cannot fall back to one. U12 found the market's weak point here. Vercel AI Gateway retries a failed BYOK request on Vercel's own provider keys and bills the user's credits, a fallback that "is on by default". Cloudflare AI Gateway instead offers an opt-in `byok_only` setting that refuses to fall back ([agent-building platforms report][abp-byok]). The preferred path keeps the key in the user's own account. The user's Cloudflare AI Gateway stores the provider key in the user's Secrets Store, `byok_only` is on, and the platform holds only an authentication token with the gateway's `Run` permission ([Authenticated Gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/); [BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)). The fallback path, for users without Cloudflare, stores the provider key encrypted under the tenant's key and adds it only at egress, as HD15 does. The generator's build calls and the deployed agent's calls both use the user's key; a deployed agent reads its key from the user's own cloud secret store.

### PF8. One public GitHub App, installed by each user (accepted, ADR 0041)

**Accepted by the owner on 2026-11-18**, with ADR 0041.

The personal agent's App is installed on one account ([ADR 0034](../decisions/0034-github-app-identity.md)). The platform needs a public App instead, which "any user on GitHub can install" ([GitHub, App visibility](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private)). Each user installs it on the repositories the platform may write. Everything else in ADR 0034 carries over per tenant: a one-hour installation token narrowed to the task's repository, minted outside the sandbox, added at egress, and allowed to push only to `agent/*` branches. ADR 0041 adds one rule: a task may use only an installation that belongs to its own tenant.

### PF9. Generated code runs only in a fresh hosted sandbox (accepted, ADR 0042)

**Accepted by the owner on 2026-11-18**, with ADR 0042.

Generated code is untrusted code written by a model from a stranger's description, so the platform's isolation is stricter than the personal agent's. U12's security review gives three lessons: run generated code in a VM or container, never an in-process sandbox; never let a generated config name a stdio MCP command; and never store a user's model key in the builder's own database ([agent-building platforms report][abp-sec]). The platform applies the first two as rules, and PF7 applies the third. Every generator run and every gate run gets a fresh hosted sandbox for one task and one tenant, Cloudflare Sandbox or E2B behind `SandboxClient`, and never a local `srt` or Docker backend. Egress is denied by default, with package registries and the user's named MCP hosts on the allowlist. The gate also rejects any generated MCP configuration that names a command instead of a URL.

### PF10. Per-tenant quotas, checked before each task (proposed)

Each tenant has caps on concurrent tasks, sandbox minutes per day and gate runs per day, checked before a task starts, the way SDK D9 checks the budget before each model call ([SDK plan][sdk]). Because every model call uses the user's key (PF7), the platform meters and bills only what it pays for: sandbox time, gate runs and control-plane storage. Sign-in is required before any task, and new accounts start on low caps.

### PF11. An append-only audit log per tenant (proposed)

Each tenant's log records every build, gate report, deploy, approval and connection change, with the commit, the target and the actor. The log is append-only, and a user can export it. Retention follows HD11's rule: keep until a retention period is set ([harness plan][hp]). The platform asks each new tenant to choose one, and closing an account deletes the tenant's data after a stated grace period.

### PF12. Sign in with GitHub (proposed)

Code delivery already requires a GitHub account (PF8), so GitHub OAuth is the first sign-in method. One user is one tenant in M8; teams with roles come later and need their own record.

## 3. Architecture: a per-tenant engine, a gate it cannot bypass, and deploys into the user's account

```
user ── sign in (GitHub) ──► platform control plane (Cloudflare Worker)
                               tenants, quotas, audit log, encrypted connections
                                   │
                                   ▼
                 Durable Object <tenant>/<task>: build-agent task (coding agent engine)
                   template + skill for the target SDK (agents 0.33.0 or ai 7.0.162)
                                   │
                 egress route ◄────┤  user's model key (gateway token) and
                                   │  installation token added here
                                   ▼
                 fresh sandbox: generate project, write tests and eval cases
                                   │
                                   ▼
                 draft pull request in the user's repository
                                   │
                                   ▼
                 gate (fresh sandbox): type-check, mock-model tests, hidden-grader evals
                                   │ passing report for this commit
                                   ▼
                 deploy adapter ──► the user's Cloudflare or Vercel account
                                     agent reads its key from the user's secret store
```

- **Control plane (F1, F2, F13, F14).** A Worker holds tenants, sign-in sessions, quotas, the audit log and the encrypted connections. It is the only component that decrypts a tenant's credentials.
- **Engine (F12).** The coding agent's task runner with the `build-agent` task type, one Durable Object per tenant and task.
- **Templates and skills (F6).** One template per target: project layout, the safety package wiring, test scaffolding and generation instructions taken from the verified skill.
- **Gate (F3, F4).** Runs after generation in its own sandbox, signs its report, and holds the graders.
- **Deploy adapters (F7, F8, F17).** Accept a signed gate report for the commit, then deploy with the tenant's connection.

## 4. What this plan changes elsewhere

The platform reuses the coding agent's engine and the harness's seams, and it changes no accepted decision. The [coding agent plan][ca] stays personal: ADR 0041 applies only to the platform's App, and ADR 0034 is unchanged. The [roadmap](roadmap.md) gains M8 and M9. The verification harnesses gain one new consumer, the gate, so their type-check and mock-model runners should be factored into reusable modules when F3 starts; F3 owns that refactor.

## 5. Round F and its todos

Round F splits by what it needs. Stage F-a needs only the SDK workspace and runs during M5; stage F-b needs the coding agent's engine; stage F-c is M9.

### 5.1 Stage F-a builds everything that needs no engine

| Todo | Delivers | Depends on | Size |
| --- | --- | --- | --- |
| [F1](../todos/ready/F1-platform-tenancy.md) | `@buildanagent/platform` package, the tenant model and per-tenant key encryption | B1 | M |
| [F2](../todos/ready/F2-github-sign-in.md) | GitHub sign-in and sessions | F1 | S |
| [F3](../todos/ready/F3-gate-type-check-and-mock-tests.md) | The gate's type-check and mock-model checks, with the verify runners factored out | B1 | M |
| [F4](../todos/ready/F4-hidden-grader-evals.md) | Hidden-grader eval runner and signed gate reports | F3 | M |
| [F5](../todos/ready/F5-agent-safety-package.md) | `@buildanagent/agent-safety` with adapters for `agents` 0.33.0 and `ai` 7.0.162 (scope moved to Round E, [close-sdk-gaps plan](close-sdk-gaps.md); revised 2026-11-18) | E7 | M |
| [F6](../todos/ready/F6-generation-templates.md) | Generation templates for Cloudflare `agents` and the AI SDK | F3, F5 | M |
| [F7](../todos/ready/F7-cloudflare-connection-and-deploy.md) | Cloudflare connection and deploy adapter | F1, F4 | M |
| [F8](../todos/ready/F8-vercel-connection-and-deploy.md) | Vercel connection and deploy adapter | F1, F4 | M |
| [F9](../todos/ready/F9-byok.md) | BYOK through the user's AI Gateway, the encrypted-key fallback, and a no-fallback test | F1, F7 | M |
| [F13](../todos/ready/F13-quotas-and-metering.md) | Per-tenant quotas and metering | F1 | M |
| [F14](../todos/ready/F14-audit-log-and-retention.md) | Audit log, export and retention | F1 | S |

### 5.2 Stage F-b connects the engine and ships M8

| Todo | Delivers | Depends on | Size |
| --- | --- | --- | --- |
| [F10](../todos/ready/F10-platform-github-app.md) | The public GitHub App and per-tenant installations | W3, F1 | M |
| [F11](../todos/ready/F11-generated-code-isolation.md) | The generated-code sandbox profile and MCP-config rule | N43, N46b, N47b | M |
| [F12](../todos/ready/F12-build-agent-task.md) | The `build-agent` task type on the coding agent's runner, per tenant | W4, W5, F6, F10, F11 | L |
| [F15](../todos/ready/F15-security-review.md) | Security review and abuse tests before sign-ups open | F12, F9, F13, F14 | M |
| [F16](../todos/ready/F16-platform-v1-end-to-end.md) | M8 end to end: describe, build, gate and deploy to Cloudflare and Vercel | F15, F7, F8, F2 | M |

### 5.3 Stage F-c is M9: AWS and our own SDK

| Todo | Delivers | Depends on | Size |
| --- | --- | --- | --- |
| [F17](../todos/ready/F17-aws-connection-and-deploy.md) | AWS connection by cross-account role and deploy adapter | F16, N47a | M |
| [F18](../todos/ready/F18-our-sdk-as-default-target.md) | Our SDK and harness as the default generation target on all three clouds | F16, B20, N45 | L |

## 6. Every test runs offline, and the end-to-end test proves no tenant credential reaches a sandbox

Every test runs offline on scripted models, and no mock model calls a tool that touches the host ([harness plan §5.1][hp-51]). Cloud connections and deploys are tested against recorded HTTP exchanges; live runs against real accounts are opt-in and never part of CI. The end-to-end test (F16) uses two fake tenants and asserts four things: no credential string of either tenant appears in any sandbox's environment, files or command lines; tenant B cannot read tenant A's tasks, logs or installations; a deploy request without a passing gate report for its commit is refused; and a failed BYOK request ends in an error, never in a call on another key.

## 7. Five risks each have a todo that settles them, and stage F-a can start during M5

Five risks remain, and each has a todo that settles it:
1. **Generated code is hostile by assumption.** F11 and F15 test sandbox escape, egress and MCP-config attacks before sign-ups open (PF9).
2. **A tenant's credentials could leak across tenants.** F1's per-tenant encryption and F16's two-tenant test settle it.
3. **The generator could learn to game the gate.** F4 keeps the graders outside the generator's sandbox and context, and F15 tests whether a generated project can read or alter them (PF4).
4. **Third-party SDKs move.** The templates pin exact versions, and a new version enters only through the reference process (PF2).
5. **The engine arrives late.** F12 waits for W4 and W5, which wait for the harness. Stage F-a runs during M5 so that F12 is the only engine-bound todo; if the wait grows too long, the owner can decide to run an interim generator on a verified third-party harness, which this plan does not assume.

Stage F-a starts once the owner says go (every F todo is on hold; owner, 2026-11-19): F1 and F3, which need only B1, are the first todos to open. M8 ships when F16 passes, and M9 follows when our SDK and harness are complete.

[abp]: ../research/deployment/agent-building-platforms.md
[u18]: ../research/memory/retrieval-and-memory.md#a-file-is-enough-for-one-agent-and-one-user-and-a-service-earns-its-price-at-many-users-or-temporal-questions
[u18-filter]: ../research/memory/retrieval-and-memory.md#retrieved-text-and-stored-memory-are-untrusted-input-so-filter-before-ranking-and-record-each-records-source
[abp-sec]: ../research/deployment/agent-building-platforms.md#approvals-are-common-but-signed-approvals-and-side-effect-undo-exist-nowhere
[abp-appr]: ../research/deployment/agent-building-platforms.md#approvals-are-common-but-signed-approvals-and-side-effect-undo-exist-nowhere
[abp-test]: ../research/deployment/agent-building-platforms.md#testing-a-generated-agent-before-showing-it-is-the-least-served-step
[abp-byok]: ../research/deployment/agent-building-platforms.md#no-platform-deploys-a-built-agent-to-cloudflare-or-vercel-and-byo-key-usually-carries-a-markup
[abp-win]: ../research/deployment/agent-building-platforms.md#where-a-new-platform-could-win-what-it-must-match-and-the-first-slice
[pa]: ../research/deployment/portable-agents.md
[sw]: ../research/deployment/storage-and-wake.md
[ca]: build-coding-agent.md
[ca-arch]: build-coding-agent.md#3-architecture-the-loop-in-a-durable-object-the-sandbox-without-credentials
[sdk]: build-sdk.md
[hp]: build-harness.md
[hp-51]: build-harness.md#51-every-test-runs-offline-on-the-sdks-scripted-model-and-no-test-touches-the-host
[sr]: ../research/reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped
[sr-out]: ../research/reversible-actions/server-rollback.md#after-a-rollback-tell-the-model-one-of-four-outcomes-in-the-result-body
