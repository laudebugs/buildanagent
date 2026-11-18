# Integrations for a job-search agent: official APIs, costs, access review, limits and scraping risk (as of November 2026)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-job-search-agent.md](../fact-check-job-search-agent.md) and applied in [the report](../job-search-agent.md), which supersede this note where they disagree.

Research date: 2026-11-18. Primary pages were fetched with curl (WebFetch could not resolve most docs hosts in this session); items marked **[secondary]** come from search summaries or vendor/law-firm write-ups, not the primary source.

## 1. Email and calendar (Gmail, Google Calendar, Microsoft Graph, MCP servers)

### Takeaway
Reading or drafting Gmail from a server is the single most expensive integration: every Gmail scope that reads mail **or creates drafts** (`gmail.readonly`, `gmail.compose`, `gmail.modify`, `gmail.metadata`) is *restricted*, which means OAuth verification plus an annual third-party CASA security assessment for any public app that stores or transmits that data server-side; only `gmail.send` (send-only) is merely *sensitive*. Microsoft Graph has no equivalent paid assessment: delegated Mail.Read / Mail.Send / Calendars.ReadWrite need no admin consent and work for personal Microsoft accounts, but new multitenant apps need publisher verification (a verified Microsoft partner account) before users can consent under risk-based step-up consent.

### Cited Findings
**Gmail scopes (classification from Google's scope page)**
- Non-sensitive: `gmail.addons.current.action.compose`, `gmail.addons.current.message.action`, `gmail.labels` — [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- Sensitive: `gmail.addons.current.message.metadata`, `gmail.addons.current.message.readonly`, `gmail.send` — [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- Restricted: `https://mail.google.com/` (read, compose, send, permanently delete), `gmail.readonly`, `gmail.compose`, `gmail.insert`, `gmail.modify`, `gmail.metadata`, `gmail.settings.basic`, `gmail.settings.sharing` — [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- The scope page states: "If you store restricted scope data on servers (or transmit), then you must go through a security assessment." — [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- Implication for design: creating drafts (`gmail.compose`) is restricted, so a "draft-only, human sends" design does *not* avoid the restricted tier; send-only (`gmail.send`) does. — inference from [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

**Restricted-scope verification and CASA**
- "Apps accessing restricted data from or through a third-party server must undergo an annual security assessment by a Google-approved third party." — [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- Exceptions to verification: personal use, development/testing/staging, service-owned data only, internal use within an organization, domain-wide installation. — [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- Google uses the App Defense Alliance's Cloud Application Security Assessment (CASA) to standardize assessments, performed by Google-empanelled assessors. — [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification); CASA programme home [App Defense Alliance CASA](https://appdefensealliance.dev/casa)
- Reverification and a new assessment are due at least every 12 months after the assessor's Letter of Assessment (LOA) approval date; adding a new restricted scope requires an assessment covering it. — [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- Timeline: Google says the restricted-scope verification process "can potentially take several weeks." — [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- Cost **[secondary, conflicting]**: vendor/consultant pages cite $15,000–$75,000+ for a third-party assessment ([GMass](https://www.gmass.co/blog/google-oauth-verification-security-assessment/), [Truto](https://truto.one/google.md), which sells a shared-app alternative); a Unipile guide cites ~$500/yr ([Unipile](https://www.unipile.com/gmail-api-scopes-guide/)); a Reddit thread questions the high figure ([r/googlecloud](https://lr.eu.psf.lt/r/googlecloud/comments/1cry4gj/gmail_api_oauth_verification_price)). Google's own page gives no price. Treat cost as unverified; get an assessor quote.
- Workaround used in industry **[secondary]**: use a provider's shared, already-verified GCP app (e.g., Nylas) so the integrator does not run its own CASA. — [Nylas shared GCP app](https://developer.nylas.com/docs/provider-guides/google/shared-gcp-app/), [Nango Google security review](https://nango.dev/docs/api-integrations/google-shared/google-security-review)

**Google Calendar API**
- Available scopes include `calendar`, `calendar.readonly`, `calendar.events`, `calendar.events.readonly`, `calendar.freebusy`, `calendar.events.freebusy`, `calendar.events.owned`, `calendar.app.created`, `calendar.calendarlist(.readonly)`, `calendar.acls(.readonly)`, `calendar.settings.readonly`. — [Calendar API auth](https://developers.google.com/workspace/calendar/api/auth)
- The Calendar auth page contains no "restricted" classification (zero occurrences when searched), i.e., Calendar scopes are at most sensitive: OAuth verification but no CASA. — [Calendar API auth](https://developers.google.com/workspace/calendar/api/auth) (inference from text search; confirm per-scope sensitivity in the Cloud console)

**Microsoft Graph (Outlook mail and calendar)**
- `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`: AdminConsentRequired = Yes for the *application* permission, No for the *delegated* permission; each delegated permission "is available for consent in personal Microsoft accounts." `Mail.ReadWrite` "does not include permission to send mail." — [Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
- Admins can restrict application permissions to specific mailboxes via application access policy. — [Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
- Publisher verification requires a verified Microsoft AI Cloud Partner Program (formerly MPN) partner global account, an app registered with a work/school (Entra) account (not a Microsoft account), and a publisher domain that is not `*.onmicrosoft.com`. — [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)
- Since November 2020, with risk-based step-up consent enabled, users can't consent to most newly registered multitenant apps that aren't publisher-verified when they request permissions beyond basic sign-in/profile. — [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)
- Graph throttling: the Outlook service limits include four concurrent requests (per app per mailbox) and a 10,000-request window; Graph's page lists several 10,000-request windows by service. — [Graph throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits) (the exact Outlook window was not isolated in my extraction; see Gaps)
- No paid security assessment equivalent to CASA appears in Microsoft's publisher-verification requirements. — [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)

**MCP servers**
- Google opened its Workspace MCP server to public developer preview (announced May 2026, following Cloud Next '26 announcement of a Workspace MCP server, CLI and remote MCP integrations). — [Google Workspace Updates blog, May 2026](https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html)
- **[secondary]** The Gmail remote MCP endpoint is reported as `https://gmailmcp.googleapis.com/mcp/v1`, requires enabling the Gmail API and Gmail MCP API in a Cloud project, uses `gmail.readonly` + `gmail.compose`, and exposes search/read/labels/drafts tools but **does not send**. — [DragApp: Gmail MCP server](https://www.dragapp.com/blog/gmail-mcp-server/), [DragApp: Gmail MCP compared](https://www.dragapp.com/blog/gmail-mcp/)
- **[secondary]** Community: the GongRzhe Gmail-MCP-Server is archived; taylorwilsdon's Google Workspace MCP reached v2.1.0 (Oct 2026) with 120+ tools. — [DragApp](https://www.dragapp.com/blog/gmail-mcp/), [AI Weekly](https://aiweekly.co/alerts/google-workspace-mcp-v2-ships-120-tools-oauth-21-multi-user)

### Inferences
- For a hosted multi-user product, the cheapest Google path is: Calendar (sensitive) + `gmail.send` (sensitive) only, with inbox reading done another way (user-forwarded mail, a shared verified provider like Nylas, or Outlook). Reading replies from recruiters requires a restricted scope and therefore CASA.
- For a single user running the agent for themselves, Google's "personal use" exception plus a Testing-mode OAuth app avoids verification entirely (testing-mode refresh-token expiry not checked here).
- Using Google's official Gmail MCP still requires restricted scopes; it moves tool hosting to Google, not the verification burden (inference; not confirmed whether Google's MCP for third-party clients exempts them).

### Gaps
- Actual CASA price and tier (Tier 2 vs 3) for Gmail-reading apps: no primary source; support.google.com and appdefensealliance.dev page content were not extractable.
- Exact Graph Outlook throttling window (10,000 requests per 10 minutes is widely quoted but not isolated in my extraction).
- No official Microsoft Outlook MCP server was searched/confirmed.

## 2. Apollo.io and contact-enrichment alternatives

### Takeaway
Apollo's people search (`/api/v1/mixed_people/api_search`) costs 0 credits but returns no emails or phones; enrichment costs 1 credit for email/demographics and +8 for mobile, and waterfall enrichment can cost 20+ (email) or 45+ (phone) credits. API limits are per team, per endpoint, in minute/hour/day windows; the Free plan has API access but with tight caps (600/day).

### Cited Findings
- People API search: 0 credits; doesn't return email addresses or phone numbers; display limit 50,000 records (100/page, up to 500 pages); requires an Apollo account registered with a work email (additional eligibility may apply; paid accounts unaffected), or a master API key. — [Apollo People API Search](https://docs.apollo.io/reference/people-api-search)
- People enrichment / bulk enrichment (up to 10 per request): 1–9 credits per person, charged only when data is found: 1 credit for demographics/email, +8 if a mobile phone is returned; email waterfall typically 1–4 credits (can be 20+), phone waterfall typically 8–25 (can be 45+); some waterfall vendors charge per lookup even with no data. — [Apollo API Pricing](https://docs.apollo.io/docs/api-pricing.md) (updated 2026-11-17)
- Validation: 8 credits per phone, up to 1 credit per email; repeat check within 30 days still charged. Company enrichment 1 credit; company search 1 credit per page (100 results); news search 1 credit per page (25). Create/update/list endpoints cost 0. — [Apollo API Pricing](https://docs.apollo.io/docs/api-pricing.md)
- Rate limits are per team (not per key), per endpoint, enforced per minute, hour and day; 429 on excess. Default by plan (Free/Basic/Professional/Organization): 50/200/200/200 per minute; 200/400/400/600 per hour; 600/2,000/2,000/6,000 per day. — [Apollo Rate Limits](https://docs.apollo.io/reference/rate-limits.md) (updated 2026-11-18)
- Search endpoints (people, company, news): Free 50/min, 200/hr, 600/day; paid 200/min, 6,000/hr, 50,000/day. Enrichment endpoints: Free 50/min (20 bulk), 200/hr, 600/day; paid 1,000/min, no hourly/daily limit. — [Apollo Rate Limits](https://docs.apollo.io/reference/rate-limits.md)
- Pricing **[secondary]**: Basic $49, Professional $79, Organization $119 per seat/month billed yearly (Sept 2026); credits pooled, no rollover; Apollo's FAQ reportedly still says API access is for "Custom plans" while plan cards list API from Free — conflicting. — [FullEnrich](https://fullenrich.com/content/apollo-pricing); the primary rate-limit page lists Free-plan API limits, which supports API-on-Free — [Apollo Rate Limits](https://docs.apollo.io/reference/rate-limits.md)
- Alternatives (brief): Hunter.io offers Domain Search, Email Finder and Email Verifier APIs — [Hunter API](https://hunter.io/api); People Data Labs publishes rate-limit docs — [PDL rate limits](https://docs.peopledatalabs.com/docs/rate-limits) (content not extractable); RocketReach not checked.

### Inferences
- A job-search agent's use (find a hiring manager at company X, get one email) is low volume: search is free, ~1 credit per contact found, so Free/Basic plans suffice for one user.
- Sending cold email from the user's own mailbox to enriched addresses raises CAN-SPAM/GDPR questions; Apollo's data-use terms were not reviewed (gap).

### Gaps
- Apollo Terms of Service on data reuse/resale and on use within third-party products: not fetched.
- Hunter, RocketReach and PDL current prices and free tiers: not confirmed from primary pricing pages.

## 3. LinkedIn: official APIs, partner-only programs, and scraping risk

### Takeaway
For individuals, LinkedIn's self-serve ("Open") permissions are only Sign In with LinkedIn (OpenID Connect) and Share on LinkedIn (`w_member_social`). Everything recruiting-related (Apply Connect, Job Posting API, Recruiter System Connect) is partner-only for ATS vendors and employers; there is no official API to search jobs, read messages, send connection requests or send InMail as a member. Scrapers face real legal risk: hiQ ended with a $500,000 consent judgment and permanent injunction (2022) and Proxycurl shut down on 4 July 2025 after LinkedIn sued in January 2025.

### Cited Findings
- Open (consumer) permissions: "Sign in with LinkedIn using OpenID Connect" and "Share on LinkedIn" (`w_member_social`); Advertising API requires approval; sales permissions require Sales Navigator Application Platform (SNAP) partnership; Talent programs (incl. Recruiter System Connect) require applying as a partner; Compliance permissions (`r_compliance`, `w_compliance`) are closed. — [LinkedIn: Getting access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
- Talent Solutions partner products: Apply Connect (ATS integration letting job seekers apply to customer jobs without leaving LinkedIn), Job Posting API (ingests jobs created on an ATS/company site/job board for customers, partner ATSs and job distributors), Recruiter System Connect (syncs candidate data between an ATS and LinkedIn Recruiter). — [LinkedIn Talent Solutions docs](https://learn.microsoft.com/en-us/linkedin/talent/)
- None of the listed open or partner permissions exposes member job search, messaging, connection requests or InMail for a job seeker's own app. — inference from [Getting access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access) and [Talent docs](https://learn.microsoft.com/en-us/linkedin/talent/)
- Proxycurl: "In January earlier this year (2025), LinkedIn filed a lawsuit against Proxycurl. Today, we are shutting Proxycurl down… Regardless of the merits of LinkedIn's lawsuit, there is no winning in fighting this." Dated 04 July 2025. — [Nubela blog: Proxycurl Shuts Down](https://nubela.co/blog/goodbye-proxycurl/)
- **[secondary]** The complaint (N.D. Cal., defendant Nubela Pte. Ltd.) alleged creation of hundreds of thousands of fake accounts and scraping of millions of profiles; accounts conflict on whether the case ended by settlement or permanent injunction. — [Social Media Today](https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/), [Unipile](https://www.unipile.com/proxycurl-alternative/)
- **[secondary]** LinkedIn sued ProAPIs (reported December 2025). — [Bloomberg Government](https://news.bgov.com/daily-labor-report/linkedins-war-against-bot-scrapers-ramps-up-as-ai-gets-smarter)
- **[secondary, law-firm commentary]** hiQ v. LinkedIn: Nov 2022 summary judgment found hiQ breached LinkedIn's User Agreement via automated scraping and crowdsourced fake profiles; Dec 2022 consent judgment and permanent injunction with $500,000 against hiQ; the Ninth Circuit held that violating a public site's user agreement alone does not trigger CFAA "without authorization" liability. — [ZwillGen](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/), [Privacy World](https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/), [Morgan Lewis](https://www.morganlewis.com/zh-tw/blogs/sourcingatmorganlewis/2022/12/linkedin-v-hiq-landmark-data-scraping-suit-provides-guidance-to-data-scrapers-and-web-operators)

### Inferences
- The risk profile differs between (a) a vendor scraping at scale with fake accounts (sued, enjoined) and (b) a user's own logged-in browser driven by an agent (contract breach and account restriction risk to the user; the CFAA is unlikely to apply per the Ninth Circuit, but the contract claim succeeded against hiQ). Design: keep LinkedIn actions human-in-the-loop in the user's own browser, low volume, no account farming.
- Sign In with LinkedIn gives name/email/picture only; useful for identity, not for job search.

### Gaps
- LinkedIn User Agreement §8.2 text on bots/automation not fetched directly.
- Per-account limits on connection requests (often cited ~100/week) not verified from a LinkedIn primary source.
- Current legal posture of LinkedIn-data API vendors after Proxycurl not verified beyond vendor blogs.

## 4. Job sources: ATS job-board APIs and aggregators

### Takeaway
Greenhouse, Lever and Ashby expose unauthenticated public JSON for each employer's published jobs, so a job-search agent can poll thousands of company boards cheaply and legally. Programmatic application submission exists (Greenhouse POST, Lever POST) but needs an API key that only the employer can create, so a job-seeker agent cannot use it; it must fill the employer's hosted form instead. Among aggregators, Adzuna and USAJOBS offer free keyed APIs, RemoteOK a free JSON feed with attribution terms, HN via Algolia's API; Indeed's job-search Publisher API is retired.

### Cited Findings
**Greenhouse Job Board API**
- Public GET endpoints for a board's offices, departments and published jobs (JSON/JSONP); only the application POST (`POST https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{id}`) requires Basic Auth with the Base64-encoded Job Board API key; "Requests may be rate limited for security and traffic reasons." — [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html)
- `questions=true` on a job returns custom questions, location questions, EEOC compliance and demographic questions; `pay_transparency=true` returns pay ranges. — [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html)
- Greenhouse warns the key is secret and form posts must be proxied through the employer's own servers. — [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html)
- **[secondary]** Greenhouse-hosted forms reportedly validate a reCAPTCHA Enterprise token and client fingerprint. — [browse.sh Greenhouse skill](https://browse.sh/skills/greenhouse.com/apply-to-jobs-dsmal1) (not confirmed by Greenhouse)

**Lever Postings API**
- Public GET of published postings (paginated, filterable); all published postings are public; CORS allowed from the company's own domains; no internal postings. — [Lever postings-api README](https://raw.githubusercontent.com/lever/postings-api/master/README.md)
- Apply: `POST /v0/postings/SITE/POSTING-ID?key=APIKEY`; key generated by a Lever Super Admin; required fields name and email; resume only in multipart; `silent` disables the confirmation email; application-create requests are rate limited (handle 429); candidates de-duped by email. — [Lever postings-api README](https://raw.githubusercontent.com/lever/postings-api/master/README.md)

**Ashby**
- `GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}?includeCompensation=true` returns all published postings, optionally with compensation; no key required. — [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)

**Workable, SmartRecruiters, Workday**
- Workable documents a jobs API reference. — [Workable API reference](https://workable.readme.io/reference/jobs-1) (auth model not extracted)
- Workable gives employers tools to identify and manage AI-assisted/automated applications (duplicates, replaced contact details). — [Workable Help: Managing AI-assisted and automated job applications](https://help.workable.com/hc/en-us/articles/35293126257815-Managing-AI-generated-and-automated-job-applications)
- SmartRecruiters Posting API: page unreachable (proxy 502). Workday: no public candidate API found; see Gaps.

**Aggregators**
- Adzuna: register for `app_id` and `app_key`; search e.g. `https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=…&app_key=…`. — [Adzuna API overview](https://developer.adzuna.com/overview)
- RemoteOK `/api` returns a JSON array of jobs; terms require a followed link back and naming Remote OK as source or API access is suspended; logo not to be used without permission. — [RemoteOK API](https://remoteok.com/api) (fetched 2026-11-18, latest job dated 2026-11-17)
- HN "Who is Hiring": Algolia's HN Search API is public. — [HN Search API](https://hn.algolia.com/api)
- USAJOBS: official API reference exists (returned 403 to curl). — [USAJOBS API](https://developer.usajobs.gov/api-reference/get-api-search)
- Indeed **[secondary]**: job-search Publisher API retired (2023 or 2024 by differing sources); remaining Indeed APIs are employer/ATS-side (Job Sync, Indeed Apply, Disposition Sync). — [JobsPipe](https://jobspipe.dev/blog/indeed-publisher-api.md), [100Hires](https://100hires.com/indeed-api.html); Indeed docs site: [docs.indeed.com](https://docs.indeed.com/) (403 to curl)
- Google Cloud Talent Solution: docs exist at [cloud.google.com/talent-solution](https://cloud.google.com/talent-solution/job-search/docs); it is an API for employers/job boards to index *their own* jobs, not a source of jobs (inference; pricing/deprecation not extracted).

### Inferences
- Best job discovery: build a company list, resolve each to its ATS board token (Greenhouse `boards.greenhouse.io/<token>`, `jobs.lever.co/<site>`, `jobs.ashbyhq.com/<name>`), poll the public JSON. This is official, free and needs no scraping.
- Application submission by a job seeker's agent must go through the hosted form (browser automation), since all submit APIs use employer keys.

### Gaps
- Workday career sites: no primary source fetched on their structure (`*.myworkdayjobs.com` with an internal JSON "cxs" endpoint is commonly used by scrapers; unverified) or account-creation rules.
- SmartRecruiters and Workable auth/rate limits; Adzuna free-tier quotas; USAJOBS key/rate terms; Cloud Talent Solution pricing.

## 5. ATS bot detection and how auto-apply tools cope

### Takeaway
Little primary documentation exists. What is citable: Greenhouse forms reportedly carry reCAPTCHA Enterprise, Workable ships employer-side detection of AI/automated applications, and vendor tests (all from competitors) report high failure rates for automated tools on Workday and iCIMS. Auto-apply tools mostly run as browser extensions in the user's own logged-in browser.

### Cited Findings
- **[secondary]** Greenhouse application forms validate a reCAPTCHA Enterprise token and client-side fingerprint. — [browse.sh](https://browse.sh/skills/greenhouse.com/apply-to-jobs-dsmal1)
- Workable provides employers tools to identify AI-assisted applications. — [Workable Help](https://help.workable.com/hc/en-us/articles/35293126257815-Managing-AI-generated-and-automated-job-applications)
- **[secondary, competitor marketing]** iCIMS reportedly flags submissions at predictable intervals or from one IP; claimed 25–40% failure on Workday/iCIMS for automated tools; claimed 22% rejection on Workday's anti-bot filters (no methodology). — [Scale.jobs iCIMS](https://scale.jobs/blog/icims-applications-break-most-automation-tools), [Scale.jobs 30-day test](https://scale.jobs/blog/auto-apply-tools-30-day-test-results), [Scale.jobs Workday](https://scale.jobs/blog/cheap-ai-apply-tools-fail-workday-applications)
- **[secondary]** LazyApply runs as a Chrome extension auto-filling with templates. — [Scale.jobs LazyApply alternatives](https://blog.scale.jobs/best-lazyapply-alternatives-scale-jobs)
- **[secondary]** Browser-agent vendors market CAPTCHA solving as a feature. — [Skyvern blog](https://blog.skyvern.com/best-way-to-bypass-captcha-for-ai-browser-automation-september-2025)

### Inferences
- A trustworthy design avoids CAPTCHA-solving services; it pre-fills in the user's own browser and hands off to the user to solve challenges and click Submit. This also keeps the user as the legal actor accepting each employer's terms.
- Workday's per-employer candidate accounts (one per tenant) are a structural blocker for unattended automation.

### Gaps
- No Workday, iCIMS or hCaptcha primary documentation found on candidate-side bot policy; AIHawk status not found.

## 6. Tracker state and tracker integrations

### Takeaway
A tracker needs Company, Role/Posting, Application (status pipeline), Contact, Thread and Action entities; Notion (180 req/min on most plans, 600 on Business/Enterprise), Google Sheets (300 read requests/min/project) and Airtable are all viable sync targets, with the agent's own store as the source of truth.

### Cited Findings
- Notion API: Business and Enterprise 600 requests/min (avg 10/s); all other plans 180/min (avg 3/s); data-source queries ~3 req/s per connection; 429 with Retry-After and `rate_limit_reason`; JS SDK auto-retries. — [Notion request limits](https://developers.notion.com/reference/request-limits)
- Google Sheets API: per-minute quotas, e.g., 300 read requests per minute per project; 429 on excess. — [Sheets API limits](https://developers.google.com/workspace/sheets/api/limits)
- Airtable rate-limit page fetched but content not extractable (client-rendered). — [Airtable rate limits](https://airtable.com/developers/web/api/rate-limits)

### Inferences (proposed schema, not sourced)
- `Company` (id, name, domain, ats_type, ats_board_token, notes)
- `Posting` (id, company_id, title, location, comp_range, url, source [greenhouse|lever|ashby|adzuna|linkedin|referral|…], external_id, first_seen, closed_at)
- `Application` (id, posting_id, status ∈ {saved, preparing, applied, recruiter_screen, interviewing, offer, rejected, withdrawn, ghosted}, applied_at, resume_version, cover_letter_version, status_history[])
- `Contact` (id, company_id, name, role, email, email_source [apollo|hunter|manual], linkedin_url, relationship)
- `Thread` (id, application_id?, contact_id?, provider [gmail|outlook], provider_thread_id, last_message_at, awaiting_reply_from)
- `Event` (calendar event id, application_id, type [screen|onsite|…], start, end)
- `NextAction` (id, application_id, kind [follow_up|prep|send|apply], due_at, requires_approval bool)
- Store as an append-only event log so status changes are auditable (fits the repo's planned tree-shaped session log), then project to Notion/Sheets one-way.

### Gaps
- Airtable's current limit (historically 5 requests/second per base) not confirmed from the primary page.
- No user research on which tracker integrations job seekers actually want.
