# Fact-check: the coding agent plan and its ADRs

This log checks every factual claim in [build-coding-agent.md](../build-coding-agent.md), ADRs [0032](../../decisions/0032-personal-coding-agent-first.md) to [0036](../../decisions/0036-loop-outside-sandbox-and-pr-approval.md), and the revision notes added to the SDK and harness plans, on 2026-11-18. Repo claims were read at `main` `60c244f`. External pages were read with curl on 2026-11-18. Design choices (the CA decisions themselves) are ours and are not facts to check; the log checks what they rest on.

## Owner decisions

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 1 | The owner said "just personal with our own api key" | ✅ | Owner's message in this session, 2026-11-18 |
| 2 | The owner wants to "deploy it to at least two cloud platforms or three" | ✅ | Owner's message, 2026-11-18 |
| 3 | The owner chose the coding agent to replace triage, and asked about all-Cloudflare deployment | ✅ | Owner's answers on 2026-11-18: "Replace triage" and "why is all Cloudflare not an option?", then agreement to the all-Cloudflare plan |

## Our research and plans

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 4 | Six cloud coding agents share one shape: control plane, disposable VM, egress proxy, branch or PR output | ✅ | [Portable agents report](../../research/deployment/portable-agents.md#cloud-coding-agents-are-a-control-plane-around-a-disposable-vm), first paragraph |
| 5 | The harness is tied to one host in six places | ✅ | Portable agents report, "The SDK travels" section heading and body |
| 6 | U11 lists control plane, GitHub identity, PR delivery and triggers among parts no plan covers | ✅ | Portable agents report, cloud-agent component table ("Plan coverage: none") |
| 7 | Tenancy, billing and per-user installs are in U11's outside-the-VM list | ✅ | Same table, "Notifications, tenancy, cost" and "Repo identity and push" rows |
| 8 | U11 calls the snapshot cache the largest new design | ✅ | Portable agents report: "The snapshot cache is the largest new design" |
| 9 | Cloud Run sandboxes and Azure dynamic sessions allow egress only on or off and fail the allowlist rule | ✅ | Portable agents report, sandbox table rows for both |
| 10 | The SDK's `ProviderConfig` takes `apiKey` as a string | ✅ | [SDK plan §3.2](../build-sdk.md#32-gateway-api): `interface ProviderConfig { apiKey: string; … }` |
| 11 | N38b adds ten triage tasks after A17 and A19; N38 runs twenty repository tasks | ✅ | [Harness plan, HD8](../build-harness.md#hd8-a-30-task-seed-suite-of-20-repository-and-10-coding-agent-tasks-at-k--5-accepted-amended) and the §4.7 todo table |
| 12 | HD8 runs at k = 5 with a $3 cap, which is mini-swe-agent's default | ✅ | HD8, "Choice" and "Evidence" |
| 13 | U11's per-target table maps Cloudflare to DO SQLite, AWS to DynamoDB with a conditional write and lease row, Vercel to Postgres; it is inference and untested | ✅ | Portable agents report, per-target table and the sentence before it |
| 14 | Cloudflare Sandbox can be driven only from Workers | ✅ | Portable agents report, quoting Cloudflare: "If your application runs outside of the Workers ecosystem, it cannot interact with sandboxes directly" |
| 15 | AWS has no native sandbox meeting the allowlist rule on the pages U11 read | ✅ | Portable agents report, "Two practical constraints" paragraph |
| 16 | OpenHands V1 runs the loop inside the container; mini-swe-agent and Open SWE keep it outside | ✅ | Portable agents report, open-source paragraph |
| 17 | Claude Code on the web and Codex keep credentials outside the VM and substitute placeholders at a proxy | ✅ | Portable agents report, credential-split paragraph |
| 18 | U11 recommends a git route that rejects deletes and tag pushes | ✅ | Portable agents report, "Repo identity and push" row |
| 19 | The Copilot cloud agent's draft pull request is the only Copilot surface reviewed as a whole task | ✅ | [Copilot diff review report](../../research/agent-ui/copilot-diff-review.md#visual-studio-and-jetbrains-review-after-the-write-the-cloud-agent-reviews-before-the-merge): its review-unit table gives "Whole task" only for the cloud agent; U11 states the same rule |
| 20 | The 12-factor report says "we have no design for how ticket and approval events reach the agent" | ✅ | [12-factor report](../../research/external-designs/twelve-factor-agents.md#five-small-changes-follow-led-by-an-ingress-design), verbatim |
| 21 | Copilot strips hidden HTML from triggers and accepts only users with write access | ✅ | Portable agents report, "Triggers" row |
| 22 | Claude Code on the web rebuilds its environment snapshot after about seven days | ✅ | Portable agents report, cloud-agent paragraph, citing Anthropic's cloud-environments page |
| 23 | Base-branch conflicts emit no webhook | ✅ | Portable agents report, "PR delivery and follow-up" row, citing Claude Code on the web |
| 24 | Model calls waiting on `fetch` do not count against Workers' CPU limit; alarms stop at 15 minutes | ✅ | [Portable agents report, runtimes](../../research/deployment/portable-agents.md#runtimes-split-into-an-isolate-tier-and-a-process-tier), citing Workers limits |
| 25 | A tool call id deduplicates only once persisted before execution and scoped to session, branch and call | ✅ | [Server rollback report](../../research/reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped) |
| 26 | U11 proposes fifteen changes; 2–11 and 15 are the ones the three-target decision adopts | ✅ | Portable agents report, "Fifteen plan changes follow" table; mapping checked row by row in plan §4 |
| 27 | Plan §4 first said changes 12–14 "land in this plan or the guide" | ✏️ | Change 12 is an edit to the harness guide that this PR does not make. Now: changes 13 and 14 are this plan and its ingress design, and change 12 stays open for the guide's next revision |
| 28 | The plan's test strategy used "the `none` sandbox inside a temp directory" | ✏️ | The harness's offline tests use `fakeSandbox()`, an in-memory file system with a recorded `exec` ([harness plan §5.1](../build-harness.md#51-every-test-runs-offline-on-the-sdks-scripted-model-and-no-test-touches-the-host)). Plan §6 and todo W2 now say `fakeSandbox()` |
| 29 | Vercel's transport is "WebSocket or SSE" | ✏️ | U11's table lists "Vercel WS beta". Now "WebSocket (beta) or SSE" |
| 30 | `e2b` 2.64.0 and `@vercel/sandbox` 4.0.0 were under a week old on 2026-11-18; pins are 2.63.0 and 3.9.1 | ✅ | Portable agents report, pinning paragraph, itself checked in [its fact-check](../../research/deployment/fact-check-portable-agents.md) |
| 31 | Lambda stops at 900 s; Vercel Functions at 300–1,800 s | ✅ | Portable agents report, runtimes section and table |
| 32 | pi-schema has not been tested in workerd; `@cfworker/json-schema` is the fallback | ✅ | Portable agents report, SDK paragraph; [SDK plan D7](../build-sdk.md#d7-pi-schema-validates-raw-json-schema-and-b10-confirms-the-choice-against-both-candidates-provisional) |
| 33 | ADR 0014's last consequence anticipates another lock behind `SessionLock` | ✅ | [ADR 0014](../../decisions/0014-session-writer-lock.md): "A server deployment may later replace the file lock with an actor per session behind the same `SessionLock` interface" |
| 34 | ADR 0015 keeps the key ring in a host-only file that the harness rotates and prunes | ✅ | [ADR 0015](../../decisions/0015-harness-approval-key-ring.md), Decision |
| 35 | HD12's modes exist for a permission profile; HD6 is the CLI protocol | ✅ | Harness plan, HD12 and HD6 headings |

## External sources

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 36 | An installation access token can be narrowed with the `repositories` parameter and expires after one hour | ✅ | [GitHub, generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app): "you can use the `repositories` or `repository_ids` body parameters" and "The installation access token will expire after 1 hour" |
| 37 | GitHub App permissions apply to a whole repository, not to a branch | ✅ | Same page: tokens carry "permissions" and "repositories"; no branch scope is offered. Our reading of the API's shape |
| 38 | Rulesets offer "Require a pull request before merging" and "Block force pushes", and apps can be on a bypass list | ✅ | [GitHub, available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), rule headings; [about rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets): bypass "can be specific teams or GitHub Apps" |
| 39 | EventBridge Scheduler supports one-time schedules | ✅ | [EventBridge Scheduler schedule types](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html): "rate-based, cron-based, and one-time schedules" |
| 40 | Vercel Workflow's `sleep()` suspends a workflow "without consuming any resources", and hooks pause it until external data arrives | ✅ | [Workflow SDK `sleep`](https://workflow-sdk.dev/docs/api-reference/workflow/sleep) and [hooks](https://workflow-sdk.dev/docs/foundations/hooks), both updated 2026-11-17 |

## Review round (2026-11-18): claims touched by the writing-review fixes and the owner's acceptances

| # | Claim | Verdict | Source and reason |
|---|---|---|---|
| 41 | CA7 said "GitHub redelivers webhooks" | ✏️ | GitHub "does not automatically redeliver failed deliveries"; a person or script redelivers them ([GitHub, redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)). Now: a redelivered webhook keeps its `X-GitHub-Delivery` id, which the control plane deduplicates on ([GitHub, webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks): "If you request a redelivery, the `X-GitHub-Delivery` header will be the same as in the original delivery") |
| 42 | Durable Object alarms fire at least once | ✅ | [Cloudflare, Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): "Alarms have guaranteed at-least-once execution"; also the [storage-and-wake note](../../research/deployment/storage-and-wake.md#three-rules-come-with-the-seams), rule 1 |
| 43 | ADR 0035 said `ephemeralSigner()` "is unusable on serverless hosts" | ✏️ | Overstated: it can still sign; it cannot resume a pause after the isolate or function is recycled ([SDK plan D5 note](../build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5); portable agents report, SDK section). Now "cannot resume a pause on a serverless host" |
| 44 | ADR 0034: the common scope weakness U11 found is Open SWE's token, scoped to the whole App installation | ✅ | [Portable agents report](../../research/deployment/portable-agents.md#cloud-coding-agents-are-a-control-plane-around-a-disposable-vm), open-source paragraph: the proxy token "is minted at runtime from the GitHub App installation credentials", "which is the common scope weakness" |
| 45 | The owner accepted ADRs 0034, 0035 and 0036 (CA4, CA5, CA6 and CA10) on 2026-11-18, so ADR 0035 supersedes ADR 0015 | ✅ | Owner's answer on 2026-11-18, relayed in this session; ADR 0035's Consequences already named the status change to 0015 |
| 46 | CA3: Cloudflare Sandbox can be driven only from Workers, where our loop runs; ADR 0033: GCP's and Azure's native sandboxes allow egress only on or off | ✅ | Reworded or newly cited, same sources as rows 14 and 9: the [portable agents report's sandbox section](../../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first) |

**Totals:** 46 claims: 41 ✅, 5 ✏️, 0 ⚠️.
