# Fact-check: the agent platform plan and its ADRs

This log checks every factual claim in [build-agent-platform.md](../build-agent-platform.md), ADRs [0037](../../decisions/0037-multi-user-agent-platform.md) to [0042](../../decisions/0042-generated-code-isolation.md), and the Round F todos, on 2026-11-18. External pages were read with curl on 2026-11-18. The decisions marked Proposed are our design, so this log checks only the facts they rest on.

## Owner decisions

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 1 | The owner asked to "make our plans our work on building a platform for building agents" | ✅ | Owner's message in this session, 2026-11-18 |
| 2 | The owner chose "Others from the start" for who the platform serves | ✅ | Owner's answer on 2026-11-18 |
| 3 | The owner chose "Ours, plus verified third-party" for the generated agents' SDK | ✅ | Owner's answer on 2026-11-18 |
| 4 | The personal coding agent stays personal, and ADRs 0032 and 0034 are unchanged | ✅ | [ADR 0032](../../decisions/0032-personal-coding-agent-first.md) and [ADR 0034](../../decisions/0034-github-app-identity.md), both Accepted; this round edits neither file |

## Our research and plans

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 5 | Every builder turns a description into an agent, almost all emit vendor configuration, no product tests a generated agent before showing it, and none deploys a built agent to Cloudflare Workers or Vercel | ✅ | [Agent-building platforms report](../../research/deployment/agent-building-platforms.md), introduction and section heads |
| 6 | No platform signs approvals or reverses side effects | ✅ | Same report, "Approvals are common, but signed approvals and side-effect undo exist nowhere" |
| 7 | Langflow has six CISA KEV entries and n8n has one | ✅ | Same report, security paragraph under the approvals section; it cites the CISA catalog and was itself checked in [U12's fact-check](../../research/deployment/fact-check-agent-building-platforms.md) |
| 8 | U12's three security lessons: VM or container isolation, no stdio MCP commands in generated config, no user model key in the builder's database | ✅ | Same paragraph, verbatim in substance |
| 9 | In DGM, a variant removed the logging its hallucination detector relied on, and hiding the checking functions reduced how often that happened | ✅ | Same report, "Testing a generated agent before showing it is the least-served step" |
| 10 | U12 recommended Cloudflare first, because it alone combines durable per-agent state, a native approval flow, credential-brokering sandboxes and a gateway that refuses non-BYO fallback, and Vercel second | ✅ | Same report, "Where a new platform could win…", first-slice paragraph |
| 11 | Vercel AI Gateway's BYOK fallback "is on by default" and bills the user's credits; Cloudflare's `byok_only` is opt-in and refuses fallback | ✅ | Same report, BYOK paragraph; U12's fact-check confirmed both against Vercel's and Cloudflare's docs |
| 12 | Two vendors have just retired their first-generation builders | ✅ | Same report: OpenAI's Agent Builder canvas (deprecated 2026-06-03, shutting down 2026-11-30) and Bedrock Agents Classic |
| 13 | The four outcome kinds are `not_applied`, `compensated`, `partial` and `unknown` | ✅ | [Server rollback report](../../research/reversible-actions/server-rollback.md#after-a-rollback-tell-the-model-one-of-four-outcomes-in-the-result-body), outcome table |
| 14 | Idempotency keys are persisted before the call and scoped to `(tenant, session, branch, tool_call_id)` | ✅ | [Server rollback report](../../research/reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped) |
| 15 | The coding agent's engine runs the loop outside a credential-free sandbox and delivers a draft pull request | ✅ | [Coding agent plan §3](../build-coding-agent.md#3-architecture-the-loop-in-a-durable-object-the-sandbox-without-credentials); ADR 0036 |
| 16 | W4 depends on the harness's Cloudflare adapters, so the engine waits for the harness | ✅ | [W4](../../todos/ready/W4-durable-object-task-runner.md): Depends on W2, N46a, N46b |
| 17 | Our SDK and harness do not target GCP or Azure | ✅ | [ADR 0033](../../decisions/0033-three-deployment-targets.md): "GCP and Azure are not targets" |
| 18 | The verified pins are Cloudflare `agents` 0.33.0 and `ai` 7.0.162 | ✅ | `verify/cloudflare-agents/package.json` and `verify/vercel-ai-sdk/package.json` |
| 19 | Both harnesses have type-check and mock-model runners (`typecheck-examples.mjs`, `mock-model.mjs`) | ✅ | Their `scripts/` folders |
| 20 | Cloudflare `agents` gates tools with `needsApproval`; the AI SDK uses `toolApproval` | ✅ | [Cloudflare skill](../../../.agents/skills/cloudflare-agents/SKILL.md) (on four lines) and [Vercel AI SDK skill](../../../.agents/skills/vercel-ai-sdk/SKILL.md) (`toolApproval: { issueRefund: "user-approval" }`) |
| 21 | Todo B15 provides `hmacSigner()` over a key ring | ✅ | [B15](../../todos/ready/B15-signed-pauses.md), scope list |
| 22 | SDK D9 checks the budget before each model call | ✅ | [ADR 0009](../../decisions/0009-pre-emptive-budget.md) title |
| 23 | HD11 keeps transcripts until a retention period is set | ✅ | [Harness plan](../build-harness.md), HD11 heading |
| 24 | A new SDK becomes a target only through the eight-step reference process in AGENTS.md | ✅ | [AGENTS.md](../../../AGENTS.md#process-for-documenting-an-sdk), "Every SDK reference follows the same eight steps" |
| 25 | The draft said the two retirements happened "within about two and a half years" | ✏️ | U12's fact-check corrected the lifespans to about 14 months (OpenAI) and about two and a half years (Bedrock Agents). The plan now says only that two vendors "have just retired" their first-generation builders |

## External facts

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 26 | Cloudflare offers OAuth applications that let third-party apps access Cloudflare resources on users' behalf, on every plan | ✅ | [OAuth Applications on Cloudflare](https://developers.cloudflare.com/fundamentals/oauth/): availability table Yes on Free, Pro, Business and Enterprise; "allows third-party applications to securely access Cloudflare resources without requiring users to share long-lived API tokens" |
| 27 | Cloudflare account API tokens act as service principals with their own permissions | ✅ | [Account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/): "act as service principals with their own specific set of permissions" |
| 28 | Cloudflare token template URLs pre-fill a token's permissions for a user | ✅ | [API token template URLs](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/): "share token requirements with users without manually selecting permissions" |
| 29 | Cloudflare tokens can carry an expiry and client IP filtering | ✅ | [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/): "Token expiration and Client IP Address Filtering fields" |
| 30 | The draft limited Cloudflare tokens to "Workers, Durable Objects and AI Gateway" permissions | ✏️ | [Token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) lists `Workers Scripts Edit` and `AI Gateway Edit`/`Read`/`Run` but no Durable Objects group. The plan and F7 now name `Workers Scripts Edit` and `AI Gateway Edit` and leave the rest to a recorded deploy |
| 31 | Which OAuth scopes a Workers deploy needs | ⚠️ | The OAuth pages list endpoints, not scopes; F7 records it as an open question for when the client is registered |
| 32 | Vercel integrations select API scopes at setup | ✅ | [Submit an integration](https://vercel.com/docs/integrations/create-integration/submit-integration): "API Scopes define the level of access your integration will have" |
| 33 | Vercel access tokens can be scoped to an account, a team or one project | ✅ | [Access tokens](https://vercel.com/docs/accounts/access-tokens): "scope Vercel access tokens to your full account, a team, or a single project" |
| 34 | AWS third parties use a cross-account role with `sts:ExternalId`, unique per customer and generated by the third party, against the confused-deputy problem | ✅ | [AWS, third-party access](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html): "it must be generated by Example Corp and not their customers"; "unique for each customer" |
| 35 | `AssumeRole` sessions last one hour by default | ✅ | [AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html): "By default, the value is set to 3600 seconds" |
| 36 | A public GitHub App can be installed by "any user on GitHub"; a private one only on its owner's account | ✅ | [GitHub, App visibility](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private) |
| 37 | AI Gateway stores BYOK provider keys in Secrets Store | ✅ | [BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/): "The keys are stored securely with Secrets Store" |
| 38 | An authenticated gateway accepts a token with the gateway's `Run` permission | ✅ | [Authenticated Gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/): "generate a custom token with the required `Run` permissions"; [token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) lists `AI Gateway Run` |
| 39 | GitHub documents the OAuth web flow F2 uses | ✅ | [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), page loads (HTTP 200) |
| 40 | The owner accepted ADRs 0039–0042 (PF4, PF6–PF9) on 2026-11-18 | ✅ | Owner's answers in this session, 2026-11-18: "Accept" for each of 0039, 0040, 0041 and 0042 |

## Memory note from U18 (2026-11-19)

These rows check PF1's dated revision on per-tenant memory, against the [retrieval and memory report](../../research/memory/retrieval-and-memory.md) and [its fact-check](../../research/memory/fact-check-retrieval-and-memory.md), on 2026-11-19.

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 41 | The owner approved all twelve of U18's proposed changes on 2026-11-19, among them change 12, this note | ✅ | Owner's answers, 2026-11-19: every option chosen in three multi-select questions |
| 42 | The report's first signal that a memory service is worth its price is many end users who each need an isolated profile, and the platform shows it from its first tenant | ✅ | [U18 report, Service ¶1](../../research/memory/retrieval-and-memory.md#a-file-is-enough-for-one-agent-and-one-user-and-a-service-earns-its-price-at-many-users-or-temporal-questions), signal 1 and its last sentence; the signals are the report's own synthesis (its fact-check row 93, ⚠️ inferred) |
| 43 | Vectorize applies a metadata filter before taking the top-k | ✅ | U18 report, Untrusted ¶3, quoting [Vectorize metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/): the "filter is applied first, and the topK results are taken from the filtered set" (vendor docs) |
| 44 | OWASP's ASI06 describes a near-duplicate pulling "another tenant's sensitive chunk into retrieval" through a loose namespace filter | ✅ | U18 report, Untrusted ¶3, quoting the [OWASP Agentic Top 10](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) |
| 45 | No Round F todo builds memory yet | ✅ | `grep -il memory docs/todos/*/F*.md` finds only F1, whose "memory implementation" is an in-memory test store for tenants |

**Totals:** 45 claims: 42 ✅, 2 ✏️, 1 ⚠️.
