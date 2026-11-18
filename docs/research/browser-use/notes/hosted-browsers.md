# Hosted (cloud) browsers for AI agents, as of November 2026

Research notes, gathered 2026-11-18. All prices, versions and limits are "as of November 2026". Sources are vendor docs, pricing pages and the npm registry unless a line is marked **[secondary]**. Most vendor docs were read through their `llms-full.txt` exports (Cloudflare `developers.cloudflare.com/browser-run/llms-full.txt`, `docs.browserbase.com/llms-full.txt`, `docs.steel.dev/llms-full.txt`, `docs.browserless.io/llms-full.txt`, `docs.hyperbrowser.ai/llms-full.txt`, `www.kernel.sh/docs/llms-full.txt`, `docs.anchorbrowser.io/llms-full.txt`, `docs.browser-use.com/llms-full.txt`, `e2b.dev/docs/llms-full.txt`, `vercel.com/docs/llms-full.txt`). The URL given for each claim is the page that the export attributes it to.

## Per-service comparison: how each hosted browser connects, scales, persists, and costs

### Takeaway
Every serious option now exposes a raw CDP WebSocket. So the agent loop can run outside the browser on Workers, Lambda or Vercel Functions and connect in, and none of them needs our model credentials inside the browser. Cloudflare Browser Run (renamed from Browser Rendering) is the cheapest per hour and fits our Durable Object loop natively. Its trade-offs: no saved-profile product, no IP rotation and no stealth or CAPTCHA solving, plus a 20-minute idle ceiling. Browserbase, Steel, Kernel and Anchor add encrypted profiles or contexts, stealth, proxies and vault-style credential fill.

### Cited Findings

#### Cloudflare Browser Run (formerly Browser Rendering): our first target

The product and its packages:
- **Rename:** The product is now called **Browser Run**. The docs say "Browser Run, formerly known as Browser Rendering". Docs moved to `developers.cloudflare.com/browser-run/`, and the REST and CDP base path is now `/accounts/{account_id}/browser-run/...`. — [Browser Run overview](https://developers.cloudflare.com/browser-run/); [Limits (429 example URL)](https://developers.cloudflare.com/browser-run/limits/)
- **npm versions:** `@cloudflare/puppeteer` **2.0.1** (published 2026-11-16), `@cloudflare/playwright` **1.4.0** (2026-11-10), `@cloudflare/playwright-mcp` **0.0.6** (2026-11-11), `agents` **0.33.0** (2026-11-03). — [npm registry](https://registry.npmjs.org/@cloudflare/puppeteer), [npm](https://registry.npmjs.org/@cloudflare/playwright), [npm](https://registry.npmjs.org/@cloudflare/playwright-mcp), [npm](https://registry.npmjs.org/agents)
- **Protocol history:** `@cloudflare/puppeteer` 1.1.0 (2026-04-13) and `@cloudflare/playwright` 1.3.0 (2026-04-15) replaced the old internal "chunked protocol" with plain CDP. `@cloudflare/playwright` 1.2.0 tracked Playwright v1.58.2. — [Changelog](https://developers.cloudflare.com/browser-run/changelog/)
- **Browser version:** The default browser is **Chrome 152** (2026-10-30). Quick Actions now send a Chrome 152 User-Agent, and their requests "look more like requests from a regular Chrome browser, so fewer sites block them". — [Changelog](https://developers.cloudflare.com/browser-run/changelog/)

Ways to connect:
- **Quick Actions (stateless REST):** `/content`, `/screenshot`, `/pdf`, `/markdown`, `/snapshot` (with a `formats` parameter, 2026-06-11), `/scrape`, `/json` (AI extraction through Workers AI or `custom_ai`), `/links`, `/crawl` (beta, async), and `/accessibilityTree` (2026-07-07). Since 2026-05-28 a Worker can call them through `env.BROWSER.quickAction()` with no API token. — [Overview](https://developers.cloudflare.com/browser-run/); [Changelog](https://developers.cloudflare.com/browser-run/changelog/)
- **Browser Sessions:** Puppeteer, Playwright, CDP or Stagehand drive the browser. A Worker uses the `browser` binding. Any environment can use CDP: `wss://api.cloudflare.com/client/v4/accounts/{account_id}/browser-run/devtools/browser` with an `Authorization: Bearer` API token that holds `Browser Rendering - Edit`. Reconnect at `.../devtools/browser/{session_id}`. The HTTP lifecycle endpoints are `POST /devtools/browser`, `GET .../json/list`, `PUT .../json/new`, `DELETE .../json/close/{target}` and `DELETE /devtools/browser/{id}`. Puppeteer and Playwright `connectOverCDP` from Node work too. CDP endpoints arrived 2026-04-10. — [CDP](https://developers.cloudflare.com/browser-run/cdp/); [Session management (HTTP)](https://developers.cloudflare.com/browser-run/cdp/session-management/); [Changelog](https://developers.cloudflare.com/browser-run/changelog/)
- **CDP query parameters:** `keep_alive` (10,000–1,200,000 ms, default 60,000), `lab` (experimental Chrome pool), `recording`, `browser=kitesurf`. The `cf-brapi-guardrails` header carries `allowedDomains`. — [CDP](https://developers.cloudflare.com/browser-run/cdp/)
- **Typed binding API (2026-09-21):** `acquire()`, `connectSession()`, `launch()`, `getLiveView()`, `listSessions()`, `history()`, `limits()`, `getSession()`, `closeSession()`, plus a nested `devtools` object for targets. — [Browser binding API](https://developers.cloudflare.com/browser-run/reference/browser-binding-api/)
- **MCP:** The `@cloudflare/playwright-mcp` fork deploys as a Worker with Browser Run and Durable Object bindings, and it works from the accessibility tree rather than screenshots. Its page says v0.0.6 "is in sync with upstream Playwright MCP v0.0.30". That is the same upstream version the July 2025 changelog cited, so the statement may be stale (see Gaps). There is also a documented "CDP with MCP clients" path. — [Playwright MCP](https://developers.cloudflare.com/browser-run/playwright/playwright-mcp/); [Changelog](https://developers.cloudflare.com/browser-run/changelog/); [MCP clients](https://developers.cloudflare.com/browser-run/cdp/mcp-clients/)
- **Agents SDK integration (`agents@0.33.0`):** `agents/browser` exports `Browser` with the `browserRun(env.BROWSER)` provider. You install it on a Durable Object's `Lifecycle`, which stores the browser's record and keeps it across hibernation. `browserTool` (versions for pi, TanStack AI and the AI SDK) gives the model "one browser that stays open between turns, so tabs, cookies, and logins carry over". The model writes CDP code that runs in Dynamic Workers from a `worker_loaders` binding. "Only Chromium on Browser Run is supported." `createBrowserTools`, `createBrowserRuntime` and the Quick Actions helpers are deprecated. Think's code mode exposes `cdp.*` when a browser binding is bound. — [agents docs: Browse the Web (mirror at tag agents@0.33.0)](https://github.com/cloudflare/agents/blob/agents%400.33.0/docs/agents/browse-the-web.md), local copy `docs/reference/cloudflare-agents/source/agents/docs/agents/browse-the-web.md`; [Think tools](https://github.com/cloudflare/agents/blob/agents%400.33.0/docs/think/tools.md)
- **Durable Object pattern:** Cloudflare recommends keeping a browser in a Durable Object to avoid cold starts and cut concurrency. — [Browser Run with Durable Objects](https://developers.cloudflare.com/browser-run/how-to/browser-run-with-do/); [Reuse sessions](https://developers.cloudflare.com/browser-run/features/reuse-sessions/)

Limits:
- **Workers Free:** 10 minutes of browser time a day, 3 concurrent browsers, 1 new browser every 20 s, and Quick Actions at 1 request every 10 s. — [Limits](https://developers.cloudflare.com/browser-run/limits/)
- **Workers Paid:** Browser hours are unlimited (billed), with **200 concurrent browsers per account** and **3 new browsers per second**. Quick Actions run at 30 requests per second. Higher limits are available on request. — [Limits (updated Oct 14, 2026)](https://developers.cloudflare.com/browser-run/limits/). This conflicts with the 2026-04-15 changelog entry ("120 per account", "1 per second"). The limits page is newer. — [Changelog](https://developers.cloudflare.com/browser-run/changelog/)
- **Session duration:** There is "no fixed maximum lifetime" while the session is active. The idle timeout defaults to 60 s and goes up to 20 minutes with `keep_alive`. Sessions also close when Browser Run rolls out a new release. Dashboard-created sessions default to a 5-minute idle timeout. — [Limits FAQ](https://developers.cloudflare.com/browser-run/limits/); [Live View](https://developers.cloudflare.com/browser-run/features/live-view/)

Pricing:
- **Workers Free:** 10 minutes a day and 3 concurrent browsers. — [Pricing](https://developers.cloudflare.com/browser-run/pricing/)
- **Workers Paid:** **10 browser hours a month included, then $0.09 per hour.** For Browser Sessions only, **10 concurrent browsers are included (monthly average of daily peaks), then $2.00 per extra browser**. Quick Actions are billed on browser hours only. Monthly time rounds to the nearest hour. A Quick Action that fails with `waitForTimeout` is not charged. Billing went live on 2025-08-20. — [Pricing](https://developers.cloudflare.com/browser-run/pricing/); [Changelog](https://developers.cloudflare.com/browser-run/changelog/)

Live view, human takeover and recording:
- **Live View (2026-04-15):** Opens from the dashboard's "Live Sessions" tab, from a generated `devtoolsFrontendUrl` on `live.browser.run` (modes `tab`, `full`, `devtools`), or in native Chrome DevTools. The URL must be used within 5 minutes by default; `expiresInMs` raises this to 1 hour. — [Live View](https://developers.cloudflare.com/browser-run/features/live-view/)
- **Human in the Loop:** The script calls the CDP command `Cloudflare.getLiveView`, then `Cloudflare.handoff` with instructions for the operator, and waits for the `Cloudflare.handoffComplete` event. The operator marks the handoff "Done" or "Failed". The docs list MFA, CAPTCHA and "sensitive credentials you do not want to pass to an automation script" as use cases. — [Human in the Loop](https://developers.cloudflare.com/browser-run/features/human-in-the-loop/)
- **Session recording (beta):** Recordings are rrweb JSON events (DOM, mouse, keyboard, navigation), not video. You enable them at acquisition with `recording: true`, and they are "retained for 30 days after the session ends and automatically deleted". — [Session recording](https://developers.cloudflare.com/browser-run/features/session-recording/)

Network controls:
- **Outbound Workers:** `outboundByHost` sends the browser's requests for chosen hostnames through another Worker, which "can reach a private service, add authentication, or transform the response". Updated 2026-11-10. — [Outbound Workers](https://developers.cloudflare.com/browser-run/features/outbound-workers/)
- **Guardrails:** Per-session hostname allowlists (`allowedDomains`, `allowedDomainSets`) for Puppeteer, Playwright and CDP sessions. They do not apply to Quick Actions. — [Guardrails](https://developers.cloudflare.com/browser-run/features/guardrails/)

Stealth, IPs and bot detection:
- Browser Run "does not bypass CAPTCHAs, Turnstile challenges, or any other bot protection mechanisms". — [Browser Run docs (crawl endpoint)](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/)
- There is no IP rotation: traffic comes from Cloudflare IP ranges with automatic headers. — [FAQ](https://developers.cloudflare.com/browser-run/faq/)
- Cloudflare always identifies Browser Run as bot traffic, and requests carry Web Bot Auth signatures (since 2025-06-30). — [FAQ](https://developers.cloudflare.com/browser-run/faq/); [Changelog](https://developers.cloudflare.com/browser-run/changelog/)

Isolation and data retention:
- **Isolation:** The docs recommend incognito contexts to isolate tasks within one browser. They do not describe a per-session VM. — [FAQ](https://developers.cloudflare.com/browser-run/faq/)
- **Retention:** For Puppeteer, Playwright and CDP, "no caching is used" and content stays in memory for the operation only. Quick Actions cache output for 5 s by default (`cacheTTL` goes up to 1 day). `/crawl` results stay in R2 for 14 days. — [FAQ](https://developers.cloudflare.com/browser-run/faq/)

Region and Kitesurf:
- **Region:** Sessions "run on Cloudflare's edge network, opening close to your users". The docs offer no region pinning. — [Overview](https://developers.cloudflare.com/browser-run/)
- **Kitesurf (beta, free behind limits):** A lightweight, stateless browser built on Workers, selected with `browser=kitesurf`. It cannot play video or WebGL, cannot "negotiate a bot-challenge handshake with real TLS fingerprints", and cannot run "a long-running, authenticated session that requires persistent state". — [Kitesurf](https://developers.cloudflare.com/browser-run/kitesurf/)

#### Browserbase
- **Pricing:**

  | Plan | Monthly fee | Concurrent browsers | Browser hours included | Overage | Extras |
  | --- | --- | --- | --- | --- | --- |
  | Free | $0 | 3 | 1 | n/a | 15-minute sessions |
  | Developer | $20 | 25 | 100 | $0.12/h | 1 GB proxies, then $12/GB; auto CAPTCHA solving |
  | Startup | $99 | 100 | 500 | $0.10/h | 5 GB proxies, then $10/GB |
  | Scale | custom | 250+ | 500+ | usage-based | |

  — [Browserbase pricing](https://www.browserbase.com/pricing)
- **Session length:** Sessions last up to **6 hours** (`api_timeout` in the SDK, `timeout` over HTTP). Keep-alive sessions survive disconnects. — [Timeouts](https://docs.browserbase.com/platform/browser/long-sessions/timeouts); [Keep alive](https://docs.browserbase.com/platform/browser/long-sessions/keep-alive)
- **Regions:** `us-west-2`, `eu-central-1` and `ap-southeast-1` are shown, chosen with `region` at session creation. — [Browser regions](https://docs.browserbase.com/optimizations/latency/multi-region)
- **Isolation:** "1 browser per VM", isolated subnets, "after each session, the virtual machine is killed and recreated", no GPU access. SOC 2 Type II and HIPAA. — [Enterprise security](https://docs.browserbase.com/account/enterprise/security)
- **Contexts:** A context persists the Chromium user data directory (cookies, localStorage, IndexedDB, service workers, form data, preferences, but not the HTTP cache). Contexts "are uniquely encrypted at rest". Pass `persist: true` to save changes when the session closes. — [Contexts](https://docs.browserbase.com/platform/browser/core-features/contexts)
- **Live View and replay:** Live View is interactive ("watch, click, type, and scroll") and embeddable, from `sessions.debug()` → `debuggerFullscreenUrl`. Every session is recorded as video by default, served as HLS or MP4. `logSession` and `recordSession` can be set to `false` on any plan. Zero Data Retention (ZDR) and Bring Your Own Storage (BYOS, the customer's own S3) are Enterprise-only. — [Live view](https://docs.browserbase.com/platform/browser/observability/session-live-view); [Session replay](https://docs.browserbase.com/platform/browser/observability/session-replay); [ZDR](https://docs.browserbase.com/account/enterprise/zero-data-retention)
- **Identity:** The Identity features are "Verified" (a purpose-built Chromium with real fingerprints), Web Bot Auth, CAPTCHA solving, residential and datacenter proxies, and 1Password integration (service account or "Agentic Autofill"). — [Agent Identity](https://docs.browserbase.com/platform/identity/overview); [1Password](https://docs.browserbase.com/integrations/1password/introduction)
- **Secrets:** Values are sealed client-side with HPKE (X25519, HKDF-SHA256, AES-256-GCM), then encrypted again with AWS KMS. Functions read them from `context.secrets`. — [Secrets](https://docs.browserbase.com/platform/secrets/getting-started)
- **npm versions:** `@browserbasehq/sdk` 2.28.0 (2026-11-17), `@browserbasehq/stagehand` 4.4.0 (2026-11-04). — [npm](https://registry.npmjs.org/@browserbasehq/sdk), [npm](https://registry.npmjs.org/@browserbasehq/stagehand)
- **Through Vercel:** Vercel's AI Gateway exposes `browserbaseFetch` and `browserbaseSearch` tools; a plain `raw` fetch costs $1 per 1,000. — [Vercel docs (AI Gateway tools)](https://vercel.com/docs/llms-full.txt)
- **Not covered:** Director was not covered in the docs export I searched (see Gaps).

#### Steel (steel.dev; open-source steel-browser)
- **Open source:** steel-browser "runs one Chrome browser behind a REST API, on a machine that you control", under Apache 2.0. — [Steel docs](https://docs.steel.dev/llms-full.txt); repo [steel-dev/steel-browser](https://github.com/steel-dev/steel-browser)
- **Pricing:**

  | Plan | Monthly fee | Credits | Concurrent sessions | Max session | Browser hours | Proxy | CAPTCHA | Data retention |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Launch | $0 | $30 once | 10 | 15 min | $0.10/h | $10/GB | $3 per 1k | 7 days |
  | Scale | $250 | $100 a month | 100 | 1 h | $0.08/h | $6/GB | $1 per 1k | 14 days |
  | Enterprise | custom | custom | 1,000+ | 24 h | custom | custom | custom | custom |

  Scale adds dedicated IPs at $5 each and a HIPAA BAA. The stealth browser is Enterprise-only. — [Steel pricing](https://steel.dev/pricing)
- **Connection and isolation:** Sessions connect at `wss://connect.steel.dev`, and the connection URL holds a session token. Each session is its own browser with its own cookies, storage and proxy. Hosting is in US servers. Stored credentials are encrypted with AES-256-GCM. Recordings are on by default. — [Security and compliance](https://steel.dev/docs/platform/security-and-compliance)
- **Profiles:** Set `persistProfile: true`. Steel saves the whole browser (cookies, storage, extensions, settings, user agent) after release; status goes `UPLOADING` → `READY`. Load it later with `profileId`. — [Profiles](https://steel.dev/docs/logins/profiles)
- **Credentials API (beta):** Steel stores a login per origin (`username`, `password`, `totpSecret`) and fills the sign-in form. "Steel never returns the stored password, so your agent and your model never need it." — [Credentials API](https://steel.dev/docs/reference/api/credentials); [Credentials](https://steel.dev/docs/logins/credentials)
- **Lifecycle:** States are `live`, `released` and `failed`. A released session never returns to `live`. Sessions have `timeout` and `inactivityTimeout`. — [Session lifecycle](https://steel.dev/docs/sessions/lifecycle)
- **Live view and MCP:** An embeddable live view (`debugUrl`, interactive or view-only) and an MCP server. — [Embed a live browser](https://steel.dev/docs/observability/embed-a-live-browser); [MCP server](https://steel.dev/docs/control/mcp-server.md)
- **npm version:** `steel-sdk` 0.23.0 (2026-11-10). — [npm](https://registry.npmjs.org/steel-sdk)

#### Browserless
- **Pricing (billed annually):**

  | Plan | Monthly fee | Units a month | Browser time | Concurrent browsers | Max session | Persisted sessions and replays | Overage |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Free | $0 | 1k | 8 h | 2 | 2 min | 1 day | n/a |
  | Prototyping | $25 | 20k | 165 h | 10 | 15 min | 7 days | $0.0020/unit |
  | Starter | $140 | 180k | 1,500 h | 40 | 30 min | 30 days | $0.0017/unit |
  | Scale | $350 | 500k | 4,150 h | 100 | 60 min | 90 days | $0.0015/unit |

  Every plan includes BrowserQL, session reconnects, residential proxies (6 units/MB), datacenter proxies (2 units/MB), automatic CAPTCHA solving, endpoints in San Francisco, London and Amsterdam, and Chrome, WebKit and Firefox. — [Browserless pricing](https://www.browserless.io/pricing)
- **Connection:** `wss://production-sfo.browserless.io?token=...`, with `/stealth` and `externalProxyServer` variants. BrowserQL `reconnect(timeout: 30000) { browserWSEndpoint }` hands out a reconnect URL. A `liveURL` serves human handoff. Persisted sessions expire by plan TTL ("up to 90 days"). — [Browserless docs](https://docs.browserless.io/llms-full.txt)
- **MCP:** There is an MCP server product. — [Browserless pricing nav](https://www.browserless.io/pricing)
- **Self-hosting:** A "Self-Hosted" product exists. — [Browserless pricing nav](https://www.browserless.io/pricing). Its license terms were not found (see Gaps).

#### Hyperbrowser
- **Pricing:** 1,000 credits = $1. Browser time costs **$0.10/h** and proxy data $10/GB.

  | Plan | Monthly fee | Included | Concurrent sessions | Data retention | Stealth |
  | --- | --- | --- | --- | --- | --- |
  | Free | $0 | 5,000 credits | 1 | 7 days | n/a |
  | Startup | $30 | $30 of usage | 25 | 30 days | basic |
  | Scale | $100 | $100 of usage | 100 | 30 days | basic |
  | Enterprise | custom | custom | 1,000+ | 180+ days | ultra |

  CAPTCHA solving is included on paid plans. Sandboxes cost $0.045 per vCPU-hour and $0.015 per GiB-hour. HyperAgent and Browser Use steps cost $0.02 each. — [Hyperbrowser pricing](https://www.hyperbrowser.ai/pricing)
- **Features:** Profiles persist with `profile: {id, persist_changes: true}`. Sessions return a `liveUrl`. Regions `us-west` and `europe-west` appear in the docs. One documented API says "values below 5 or above 60 are not supported" for `timeoutMinutes`; which resource that applies to is unclear. — [Hyperbrowser docs](https://docs.hyperbrowser.ai/llms-full.txt)
- **npm version:** `@hyperbrowser/sdk` 1.5.4 (2026-11-17). — [npm](https://registry.npmjs.org/@hyperbrowser/sdk)

#### Kernel (kernel.sh, formerly onkernel)
- **Pricing:**

  | Plan | Monthly fee | Credits a month | Concurrent browsers | Replays kept | Other |
  | --- | --- | --- | --- | --- | --- |
  | Free | $0 | $5 | 5 | 1 day | stealth (CAPTCHA solver and residential proxy), 3 managed-auth connections |
  | Hobbyist | $30 | $10 | 10 | 7 days | |
  | Start-up | $200 | $50 | 150 | 30 days | bring-your-own proxies, GPU, regional browsers |

  Usage costs "$0.0000166667 per GB-second (no charges for idle time or proxies)". — [Kernel pricing](https://www.kernel.sh/pricing)
- **Isolation:** Each Chromium browser "runs in its own vm", on unikernels: "the unikernel is the entire system for that session". Browsers are driven through CDP, WebDriver BiDi or computer controls. — [Kernel docs](https://www.kernel.sh/docs/llms-full.txt)
- **Timeout:** The maximum is **72 hours of no CDP activity** (raised from 24 hours), and browsers enter standby between connections. — [Kernel docs changelog](https://www.kernel.sh/docs/llms-full.txt)
- **Live view and replays:** `browser_live_view_url` and MP4 replays. — [Kernel docs](https://www.kernel.sh/docs/llms-full.txt)
- **Profiles:** A save "replaces the profile's complete stored browser state" with no merge across concurrent writers. — [Kernel docs: profiles](https://www.kernel.sh/docs/llms-full.txt)
- **Managed Auth and Vaults:** Credentials "are encrypted at rest and never exposed in API responses or passed to LLMs". — [Kernel docs: managed auth](https://www.kernel.sh/docs/llms-full.txt)
- **Security incident (notice dated 2026-11-04):** An attacker used a compromised Kernel API key (from 2026-10-24) and then entered a staff login at Kernel's logging provider (2026-10-27), downloading data that included some API keys and some third-party secrets of app deployments. A compromised hosting-provider credential gave access to four GPU servers, three of which ran browser sessions, and a cryptominer was started. "The breach impacted 0.28% of Kernel's customers." — [Kernel incident notice](https://www.kernel.sh/blog/public-notice-of-security-incident-nov-4-2026). The summary I received put detection on Nov 2 and server access on Nov 3, so the order needs a recheck (see Gaps).
- **npm version:** `@onkernel/sdk` 0.149.0 (2026-11-17). — [npm](https://registry.npmjs.org/@onkernel/sdk)

#### Anchor Browser
- **Isolation:** Anchor creates "a dedicated, isolated virtual machine (VM) for each browser instance", which is "permanently terminated and erased upon session completion". — [Anchor docs](https://docs.anchorbrowser.io/llms-full.txt)
- **Session features:** Sessions return `cdp_url` and `live_view_url` (`live.anchorbrowser.io`). Profiles persist with `profile: {name, persist: true}`. Timeouts are set with `timeout.max_duration` and `timeout.idle_timeout`, in minutes. — [Anchor docs](https://docs.anchorbrowser.io/llms-full.txt)
- **Secrets with computer-use models:** For Anthropic, OpenAI and Gemini computer-use models, "Secrets are never exposed to the AI model." — [Anchor docs](https://docs.anchorbrowser.io/llms-full.txt)
- **Pricing (from the docs):** $0.01 per browser, **$0.05 per browser hour**, $0.01–$0.10 per AI step, and $0.10 per task run. Egress is $0.2/GB with your own proxy or none. — [Anchor docs (pricing section)](https://docs.anchorbrowser.io/llms-full.txt). The pricing-page fetch returned the marketing homepage, which mentions "Mac sessions are now GA", "Bring your own cloud" and Web Bot Auth. — [anchorbrowser.io](https://anchorbrowser.io/pricing)
- **npm version:** `anchorbrowser` 1.0.0 (2026-07-26). — [npm](https://registry.npmjs.org/anchorbrowser)

#### Browser Use Cloud
- **Pricing:** Pay as you go with no subscription. **$0.06 per browser hour**, home-IP proxy $5/GB (or $0.20/GB with no proxy), and CAPTCHA solving and stealth included. Concurrency unlocks by total amount paid: 10 at once to start, then 50 at $100, 250 at $1k, 500 at $5k and 1,000 at $25k. The browser harness is MIT. — [Browser Use pricing](https://browser-use.com/pricing)
- **Connection and profiles:** Sessions give a `cdpUrl`. Adding `&profileId=` loads a saved profile, and profile sync copies cookies from a local browser to a cloud profile "so no password goes into the prompt". The docs warn that "the credential-bearing CDP URL" can leak through transport errors. Sessions return a `liveUrl`. — [Browser Use docs](https://docs.browser-use.com/llms-full.txt)
- **Credential masking:** The OSS agent's `sensitive_data` and `type_secret` features list secret names, not values, in the prompt. — [Browser Use docs](https://docs.browser-use.com/llms-full.txt)
- **npm version:** `browser-use-sdk` 3.12.1 (2026-10-17). — [npm](https://registry.npmjs.org/browser-use-sdk)

#### AWS Bedrock AgentCore Browser
- **Connection:** You create a Browser Tool, either the managed `aws.browser.v1` or a custom browser with recording, network settings and an IAM role. You drive it through "WebSocket-based streaming APIs": an Automation endpoint (Playwright, Strands or Nova Act) and a Live View endpoint that lets a user "interact with it directly". — [AgentCore Browser](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-tool.html)
- **Timeouts and isolation:** Session timeout defaults to 15 minutes, maximum **8 hours**. AWS calls the environment "containerized", with ephemeral sessions that reset after each use. — [AgentCore Browser](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-tool.html)
- **Recording:** Custom browsers only; recordings go to *your* S3 bucket. — [AgentCore Browser](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-tool.html)
- **Features:** Web Bot Auth (CAPTCHA reduction), extensions, profiles, proxies, enterprise policies, custom root CAs, and "Browser OS action". — [Features](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-features.html)
- **Profiles:** A profile saves cookies and local storage through `SaveBrowserSessionProfile`. A save overwrites the previous data, and changes apply only to new sessions. Access is controlled through IAM. — [Browser profiles](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-profiles.html)
- **Pricing:** **$0.0895 per vCPU-hour** and **$0.00945 per GB-hour**. "I/O wait and idle time is free". Billing is per second (1-second minimum, 128 MB memory minimum). Profile storage is billed at S3 Standard rates "starting April 15, 2026". Data transfer is billed at EC2 rates. — [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/)
- **Regions:** "AgentCore Built-in Tools" are listed in all 22 regions in the table, including us-east-1/2, us-west-1/2, five EU regions, eight APAC regions, Canada, São Paulo and GovCloud (US-West). — [Supported Regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html)
- **SDK versions:** `@aws-sdk/client-bedrock-agentcore` 3.1172.0 (2026-11-18), `bedrock-agentcore` (npm) 0.4.7 (2026-11-10). — [npm](https://registry.npmjs.org/@aws-sdk/client-bedrock-agentcore), [npm](https://registry.npmjs.org/bedrock-agentcore)

#### Vercel
- **No first-party browser product found.** Vercel's docs show how to run headless Chromium in a Function: `puppeteer-core` plus `@sparticuz/chromium` (whose docs recommend "1,600 MB or more" of memory) or `@sparticuz/chromium-min`. The full `puppeteer` Chrome download is about 280 MB, above the 250 MB bundle limit unless you enable "large functions" (beta, up to 5 GB). — [Vercel Functions limitations](https://vercel.com/docs/functions/limitations)
- **Vercel Sandbox pricing (iad1):**

  | Item | Hobby (included) | Pro rate |
  | --- | --- | --- |
  | Active CPU | 5 h/month | $0.128/h |
  | Provisioned memory | 420 GB-h/month | $0.0212/GB-h |
  | Creations | 5,000/month | $0.60 per 1M |
  | Concurrent sandboxes | 10 | 10,000 |
  | Max session | 45 min | 24 h |

  Snapshots cost $0.08/GB-month. — [Vercel Sandbox pricing](https://vercel.com/docs/sandbox/pricing)
- **npm version:** `@vercel/sandbox` 4.0.0 (2026-11-12). — [npm](https://registry.npmjs.org/@vercel/sandbox)
- **Community guides [secondary]:** Guides run `vercel-labs/agent-browser` with Chromium inside Vercel Sandbox, a Firecracker microVM. They report about 30 s cold installs and sub-second starts from a snapshot. I could not confirm this against an official Vercel page. — [skills.sh listing](https://skills.sh/vercel/vercel-plugin/vercel-sandbox) **[secondary]**
- **AI Gateway:** Exposes Browserbase Fetch and Search as tools (see Browserbase). — [Vercel docs](https://vercel.com/docs/llms-full.txt)

#### Vision "computer" sandboxes
- **E2B Desktop:** `@e2b/desktop` 2.5.0 (2026-10-13). "Every sandbox is a Firecracker microVM", streamed over noVNC with `desktop.stream.getUrl({ authKey, viewOnly })`. Sandboxes can pause and resume (`lifecycle: {on_timeout: "pause"}`). — [npm](https://registry.npmjs.org/@e2b/desktop); [E2B docs](https://e2b.dev/docs/llms-full.txt)
- **E2B pricing:**

  | Plan | Monthly fee | Credit | Max session | Concurrent sandboxes |
  | --- | --- | --- | --- | --- |
  | Hobby | free | $100 one-time | 1 h | 10 |
  | Pro | $150 | n/a | 24 h | 100 (1,100 with add-ons) |

  Per-second rates are $0.000014 per vCPU-second (2 vCPU default = $0.000028/s) and $0.0000045 per GiB-second. Enterprise starts at $2,000 a month. — [E2B pricing](https://e2b.dev/pricing)
- **Daytona:** Computer Use for Linux, with Windows and macOS by request. It starts Xvfb, xfce4, x11vnc and noVNC, and gives mouse, keyboard and screenshot APIs plus dashboard VNC access. An OpenAI cookbook uses image `daytonaio/sandbox:0.6.0`. — [Daytona Computer Use](https://www.daytona.io/docs/en/computer-use); [OpenAI cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/computer_use_with_daytona/computer_use_with_daytona) (via search summary **[secondary]**)
- **Cua:** The open-source parts (Lume, Agent SDK, Cua-Bench) are MIT. Pro "from $10" a month with credits, according to aggregator and search summaries. — [cua.ai/llms.txt](https://cua.ai/llms.txt) **[secondary, via search summary]**; [rl-list](https://www.rl-list.com/vendors/cua) **[secondary]**
- **Scrapybara:** Has pivoted: "We started by building computers for agents. Now we build Capy." — [scrapybara.com](https://www.scrapybara.com)

#### Self-hosting Chromium in our own sandbox
- **Cloudflare Containers:** Instance types include `basic` (1 GiB), `standard-1` (4 GiB), `standard-2` (6 GiB) and `standard-3` (8 GiB); `lite` also exists. Billing is per 10 ms active, with 25 GiB-hours of memory included on Workers Paid, then $0.0000025 per GiB-second. — [Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/); [Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- **SDK version:** `@cloudflare/sandbox` 1.0.3 (2026-10-22). — [npm](https://registry.npmjs.org/@cloudflare/sandbox)
- **Memory need:** The `@sparticuz/chromium` guidance, as cited by Vercel, is 1,600 MB or more. — [Vercel Functions limitations](https://vercel.com/docs/functions/limitations)
- **Tab pressure:** Cloudflare warns that tabs in one browser share process memory and that heavy pages can crash it. — [Browser Run FAQ](https://developers.cloudflare.com/browser-run/faq/)

### Inferences
- Browser Run's 20-minute idle cap and its "sessions close when Browser Run rolls out a new release" rule mean the agent must survive losing its browser. Keep auth state (cookies or `storageState`) in Durable Object storage and re-inject it, rather than relying on a live browser. The Agents SDK `Browser` stores only the browser's *record* across hibernation; the browser itself can still close.
- Browser Run has no stealth, no IP rotation and no CAPTCHA solving, and it is always flagged as bot traffic. That is fine for our own sites and API-less dashboards. Hostile consumer sites will need Browserbase, Steel, Kernel or Browser Use, or a human handoff.
- Per-session VM isolation is documented by Browserbase, Kernel, Anchor, E2B and Daytona (VM or microVM), and as "containerized" for AgentCore. Cloudflare does not document its per-session boundary beyond incognito contexts. That matters for the multi-user platform ([ADR 0042](../../../decisions/0042-generated-code-isolation.md)).
- Kernel's November 2026 incident touched browser-session servers and stored secrets. Weigh it when choosing a vendor to hold tenant profiles.
- `@cloudflare/puppeteer` 2.0.1 is only two days old on 2026-11-18, which breaks the repo's one-week age rule. Pin the previous 2.0.x or 1.x release, or wait. `@cloudflare/playwright` 1.4.0 (8 days old) passes.

### Gaps
- Browserbase Director and the current Stagehand-on-Cloudflare details were not read. Browserbase's keep-alive reconnect window and its default concurrency per plan beyond the pricing table were not checked.
- Browserless self-host license (SSPL or commercial?) and BrowserQL pricing in units per hour: the docs export did not contain the license text.
- Hyperbrowser and Browser Use maximum session duration and isolation model: not found in the exports I searched.
- Anchor's maximum `max_duration` and its official pricing page: the fetch returned the homepage.
- AgentCore Browser's default vCPU and memory per session, its concurrency quota, the encryption of profiles at rest (KMS?), and whether the isolation is a microVM: the pages I read do not say.
- Whether the Playwright MCP fork is really still on upstream v0.0.30: the docs say so, but that version dates from July 2025.
- Cloudflare Browser Run's data-center or region selection and its per-session isolation boundary: neither is documented.
- The Kernel incident timeline order (detection on Nov 2 against server access on Nov 3) came from a summarizing fetch. Recheck it against the notice.
- Official Vercel guidance for Chromium inside Vercel Sandbox was not found; only community skills.

## Which services let the loop run outside and connect in, so credentials stay outside the sandbox?

### Takeaway
All of them. Each service returns a CDP WebSocket (or an AWS streaming endpoint) that a loop on Workers, Lambda or Vercel connects to. So the model's API keys never enter the browser. For *website* credentials, the services that fill logins without the model or loop seeing them are Steel Credentials, Kernel Managed Auth and Vaults, Browserbase (1Password, Secrets), Anchor secrets, and human handoff in Cloudflare, Browserbase, Steel and AgentCore. Cloudflare Outbound Workers can also add auth headers outside the browser.

### Cited Findings
- **Cloudflare:** CDP "can be accessed from any environment that supports WebSocket connections", with an API token in the `Authorization` header. — [CDP](https://developers.cloudflare.com/browser-run/cdp/)
- **Cloudflare inside Workers:** The binding needs no token at all. — [Browser binding API](https://developers.cloudflare.com/browser-run/reference/browser-binding-api/); [Changelog 2026-05-28](https://developers.cloudflare.com/browser-run/changelog/)
- **Cloudflare credential injection without the model:** An outbound Worker "can reach a private service, add authentication, or transform the response before it reaches the browser". — [Outbound Workers](https://developers.cloudflare.com/browser-run/features/outbound-workers/)
- **Cloudflare human handoff:** Covers "sensitive credentials you do not want to pass to an automation script". — [Human in the Loop](https://developers.cloudflare.com/browser-run/features/human-in-the-loop/)
- **Cloudflare Agents SDK:** The SDK keeps the browser outside the model: "The model never starts or closes the browser". The model's CDP code runs in Dynamic Workers. — [Browse the Web](https://github.com/cloudflare/agents/blob/agents%400.33.0/docs/agents/browse-the-web.md)
- **Steel:** "Steel never returns the stored password, so your agent and your model never need it." — [Credentials](https://steel.dev/docs/logins/credentials)
- **Kernel:** Credentials "are encrypted at rest and never exposed in API responses or passed to LLMs". — [Kernel docs](https://www.kernel.sh/docs/llms-full.txt)
- **Anchor:** "Secrets are never exposed to the AI model" (for computer-use models). — [Anchor docs](https://docs.anchorbrowser.io/llms-full.txt)
- **Browserbase:** The 1Password integration logs in "without hardcoding credentials into your code". Secrets are sealed client-side (HPKE) and then wrapped with KMS. — [1Password](https://docs.browserbase.com/integrations/1password/introduction); [Secrets](https://docs.browserbase.com/platform/secrets/getting-started)
- **Browser Use:** Profile sync means "no password goes into the prompt". It warns that CDP URLs carry credentials. — [Browser Use docs](https://docs.browser-use.com/llms-full.txt)
- **AgentCore:** Live View lets an end user interact directly with the session. — [AgentCore Browser](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-tool.html)

### Inferences
- This fits [ADR 0036](../../../decisions/0036-loop-outside-sandbox-and-pr-approval.md) (loop outside the sandbox) directly: the browser is just another remote sandbox behind a CDP seam.
- A CDP URL is a bearer capability. Steel says the connection URL "holds a token that controls the session", and Browser Use warns the same. Treat it as a secret, keep it out of model-visible logs, and never let the model print it. — [Steel security](https://steel.dev/docs/platform/security-and-compliance)
- Live View URLs grant control of every logged-in account in the session. Steel: "the live view gives that access to anyone who opens it". Keep their expiry short; Cloudflare's default is 5 minutes. — [Steel security](https://steel.dev/docs/platform/security-and-compliance); [Live View](https://developers.cloudflare.com/browser-run/features/live-view/)

### Gaps
- No vendor documents whether stored credentials can be scoped so that the agent cannot navigate the filled session to an attacker origin after login. Guardrails or allowed-domains (Cloudflare, Browserbase) are the nearest control.

## Which services support saved authenticated profiles, and how are they stored and encrypted?

### Takeaway
Browserbase (Contexts, encrypted at rest), Steel (Profiles; credentials in AES-256-GCM), Kernel (Profiles, snapshot replace), AgentCore (Profiles in S3 under IAM), Hyperbrowser, Anchor and Browser Use (profile sync) all offer saved login state. Cloudflare Browser Run has no profile product: persist cookies or storage state yourself, for example in Durable Object storage, and remember that the browser itself lives at most 20 idle minutes.

### Cited Findings
- **Browserbase:** A context persists the Chromium user data directory and is "uniquely encrypted at rest". Contexts can go to the customer's own S3 with BYOS (Enterprise). — [Contexts](https://docs.browserbase.com/platform/browser/core-features/contexts); [ZDR](https://docs.browserbase.com/account/enterprise/zero-data-retention)
- **Steel:** A profile saves cookies, storage, extensions, settings and user agent after release. Stored credentials are AES-256-GCM, and credentials are kept "until you delete them". — [Profiles](https://steel.dev/docs/logins/profiles); [Security](https://steel.dev/docs/platform/security-and-compliance)
- **Kernel:** "Saving replaces the profile's complete stored browser state; Kernel doesn't merge" concurrent changes. — [Kernel docs](https://www.kernel.sh/docs/llms-full.txt)
- **AgentCore:** A profile stores "cookies and local storage", is saved explicitly, and overwrites the previous data. AWS advises "proper IAM policies" because profiles hold auth cookies. Profiles are billed at S3 Standard rates. — [Browser profiles](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-profiles.html); [Pricing](https://aws.amazon.com/bedrock/agentcore/pricing/)
- **Hyperbrowser:** `profile: {id, persist_changes: true}`. — [Hyperbrowser docs](https://docs.hyperbrowser.ai/llms-full.txt)
- **Anchor:** `profile: {name, persist: true}`. — [Anchor docs](https://docs.anchorbrowser.io/llms-full.txt)
- **Browser Use:** A profile persists cookies, localStorage and login state, and sync copies cookies from a local browser. — [Browser Use docs](https://docs.browser-use.com/llms-full.txt)
- **Browserless:** Persisted sessions live for 1, 7, 30 or 90 days by plan. — [Browserless pricing](https://www.browserless.io/pricing)
- **Cloudflare:** Kitesurf cannot hold "a long-running, authenticated session that requires persistent state". The Agents SDK browser carries "tabs, cookies, and logins" across turns only while the browser stays alive. — [Kitesurf](https://developers.cloudflare.com/browser-run/kitesurf/); [Browse the Web](https://github.com/cloudflare/agents/blob/agents%400.33.0/docs/agents/browse-the-web.md)

### Inferences
- On Cloudflare we must build the profile store ourselves. Export cookies or `storageState` over CDP at the end of a task, encrypt them with a key held outside the browser (a Worker secret), and store them per user in the Durable Object or in R2. That keeps tenant auth state under our encryption, which helps [ADR 0037](../../../decisions/0037-multi-user-agent-platform.md).
- Kernel's and AgentCore's last-write-wins semantics mean one writer per profile. Give each profile to one agent at a time.

### Gaps
- Encryption details are missing for Kernel profiles (as distinct from credentials), Hyperbrowser, Anchor and Browser Use profiles, and AgentCore profiles (SSE-S3 or KMS).

## What is the cheapest reasonable option per target (Cloudflare, AWS, Vercel)?

### Takeaway
On Cloudflare, Browser Run on the $5 Workers Paid plan ($0.09/h after 10 included hours, plus $2 per averaged concurrent browser above 10) is cheapest and needs no extra vendor. On AWS, AgentCore Browser bills only active vCPU plus memory, so an idle-heavy agent session may cost a few cents an hour (estimate). On Vercel there is no native browser. The cheapest choices are to call Browser Run over CDP from Vercel, or Browser Use Cloud ($0.06/h, no subscription), or Kernel (about $0.06 per GB-hour). Self-hosting Chromium in a Vercel or E2B sandbox costs more per hour than these.

### Cited Findings
- **Cloudflare:** $0.09/h beyond 10 h a month, and $2.00 per averaged concurrent browser beyond 10. — [Pricing](https://developers.cloudflare.com/browser-run/pricing/)
- **AWS:** $0.0895 per vCPU-hour active ("idle time is free") and $0.00945 per GB-hour. — [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/)
- **Browser Use:** $0.06 per browser hour, no subscription. — [Browser Use pricing](https://browser-use.com/pricing)
- **Kernel:** $0.0000166667 per GB-second, with no charge for idle time or proxies. — [Kernel pricing](https://www.kernel.sh/pricing)
- **Anchor:** $0.05 per browser hour plus $0.01 per browser. — [Anchor docs](https://docs.anchorbrowser.io/llms-full.txt)
- **Hyperbrowser and Steel:** $0.10/h (Steel $0.08/h on the $250 Scale plan). — [Hyperbrowser pricing](https://www.hyperbrowser.ai/pricing); [Steel pricing](https://steel.dev/pricing)
- **Browserbase:** $0.12/h (Developer, $20 a month) or $0.10/h (Startup, $99 a month). — [Browserbase pricing](https://www.browserbase.com/pricing)
- **Vercel Sandbox:** $0.128 per active CPU-hour and $0.0212 per GB-hour provisioned. — [Vercel Sandbox pricing](https://vercel.com/docs/sandbox/pricing)
- **E2B:** 2 vCPU costs $0.000028/s ($0.10/h) and 4 GiB costs $0.000018/s ($0.065/h). — [E2B pricing](https://e2b.dev/pricing)
- **Cloudflare Containers memory:** $0.0000025 per GiB-second beyond the included 25 GiB-hours. — [Containers pricing](https://developers.cloudflare.com/containers/pricing/)

### Inferences
- **Kernel per hour:** 1 GB-second at $0.0000166667 makes 1 GB-hour about $0.06. A 2 GB headful browser would cost about $0.12/h. The per-session memory size is not stated (estimate).
- **AgentCore per hour (estimate, assumes a size AWS does not publish):** a session of 1 vCPU at 25% active and 2 GB costs about 0.25 × $0.0895 + 2 × $0.00945 ≈ **$0.04/h**.
- **Self-hosting on Vercel Sandbox:** About 1 active vCPU plus 4 GB costs roughly $0.128 + $0.085 ≈ **$0.21/h**, more than hosted browsers. Self-hosting on E2B at the defaults (2 vCPU, 4 GiB) is about $0.165/h of wall time. Self-hosting pays off only for isolation or control, not cost.
- **Cloudflare Containers memory alone:** a 4 GiB instance costs 4 × $0.0000025 × 3,600 ≈ $0.036/h for memory, before CPU and disk (not fetched). It is plausible but needs our own Chromium image and keep-alive.
- **Fixed concurrency fee on Cloudflare:** The $2 per averaged concurrent browser is the hidden cost. Ten always-on agent browsers fit the included 10. Fifty would add about $80 a month.
- **Portability:** Since Browser Run exposes CDP to "any environment", one Browser Run account can serve the Cloudflare, AWS and Vercel targets behind one `BrowserProvider` seam, with AgentCore as the AWS-native option. This keeps the conformance suite ([ADR 0033](../../../decisions/0033-three-deployment-targets.md)) to one CDP contract.

### Gaps
- Egress cost for Browser Run sessions is not stated on the pricing page.
- Cloudflare Containers CPU and disk rates were not captured.
- AgentCore's real vCPU and memory per browser session is unknown, so the AWS figure is an estimate.
