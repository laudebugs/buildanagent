# Plan: build a personal cloud coding agent on our SDK and harness, deployed first on Cloudflare and portable to AWS and Vercel

- **Status:** Draft (2026-11-18), from the owner's decisions of 2026-11-18. It replaces the [triage agent plan](build-agent.md) as the first agent on our stack. Revised on 2026-11-22 by N29: the stdio transport already takes Web streams, so U11 change 7 lands in N29 for Web streams and in N44 for the WebSocket transport.
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18): "just personal with our own api key", and "we want to deploy it to at least two cloud platforms or three".
- **Builds on:** the [SDK plan][sdk] (P1), the [harness plan][hp] (P2), the [portable agents report][pa] (U11), the [storage-and-wake note][sw], the [agent-building platforms report][abp] (U12) and the [Copilot diff review report][cdr] (U8)
- **Decision records:** [ADRs 0032–0036](../decisions/README.md)
- **Todos:** Round W ("build the coding agent") and the portability todos N41–N50 on the [todo board](../todos/README.md); §5 lists them.

Six cloud coding agents, from Claude Code on the web to Devin, share one shape: a control plane owns the session and the credentials, each task runs in a disposable VM, an egress proxy enforces an allowlist, and a branch or pull request is the output ([portable agents report][pa-cca]). Our harness plan already covers what happens inside that VM. The parts outside it, a control plane, a GitHub identity, PR delivery and triggers, appear in no plan. Our stack also runs on one host today: the harness is tied to it in six places, and storage and wake are the hard part of moving it ([portable agents report][pa-sdk]; [storage-and-wake note][sw]). The coding agent in this plan serves one person, the owner, on the owner's own repositories and model key. It runs on Cloudflare first, and every seam it adds is proved on AWS and Vercel too. **This plan runs our loop in a Durable Object outside the sandbox, gives the sandbox no credentials, delivers every task as a draft pull request the owner merges, and proves the SDK and harness on three clouds with one conformance suite.**

## 1. Goal and non-goals

**Goal.** At the end of Round W, the owner can label a GitHub issue or run one CLI command and receive a draft pull request on one of their own repositories, written by our harness running on Cloudflare. The same SDK and harness pass one conformance suite on local Node, Cloudflare, AWS and Vercel. The coding agent itself deploys on Cloudflare (W4–W8), then on AWS (W9) and Vercel (W10).

**Who it serves.** One user: the owner, on repositories the owner chooses, with the owner's model key and the owner's Cloudflare, AWS and Vercel accounts. That one-user scope removes most of what U11 listed outside the VM: tenancy, billing, per-user GitHub installs and queue fairness ([portable agents report][pa-cca]).

**Non-goals.** Each belongs to later work, for a stated reason:
- **Other users' repositories, tenancy and billing.** The owner chose personal use (CA1). A multi-user agent needs per-tenant isolation, budgets and installs, which [U12's recommended slice][abp-win] leaves for later.
- **A snapshot cache.** U11 calls it the largest new design ([portable agents report][pa-cca]). Tasks start from a base image plus a fresh clone until W8 measures how long that takes (CA8).
- **A web UI.** The pull request is the review surface, and the CLI attaches over WebSocket (W7).
- **GCP and Azure targets.** Their native sandboxes, Cloud Run sandboxes and Azure dynamic sessions, offer egress only on or off and fail our allowlist rule ([portable agents report][pa-sbx]). A deployment there would reuse E2B and add nothing the AWS target does not prove (CA3).
- **The triage agent.** It is deferred, not cancelled (CA2). Its plan, decisions AD1–AD14 and ADRs 0022–0031 stay as written.

## 2. Decisions

| # | Decision | Status | ADR |
| --- | --- | --- | --- |
| CA1 | One user, the owner's repositories, the owner's model key | Accepted (owner, 2026-11-18) | [0032](../decisions/0032-personal-coding-agent-first.md) |
| CA2 | The coding agent replaces triage as the first agent on our stack | Accepted (owner, 2026-11-18) | [0032](../decisions/0032-personal-coding-agent-first.md) |
| CA3 | Cloudflare is the primary target; AWS and Vercel are proved by one conformance suite | Accepted (owner, 2026-11-18) | [0033](../decisions/0033-three-deployment-targets.md) |
| CA4 | The loop runs in a Durable Object outside the sandbox | Accepted (owner, 2026-11-18) | [0036](../decisions/0036-loop-outside-sandbox-and-pr-approval.md) |
| CA5 | One GitHub App, scoped to chosen repositories, minted outside the sandbox, pushing only to `agent/*` branches | Accepted (owner, 2026-11-18) | [0034](../decisions/0034-github-app-identity.md) |
| CA6 | The draft pull request is the approval point | Accepted (owner, 2026-11-18) | [0036](../decisions/0036-loop-outside-sandbox-and-pr-approval.md) |
| CA7 | Triggers start with the CLI and GitHub webhooks, behind one ingress design | Decided | none |
| CA8 | No snapshot cache until W8 measures cold starts | Decided, provisional (W8) | none |
| CA9 | Cloud-mode evals count provisioning time and infra failures apart | Decided | none |
| CA10 | A read-only cloud secret can back the approval key ring | Accepted (owner, 2026-11-18) | [0035](../decisions/0035-read-only-key-store.md) |

### CA1. One user, the owner's repositories and the owner's model key (accepted)

**Accepted by the owner on 2026-11-18:** "just personal with our own api key".

The agent serves one person. The model key is one secret held by the host and added at egress, so it never enters the sandbox. The SDK's `ProviderConfig` already takes `apiKey` as a string, so U11's proposed `SecretSource` (change 1) is unnecessary for one user; the host reads the key from the target's secret store and passes it in ([portable agents report][pa-sdk]; [SDK plan §3.2][sdk-32]).

### CA2. The coding agent replaces triage as the first agent (accepted)

**Accepted by the owner on 2026-11-18.** The coding agent becomes M7's agent. The triage plan, its decisions and its todos stay on the board, each marked deferred, so the work can resume without rework. One harness todo depended on triage: N38b adds ten triage tasks to HD8's seed suite after A17 and A19. N38b is deferred with them, and N38's twenty repository tasks become the coding agent's first eval suite (W8). HD8 was first left unchanged, so the suite stood at twenty tasks; the amendment below restores thirty with W12 ([ADR 0045](../decisions/0045-hd8-coding-agent-eval-tasks.md)).

**Amended (owner, 2026-11-19):** "20 now, plus coding tasks". N38's twenty repository tasks ship first, and [W12](../todos/ready/W12-coding-agent-eval-tasks.md) adds ten coding-agent tasks, so the suite reaches thirty before W8 publishes its baseline. When Round A resumes, N38b adds its ten triage tasks on top ([harness plan, HD8][hp-hd8]).

### CA3. Cloudflare first, then AWS and Vercel, behind one conformance suite (accepted)

**Accepted by the owner on 2026-11-18:** "deploy it to at least two cloud platforms or three", with all of Cloudflare as the first.

| Seam | Local (dev) | Cloudflare (primary) | AWS | Vercel |
| --- | --- | --- | --- | --- |
| `SessionStore` | `jsonlStore()` | Durable Object SQLite | DynamoDB, conditional write | Postgres |
| `SessionLock` | `fileLock()` | the Durable Object as single writer | DynamoDB lease row | Postgres lease row |
| `Scheduler.wake` | in-process timer | Durable Object alarm | EventBridge Scheduler one-time schedule | Workflow `sleep()` and hooks |
| `KeyStore` | key file (HD5) | Worker secret or Secrets Store | Secrets Manager | secret environment variable |
| `SandboxClient` | `srt`, Docker | Cloudflare Sandbox (E2B as a swap) | E2B | Vercel Sandbox |
| `EgressPolicy` | HD15 proxy | per-host `interceptOutboundHttp()` / `interceptOutboundHttps()` on the Durable Object Container API; HTTPS design set by N50; the owner rules on interception for the opt-in credential route, and for the default too if plain allowlisted HTTPS fails without it ([ADR 0060](../decisions/0060-sandboxes-hold-no-credentials-by-default.md)) | deny-all plus the policy's hosts; E2B egress Secrets as the opt-in | deny-all plus the policy's hosts; firewall `transform` as the opt-in, `subnets.allow` banned |
| Transport | stdio | WebSocket on the Durable Object | Lambda response streaming | WebSocket (beta) or SSE |
| `EffectStore` | `memoryEffectStore()` | Durable Object SQLite | DynamoDB, conditional put | Postgres, insert on conflict do nothing |

**Revision (plan review 2, 2026-11-19).** The `EffectStore` row applies [ADR 0043](../decisions/0043-standalone-safety-core.md), which makes it the eighth portable seam; [E2](../todos/done/E2-effect-identity-crash-rule.md) builds the local store and [E7](../todos/done/E7-safety-portability.md) the three cloud stores. The Cloudflare `EgressPolicy` cell changed because `@cloudflare/sandbox` 1.0 removed `outboundByHost`; [N50](../todos/done/N50-cloudflare-sandbox-egress.md) tests the replacement before N46b builds it.

The table follows U11's per-target mapping, which is our inference from each platform's docs and untested ([portable agents report][pa-sdk]). The conformance suite (N45) makes it a test: every implementation in a column must pass the same cases, including HD2's settling test and the three rules of the [storage-and-wake note][sw-rules].

Cloudflare is primary for two reasons. First, a Durable Object gives storage, a single writer and a wake in one object. Second, Cloudflare Sandbox can be driven only from Workers, which is where our loop runs (CA4) ([portable agents report][pa-sbx]). E2B replaces Cloudflare Sandbox behind `SandboxClient` if N49 finds Cloudflare's cold starts too slow. AWS uses E2B because AWS has no native sandbox that meets the allowlist rule on the pages U11 read ([portable agents report][pa-sbx]).

### CA4. The loop runs in a Durable Object, outside the sandbox (accepted)

**Accepted by the owner on 2026-11-18**, with ADR 0036.

The open-source agents place the loop two ways. OpenHands V1 runs it inside the container, and mini-swe-agent and Open SWE keep it outside and send each command in ([portable agents report][pa-cca]). Outside wins here for three reasons. First, the sandbox never holds the model key or the GitHub token, which is HD15's rule. Second, a reclaimed sandbox costs a resume rather than a session, because the log lives in the Durable Object. Third, the loop needs only `fetch` and state, which a Durable Object provides without a process. The sandbox runs commands; it never decides them.

### CA5. One GitHub App, minted outside the sandbox, pushing only to agent branches (accepted)

**Accepted by the owner on 2026-11-18**, with ADR 0034.

The owner installs one GitHub App on their account and selects the repositories it may touch. The control plane mints an installation access token for each task, narrowed to that task's repository with the `repositories` parameter; GitHub expires the token after one hour ([GitHub, installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)). The token stays in the control plane and reaches GitHub only through the egress route, as Claude Code on the web and Codex do with their placeholders ([portable agents report][pa-cca]).

GitHub App permissions apply to a whole repository, so branch scope comes from two other layers. The egress route parses git's push requests and rejects any ref outside `refs/heads/agent/*`, any deletion and any tag, which is U11's "git route that rejects deletes and tag pushes" ([portable agents report][pa-cca]). A repository ruleset on the default branch requires a pull request and blocks force pushes, and the App is never on its bypass list ([GitHub, available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)). Either layer alone stops a push to `main`.

### CA6. The draft pull request is the approval point (accepted)

**Accepted by the owner on 2026-11-18**, with ADR 0036.

Our Copilot research found that the cloud agent's draft pull request is the only Copilot surface that holds a whole change for one human decision ([Copilot diff review report][cdr-cloud]). The coding agent follows it. Inside the sandbox, with network limited to the allowlist, commands run without per-call prompts, because the sandbox and the egress policy bound what they can do. The harness's permission pipeline still asks before any call that leaves those bounds, such as a new egress host, and that ask becomes a signed pause the owner answers from the CLI or a PR comment (HD5). The owner's merge is the commit point.

### CA7. Triggers start with the CLI and GitHub webhooks, behind one ingress design (decided)

Our 12-factor report found one gap: "we have no design for how ticket and approval events reach the agent" ([12-factor report][tf]). W5 writes that design once. Every trigger becomes a task request with a stable id, and the control plane drops a second request with the same id. One event can arrive twice: a redelivered GitHub webhook keeps its `X-GitHub-Delivery` id ([GitHub, webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)), and Durable Object alarms fire at least once ([storage-and-wake note][sw-rules]). The first triggers are a CLI command and a GitHub issue label or comment, accepted only from the owner, with hidden HTML stripped as Copilot does ([portable agents report][pa-cca]). The deferred triage agent will reuse the same ingress.

### CA8. No snapshot cache until W8 measures cold starts (decided, provisional)

Claude Code on the web snapshots its environment after a setup script and rebuilds the snapshot after about seven days ([portable agents report][pa-cca]). We start without one: each task boots the sandbox's base image and clones the repository. W8 and N49 measure how long that takes on each target. W11 writes the snapshot-cache ADR only if those numbers show start time dominating a task.

### CA9. Cloud-mode evals count provisioning time and infra failures apart (decided)

HD8's eval suite runs tasks locally against mini-swe-agent at k = 5 with a $3 cap ([harness plan, HD8][hp-hd8]). A cloud agent adds sandbox start and network faults, which no vendor publishes figures for ([portable agents report][pa-cca]). W8 runs the thirty-task suite (N38's twenty repository tasks and W12's ten coding-agent tasks, per the HD8 amendment) through the deployed agent and reports wall time with provisioning separated out, infra failures apart from task failures, and cost beside pass^k.

### CA10. A read-only cloud secret can back the key ring (accepted)

**Accepted by the owner on 2026-11-18**, with ADR 0035.

HD5 keeps the approval key ring in a file with rotation (ADR 0015). On Cloudflare, AWS and Vercel the key comes from a secret store the harness can read but not write. ADR 0035 makes `KeyStore.rotate()` and `prune()` optional and lets the owner rotate keys through the platform's own secret tooling, which is U11's change 4. The SDK's `ephemeralSigner()` stays the library default, and the SDK docs gain one line: it cannot resume a pause on any serverless host. ADR 0035 supersedes ADR 0015.

## 3. Architecture: the loop in a Durable Object, the sandbox without credentials

```
owner ── CLI / GitHub label ──► Worker (control plane, ingress, dedup)
                                   │
                                   ▼
                     Durable Object per task: our SDK loop + harness
                       SessionStore and SessionLock in DO SQLite
                       Scheduler.wake on DO alarms; signed pauses (HD5)
                                   │
                 egress route ◄────┤  model key and GitHub token added here,
                 (per-host intercept, N50)│  pushes outside refs/heads/agent/* rejected
                                   ▼
                     Cloudflare Sandbox: clone, build, test, edit
                       network limited to the allowlist; no credentials
                                   │
                                   ▼
                     branch agent/<task> ──► draft pull request ──► owner merges
```

- **Control plane (W5).** A Worker accepts task requests, checks the sender, deduplicates by id and starts the task's Durable Object. For one user it needs no queue fairness or runner pool.
- **Task runner (W4).** One Durable Object per task runs a harness session. Model calls are waits on `fetch`, which do not count against Workers' CPU limit; alarms run for at most 15 minutes, so a long turn ends each step with a wake ([portable agents report][pa-rt]).
- **Sandbox (W2, N46b).** The sandbox gets the repository, the built-in tools' commands and an allowlist for package registries. It holds no credential; a route our own proxy runs, or a host-side tool, supplies one. [ADR 0060](../decisions/0060-sandboxes-hold-no-credentials-by-default.md) (2026-11-25) makes no credentials the default for every sandbox backend: a route our own proxy runs keeps the credential on the host, a route that a hosted provider injects is a narrow opt-in, and an action with no such route runs as a host-side tool.
- **Delivery (W6).** The agent commits to `agent/<task-id>`, opens a draft pull request with a summary and a link to the session, and follows up on review comments through the webhook. Base-branch conflicts emit no webhook, so W6 checks for them before each follow-up ([portable agents report][pa-cca]).
- **Side effects.** The agent's only outward writes are git pushes and GitHub API calls. Each runs through [E2](../todos/done/E2-effect-identity-crash-rule.md)'s `guardedWrite()`, which persists an effect record keyed by `effectKey()` before the call, so a replayed wake cannot open a second pull request ([server rollback report][sr]). Opening a pull request uses the business key repository + branch, so a regenerated turn maps to the same effect. *(Revised in plan review 2, 2026-11-19: the owner chose "E2 owns it; W6 uses it", replacing this plan's own key scheme.)*

## 4. Changes to the SDK and harness plans

The owner's three-target decision adopts U11's plan changes 2–11 and 15. Change 1 is unnecessary for one user (CA1). Changes 13 and 14 are this plan and its ingress design (CA7). Change 12, an edit to the harness guide's tier table, stays open for the guide's next revision. The [SDK plan][sdk] and [harness plan][hp] now carry a note listing these changes, and ADRs 0033 and 0035 record each change to an earlier decision.

| U11 change | Lands in | Todo |
| --- | --- | --- |
| 2. workerd smoke test for pi-schema and the MCP client, `@cfworker/json-schema` as fallback | SDK B10, harness N46a | B10, N46a |
| 3. OTel observer with explicit context and `flush()` | SDK B17 | B17 |
| 4. optional `KeyStore.rotate()` and `prune()` | harness HD5, ADR 0035 | N42 |
| 5. `SessionLock` implementations for Durable Objects, DynamoDB and Postgres; dead-pid rule on the same host only | harness HD2, ADR 0033 | N46a, N47a, N48a |
| 6. `Scheduler.wake` | harness §3.2 | N41 |
| 7. stdio over Web streams; WebSocket transport | harness §1, §3.5 | N29 (Web streams), N44 (WebSocket) |
| 8. `SandboxClient.resume(id)`, capability flags, `stops` from the applied policy, policy read-back | harness §3.4 | N43 |
| 9. `EgressPolicy { allow, routes }` compiled per backend; `subnets.allow` banned | harness HD15 | N43, N48b |
| 10. hosted sandbox backends: Cloudflare, E2B, Vercel | harness §1 | N46b, N47b, N48b |
| 11. store adapters under N3's conformance suite | harness N3 | N46a, N47a, N48a |
| 15. hosted-backend measurement and cloud-mode evals | harness N19, this plan | N49, W8 |

Two harness non-goals change. "A WebSocket or HTTP-with-SSE transport" leaves the non-goals, because the coding agent's CLI attaches to a Durable Object over WebSocket (N44). "gVisor, microVM and hosted sandbox backends" now excludes only gVisor and self-run microVMs, because three hosted backends become todos. The rest of the harness plan stands.

## 5. Rounds and todos

### 5.1 Portability todos extend Round N with a stage 8

| Todo | Delivers | Depends on | Size |
| --- | --- | --- | --- |
| [N41](../todos/done/N41-scheduler-wake.md) | `Scheduler.wake` seam and its in-process implementation | N4 | S |
| [N42](../todos/done/N42-read-only-key-store.md) | Optional `rotate()` and `prune()`, and a secret-backed `KeyStore` | N13 | S |
| [N43](../todos/done/N43-remote-sandbox-egress-policy.md) | Remote `SandboxClient` extensions and `EgressPolicy` compiled per backend | N15, N20 | M |
| [N44](../todos/done/N44-web-stream-websocket-transport.md) | A WebSocket transport, and Web-stream cases for the stdio transport | N29 | M |
| [N45](../todos/done/N45-portability-conformance-suite.md) | One conformance suite over the eight seams (`EffectStore` added by ADR 0043); local implementations pass | N41, N42, N43, N44, E7 | M |
| [N46a](../todos/done/N46a-cloudflare-state-adapters.md) | Cloudflare store, lock, scheduler, key store and workerd smoke test | N45 | M |
| [N46b](../todos/ready/N46b-cloudflare-sandbox-backend.md) | Cloudflare Sandbox backend and per-host outbound interception egress, blocked on the owner's ruling after N50 on interception for the opt-in credential route, and for the default too if plain allowlisted HTTPS fails without it ([ADR 0060](../decisions/0060-sandboxes-hold-no-credentials-by-default.md)) | N45, N50 | M |
| [N47a](../todos/done/N47a-aws-state-adapters.md) | DynamoDB store and lock, EventBridge Scheduler wake, Secrets Manager key store | N45 | M |
| [N47b](../todos/done/N47b-e2b-sandbox-backend.md) | E2B backend and egress Secrets | N45 | M |
| [N48a](../todos/done/N48a-vercel-state-adapters.md) | Postgres store and lock, Workflow wake, environment key store | N45 | M |
| [N48b](../todos/done/N48b-vercel-sandbox-backend.md) | Vercel Sandbox backend and firewall `transform` | N45 | M |
| [N49](../todos/ready/N49-hosted-sandbox-measurement.md) | Cold start, snapshot and per-call overhead on the three hosted backends | N46b, N47b, N48b, N19 | S |
| [N50](../todos/done/N50-cloudflare-sandbox-egress.md) | Verify Cloudflare Sandbox 1.0 egress on a real sandbox, and draft an ADR for the owner (added in plan review 2, 2026-11-19) | None | M |

### 5.2 Round W builds the coding agent

| Todo | Delivers | Depends on | Size |
| --- | --- | --- | --- |
| [W1](../todos/ready/W1-coding-agent-scaffold.md) | `@buildanagent/coding-agent` package and its task model | N1 | S |
| [W2](../todos/ready/W2-coding-tool-profile.md) | Git tools, repository checkout and the completion check | N21, N32 | M |
| [W3](../todos/ready/W3-github-app-identity.md) | GitHub App token minting, repository allowlist and the git egress route | N43, W1 | M |
| [W4](../todos/ready/W4-durable-object-task-runner.md) | Task runner on a Durable Object, with wake and resume onto a fresh sandbox | W2, N46a, N46b | M |
| [W5](../todos/ready/W5-control-plane-ingress.md) | Control-plane Worker and the ingress design | W4 | M |
| [W6](../todos/ready/W6-pr-delivery.md) | Draft pull request delivery and review follow-ups, with writes through E2's `guardedWrite()` | W3, W5, E2 | M |
| [W7](../todos/ready/W7-cli-attach.md) | CLI attach over WebSocket | N44, W5 | M |
| [W8](../todos/ready/W8-cloud-mode-evals.md) | Cloud-mode evals against mini-swe-agent | W6, N38, N49, W12 | M |
| [W9](../todos/ready/W9-deploy-aws.md) | The coding agent on AWS | W8, N47a, N47b | M |
| [W10](../todos/ready/W10-deploy-vercel.md) | The coding agent on Vercel | W8, N48a, N48b | M |
| [W11](../todos/ready/W11-snapshot-cache.md) | Snapshot-cache ADR and, if W8's numbers justify it, the cache | W8 | M |
| [W12](../todos/ready/W12-coding-agent-eval-tasks.md) | Ten coding-agent eval tasks that bring the seed suite to thirty (HD8, amended 2026-11-19) | N38, W2 | M |

## 6. Every test runs offline, and the end-to-end test proves the sandbox never sees a credential

Every test runs offline on the SDK's scripted model, as in the harness plan, and no mock model calls a tool that touches the host ([harness plan §5.1][hp-51]). The conformance suite (N45) runs against local fakes in `pnpm test` and against each cloud's emulator or a recorded HTTP exchange where one exists; live cloud runs are opt-in and never part of CI. The coding agent's end-to-end test drives a fake GitHub (webhook in, pull request out) and the harness's `fakeSandbox()`, an in-memory file system with a recorded `exec`, and asserts three things: no credential string appears in the sandbox's environment or output, a push to `main` is rejected by the egress route, and a replayed webhook opens one pull request, not two.

## 7. Four risks each have a todo that settles them, and Round W starts after the portability stage

Four risks remain, and each has a todo that settles it:
1. **Cloudflare Sandbox cold starts are unmeasured.** N49 measures them; E2B is the swap behind `SandboxClient` (CA3).
2. **pi-schema and the MCP client may not load in workerd.** B10 and N46a test them, with `@cfworker/json-schema` as the fallback ([portable agents report][pa-sdk]).
3. **Pinned sandbox SDKs move fast.** `e2b` 2.64.0 and `@vercel/sandbox` 4.0.0 were under a week old on 2026-11-18, so N47b and N48b pin the previous releases, 2.63.0 and 3.9.1, under the one-week rule ([portable agents report][pa-sbx]).
4. **The git route must parse pushes correctly.** W3 tests it against real `git push` traffic recorded offline, and the default-branch ruleset stays as the second layer (CA5).

Round W starts after the harness's stage 7 and the portability stage: W1 needs only N1, but W4 needs the Cloudflare adapters. The roadmap's M7 becomes "Our coding agent" (W1–W12, with W12 added in plan review 2), and the triage round moves to a deferred milestone. As of 2026-11-19, B1–B3 are done, Rounds B, N and E are being built, and Round W stays on hold until the owner says go; the first new harness todo this plan adds, N41, opens once N4 is done.

[sdk]: build-sdk.md
[sdk-32]: build-sdk.md#32-gateway-api
[hp]: build-harness.md
[hp-hd8]: build-harness.md#hd8-a-30-task-seed-suite-of-20-repository-and-10-coding-agent-tasks-at-k--5-accepted-amended
[hp-51]: build-harness.md#51-every-test-runs-offline-on-the-sdks-scripted-model-and-no-test-touches-the-host
[pa]: ../research/deployment/portable-agents.md
[pa-rt]: ../research/deployment/portable-agents.md#runtimes-split-into-an-isolate-tier-and-a-process-tier
[pa-sdk]: ../research/deployment/portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places
[pa-cca]: ../research/deployment/portable-agents.md#cloud-coding-agents-are-a-control-plane-around-a-disposable-vm
[pa-sbx]: ../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first
[sw]: ../research/deployment/storage-and-wake.md
[sw-rules]: ../research/deployment/storage-and-wake.md#three-rules-come-with-the-seams
[abp]: ../research/deployment/agent-building-platforms.md
[abp-win]: ../research/deployment/agent-building-platforms.md#where-a-new-platform-could-win-what-it-must-match-and-the-first-slice
[cdr]: ../research/agent-ui/copilot-diff-review.md
[cdr-cloud]: ../research/agent-ui/copilot-diff-review.md#visual-studio-and-jetbrains-review-after-the-write-the-cloud-agent-reviews-before-the-merge
[tf]: ../research/external-designs/twelve-factor-agents.md#five-small-changes-follow-led-by-an-ingress-design
[sr]: ../research/reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped
