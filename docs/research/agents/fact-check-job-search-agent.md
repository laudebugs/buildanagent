# Fact-check log: job-search agent report

The report's recommendation stands, and the primary sources make two of its pillars firmer than the draft claimed. Meta's own newsroom and Muse pages now confirm Muse's launch, Secure VM, approval before sending email and secret-filtering email connector, which the draft had only from secondary write-ups. Google's docs confirm a Personal OAuth user type that needs no verification, which supports the one-agent-per-seeker deployment the draft could only call "plausible". Of the 136 rows, 75 are confirmed, 39 needed a correction or a sourced addition, and 22 stay unverified, mostly vendor prices and ratings behind bot walls (rows 54 and 100 split their verdict and are counted by their first mark). The largest corrections are three. The Muse job-search template submits applications on its own and routes around CAPTCHAs with a stealth browser, so it is the opposite of our design at the submit button, not an example of it. The EU Digital Omnibus was adopted as Regulation (EU) 2026/1744 on July 8, 2026, and it leaves Article 50 applying from August 2, 2026, with the four-month marking grace only for systems already on the market. Colorado's SB 26-189 is confirmed from the legislature's own page, which removes the draft's "sources conflict" flag. The rest tighten numbers, quotes and attributions, and cut the report's secondary and search-summary markers from 36 to 26 by citing primary sources.

- **Date:** 2026-11-18
- **Document checked:** [job-search-agent.md](job-search-agent.md)
- **Method:** for every number, version, date, status, quote and behavioural claim, I opened the primary source with `curl --max-time 30` on 2026-11-18 and read it as data. Vendor and legal pages were read as served that day. The Muse template's README was read from `raw.githubusercontent.com/splashdeluxe/ai-job-search-template/main/README.md`; the GitHub API was unavailable to this session, so no commit hash is recorded. The Greenhouse PDFs were read with `pdftotext`. EUR-Lex texts are the HTML of Regulation (EU) 2024/1689 and Regulation (EU) 2026/1744. Claims about our design were read from `docs/plans/`, `docs/decisions/`, `docs/guides/` and `docs/research/` on branch `docs/job-search-agent` (based on `main` at `720e779`). Blocked that day: gartner.com, trustpilot.com, tealhq.com, jobscan.co, ziprecruiter.com, hrgrapevine.com, sec.gov, crtc.gc.ca, ftc.gov (the guide URL returns 404) and ai.meta.com (HTTP 400). Nothing was installed or run.
- **Legend:** ✅ confirmed as written · ✏️ corrected in the report (the notes keep their original text) · ⚠️ unverified or inferred, marker kept

## Meta Muse and the job-search template

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 1 | The friend's "Muse" is most likely Meta Muse, a personal AI agent | §2 ¶1 | ✅ (inference; the product match is confirmed) | [muse.ai](https://muse.ai/) title "Muse — Your Personal AI Agent from Meta"; App Store "Muse from Meta", seller Meta Platforms, released 2026-09-08 |
| 2 | Launch on September 8, 2026, from secondary reports (UncoverAlpha, aitrove) | §2 ¶1 | ✏️ (marker resolved) | [Meta newsroom, 2026-09-08](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/): "rolling out in the US". Singapore on 2026-10-27, Australia on 2026-11-17 ([Australia post](https://about.fb.com/news/2026/11/muse-is-now-available-in-australia/)). Now cites Meta and adds the regions |
| 3 | Each user gets a dedicated cloud computer with a browser (secondary) | §2 ¶1 | ✏️ (marker resolved) | Launch post: "Muse Secure VM, a dedicated secure computer with its own browser"; muse.ai: "a persistent, isolated Linux computer with a full browser". Now quoted from Meta |
| 4 | Muse drafts and sends email with the user's approval (search summary of ai.meta.com/muse/productivity) | §2 ¶1 | ✏️ (marker resolved) | ai.meta.com returned HTTP 400. Launch post: Muse "checks with the person before sensitive actions like sending an email or making a purchase"; a separate Sentinel agent must approve outside actions. Now cites the launch post |
| 5 | Gmail and Google Calendar were launch connectors (secondary) | §2 ¶1 | ✏️ (in part) | Australia post lists "Gmail, Google Calendar, Instagram and OpenTable" as connectors. That they shipped at launch stays unconfirmed, so the report now says "among its connectors" |
| 6 | The email connector filters one-time passcodes and password-reset links (secondary) | §2 ¶1 | ✏️ (marker resolved) | [Muse safety blog](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse): "filters out one-time tokens, password reset links, and login magic links via both deterministic filters and a classifier model". Now quoted, magic links added |
| 7 | Pricing: free tier, Power $20 and Maximum $100 a month (secondary) | §2 ¶1 | ⚠️ | Meta says only "free for most of what people need, with subscription plans" (launch and Australia posts). The tier prices stay secondary; the report now quotes Meta and marks the tiers unconfirmed |
| 8 | The job-search board is not a built-in feature | §2 ¶2 | ✅ (inference) | Neither Meta post nor muse.ai lists a job-search feature; the template supplies one |
| 9 | The template is "the one primary source we read" | §2 ¶1 | ✏️ | No longer true; Meta's pages were read. Phrase removed |
| 10 | The template turns Muse into "an agent-run job search system" | §2 ¶2 | ✏️ | That phrase is not in the README. It says "A set of markdown files that turn Muse into a job application assistant with rules". Quote replaced |
| 11 | Template: official careers boards, one CV per company in Google Drive, scheduled dispatcher and briefing, dashboard artifact | §2 ¶2 | ✅ | README "What this is", "What Muse does in this system" table |
| 12 | Template enforces "one verified submit per role" | §2 ¶2 | ✅ | README commands table, `/apply` row |
| 13 | Template keeps job-board logins in Muse's Secure Vault | §2 ¶2 | ✏️ | README: Secure Vault "Keeps your LinkedIn and job board logins". Now names LinkedIn too |
| 14 | (Implied) the template leaves the submit to the person | §2 ¶2 | ✏️ | README "How it differs": "It submits for you, once per role"; Lever row: "the agent attempts the submit itself"; CAPTCHA section: retries "in a stealth cloud browser (Browser Use)". The report now says the template automates submission and contrasts it with our design |
| 15 | Template's `/gmail-sync` proposes status updates the user approves | §2 ¶2 (added) | ✅ | README commands table |
| 16 | themuse.com has no email agent features | §2 ¶2 | ⚠️ | Search-based, as the report says; not re-checked |

## Seeker behaviour and channels

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 17 | LinkedIn "drove about half of all saves" | §1 ¶1 | ✏️ | [Huntr 2025 report](https://huntr.co/research/2025-annual-job-search-trends-report): LinkedIn "consistently accounted for the largest share of jobs saved … in every quarter"; no share is stated in text. Now "the largest share of saves in every quarter" |
| 18 | 598,627 applications; LinkedIn 3.1%, Google Jobs 11.3%, GovernmentJobs 8.7%, Wellfound 6.0%, Glassdoor 5.5%, Indeed 4.5% | §1 ¶1; intro | ✅ | Huntr 2025 report, "Job Search Sites Responsiveness" |
| 19 | "Response" means the user moved a card to Interview | §1 ¶1 | ✅ | Huntr: "a user moving the job to the interview stage or further" |
| 20 | Huntr Q3 labels the top row "Google's career portal" | §1 ¶1 | ✅ | [Huntr Q3 2025](https://huntr.co/research/job-search-trends-q3-2025): "Applying through Google's career portal … (11.21%)" |
| 21 | Ashby: ~250,000 hires; inbound 52% in Q2 2025, a four-year high; referrals ~18%; sourced ~16% | §1 ¶2 | ✅ | [Ashby inbound report](https://www.ashbyhq.com/talent-trends-report/reports/inbound) |
| 22 | Referrals ~1% of applications (secondary) | intro; §1 ¶2 | ✏️ (marker resolved) | [Ashby referrals report](https://www.ashbyhq.com/talent-trends-report/reports/referrals): referral share fell "from 2% in Q1 2021 to less than 1%" by Q1 2024. Now "under 1%", cited to Ashby |
| 23 | Inbound offer rate ~0.2% (secondary) | §1 ¶2 | ✏️ (marker resolved) | Ashby referrals: inbound offer rates fell "7 in 1000 to 2 in 1000". Now cited to Ashby |
| 24 | Referred candidates receive offers at 7.3% (secondary) | §1 ¶2 | ⚠️ | Not in the Ashby report's text (likely a chart). Kept as secondary via Pin; noon.ai dropped |
| 25 | "Applications per hire roughly tripled from 2021 to 2024" | §1 ¶2 | ✏️ | Ashby says inbound application volume tripled, not applications per hire. Corrected |
| 26 | Pallais and Sands, NBER w21357: referred workers more likely hired | §1 ¶2 | ✅ | [NBER w21357](https://nber.org/papers/w21357) page fetched |
| 27 | One referral ≈ 30–40 cold applications | §1 ¶2 | ⚠️ inference | Rests on 7.3% ÷ 0.2% (row 24); "very roughly" kept |
| 28 | Enhancv: 25 structured interviews; 52% say applying early helps | §1 ¶3 | ✅ | [Enhancv](https://enhancv.com/blog/does-ats-reject-resumes/), published 2025-11-03 |
| 29 | "Several pause a role after 300 to 1,000 applicants" | §1 ¶3 | ✏️ | One recruiter turns a posting off past a thousand and interviews from "the first 300". Now says one recruiter |
| 30 | 23 of 25 report no content-based auto-reject; knockout question removes ~30% of technical applicants | §1 ¶3 | ✅ | Enhancv: "We only saw 2 of 25 using it"; the 30% quote |
| 31 | 53% of US recruiters hand most screening to AI/ATS | §1 ¶3 | ✅ | Greenhouse AI in Hiring Report p. 7 |
| 32 | LinkedIn applications up 45% to ~11,000 a minute, via the NYT | §1 ¶4; conclusion | ✅ | [Semafor](https://www.semafor.com/article/06/24/2025/recruiters-swamped-with-ai-generated-job-applications) |
| 33 | A LinkedIn representative gave ~9,500 a minute (secondary) | §1 ¶4 | ✅ (trade press; marker kept) | [Recruiting News Network](https://www.recruitingnewsnetwork.com/posts/recruiters-are-drinking-through-a-fire-hose-of-job-applications-experts-say--ai-is-partially-to-blame): "nearly 9,500 applications submitted every minute, according to a representative" |
| 34 | 22% of US seekers use agents to submit; 29% hide keywords; 40% use prompt injection | §1 ¶4 | ✅ | Greenhouse Workforce report pp. 8–9 ("22% … using AI agents to submit applications"; "the same percentage use hidden keyword tactics"); AI in Hiring Report ("40% of candidates in the U.S. … report using prompt injection") |
| 35 | 61% use AI-detection software; 91% caught or suspected misrepresentation; 39% more in-person interviews | §1 ¶4 | ✅ | Greenhouse AI in Hiring Report pp. 5, 14 |
| 36 | Gartner: one in four candidate profiles fake by 2028 | §1 ¶4 | ⚠️ | gartner.com served a bot challenge |
| 37 | Greenhouse CEO's "AI doom loop" (secondary) | §1 ¶4 | ⚠️ | HR Dive not fetched; marker kept |
| 38 | Tailored résumés 5.8% vs 3.73%; ~6% tailored | §1 ¶5 | ✅ | Huntr 2025: 65,088 tailored against "more than 1 million" untailored |
| 39 | 46% abandon because they must retype; 63% ghosted after interview | §1 ¶5 | ✅ | Greenhouse Workforce report pp. 11–12 |
| 40 | Median time to first offer 57 days (Q1) to 83 (Q4); 38% within 30 applications; 18% over 100 | §1 ¶5 | ✅ | Huntr 2025 |
| 41 | About half would trust AI to apply | §1 ¶5 | ✅ | Huntr Q3: "only 52% willing to trust AI" |
| 42 | Executive roles filled from inbound ~35% | §1 ¶5 | ✅ | Ashby inbound report |
| 43 | 140 applications per UK graduate vacancy (secondary) | §1 ¶5 | ✅ (marker kept) | [Wonkhe](https://wonkhe.com/blogs/graduate-jobs-and-recruitment-reality/): "140 applications per vacancy" |

## Products

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 44 | Simplify+ $39.99 a month | §2 table | ⚠️ | simplify.jobs renders prices client-side; secondary kept |
| 45 | Huntr Pro $40 a month | §2 table | ✏️ (marker resolved) | [Huntr pricing](https://huntr.co/pricing): "$40 per month". Citation moved to Huntr |
| 46 | Teal+ $29 per 30 days; Jobscan $49.95 a month | §2 table | ⚠️ | Both sites returned 403 |
| 47 | LazyApply 56% one-star of 105 Trustpilot reviews; JobCopilot 3.8 → 2.0 | §2 table | ⚠️ | trustpilot.com returned 403 |
| 48 | Bot complaints about billing and refunds; no independent outcome study | §2 ¶4 | ⚠️ | Secondary, as marked |
| 49 | LinkedIn Premium Apply Assistant rolling out June 2026; recruiters do not see AI assistance | §2 ¶5 | ✅ (trade press; marker kept) | [Social Media Today](https://www.socialmediatoday.com/news/linkedin-automates-job-application-process-for-premium-users/823719/), published 2026-06-24, quoting LinkedIn: "Draft creation and AI assistance are not shown to recruiters" |
| 50 | LinkedIn natural-language search and Job Tracker (secondary) | §2 ¶5 | ✅ (in part; marker kept) | [SocialBee](https://socialbee.com/blog/linkedin-updates-news-features/) mentions an "all-in-one" Job Tracker |
| 51 | Indeed Career Scout launched September 10, 2025 (secondary) | §2 ¶5 | ⚠️ (date) | hrgrapevine.com 403. Indeed's own terms describe Career Scout, so the product exists |
| 52 | Indeed terms describe an agentic Apply For Me tool used "at your own risk" | §2 ¶5 | ✅ | [Indeed legal](https://www.indeed.com/legal) §9(c): "You use AI-Generated Content and the Apply For Me tool at your own risk" |
| 53 | ZipRecruiter's Phil | §2 ¶5 | ⚠️ | ziprecruiter.com 403 |
| 54 | OpenAI announced a Jobs Platform for mid-2026; no launch confirmed | §2 ¶5 | ✅ (announcement) / ⚠️ (no launch) | [Campus Technology](https://campustechnology.com/articles/2025/09/10/openai-to-launch-ai-powered-jobs-platform-by-mid-2026.aspx); openai.com 403 |
| 55 | Hunter 50 credits a month; Lusha 40 (secondary) | §2 ¶6 | ✏️ (markers resolved) | [Hunter pricing](https://hunter.io/pricing): "50 credits per month"; [Lusha pricing](https://www.lusha.com/pricing/): "up to 40 credits per month". Now cited to vendors |
| 56 | ContactOut 5 a day; RocketReach 5 a month | §2 ¶6 | ⚠️ | Both pages render prices client-side; secondary kept |
| 57 | Sales Navigator $119.99 a month (secondary) | §2 ¶6 | ✏️ (marker resolved) | [LinkedIn compare plans](https://business.linkedin.com/sales-solutions/compare-plans): Core "starts at US$119.99 per month/license". Now "from $119.99", cited to LinkedIn |
| 58 | Clay from $185 a month (secondary) | §2 ¶6 | ✏️ | [Clay pricing](https://www.clay.com/pricing): Launch plan $167/mo billed annually (smallest actions and data-credit tiers), with a free plan. Now "from $167 a month, billed annually" |
| 59 | JobTally flags companies silent for 60 days | §2 ¶6 | ✅ | [JobTally](https://presdinworks.in/jobtally): "Companies you applied to 60 or more days ago with no response" |
| 60 | A JobTracker extension sits invite-only in OAuth testing mode (search summary) | §2 ¶6 | ✏️ (marker resolved) | [Chrome Web Store](https://chromewebstore.google.com/detail/jobtracker-%E2%80%94-ai-gmail-job/eaiogfbalcpeiogebndnelahdcnakglc): "currently in Google's OAuth testing mode, so it is invite-only … Google also expires the sign-in every 7 days". Seven-day expiry added |
| 61 | JobSnap avoids a Gmail connection by using a Gmail filter | §2 ¶6 | ✅ | [JobSnap](https://www.usejobsnap.com/): "Connect via Gmail Filter. Zero inbox access" |

## Integrations

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 62 | Greenhouse job board is public JSON; `questions=true` returns custom questions; `pay_transparency=true` returns pay | §3 table | ✅ | [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html): "Only the application submission endpoint … requires Basic Auth"; both query parameters on the single-job endpoint |
| 63 | Greenhouse submit needs the employer's key, which must stay server-side | §3 ¶2 | ✅ | Same page: "Any form posts should be proxied by your own servers. Any direct post … would reveal your secret key" |
| 64 | Lever postings public; submit needs an employer-created key | §3 table | ✅ | [Lever Postings API](https://raw.githubusercontent.com/lever/postings-api/master/README.md): "you need an API key, which a Super Admin of your account can generate" |
| 65 | Ashby public job board; submit needs an employer key | §3 table | ✅ | [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api); [`applicationForm.submit`](https://developers.ashbyhq.com/reference/applicationformsubmit.md): "Requires the `candidatesWrite` permission", BasicAuth |
| 66 | Workday and iCIMS tools fail 22–40% of the time (secondary, competitor) | §3 table | ⚠️ | Not re-checked |
| 67 | Indeed Publisher API retired (secondary) | §3 table | ✅ (marker kept) | [JobsPipe](https://jobspipe.dev/blog/indeed-publisher-api.md): sign-ups closed end of 2020, deprecated 2023, endpoint dead 2024 |
| 68 | Adzuna keyed API; RemoteOK requires an attribution link; HN via Algolia | §3 table | ✅ | [Adzuna](https://developer.adzuna.com/overview) ("app_key and app_id"); [RemoteOK API](https://remoteok.com/api) `legal` field: "Please link back"; [HN Search API](https://hn.algolia.com/api) |
| 69 | `gmail.send` sensitive; `gmail.readonly`, `gmail.compose`, `gmail.modify`, `gmail.metadata` restricted | §3 table and ¶3 | ✅ | [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), "Sensitive scopes" and "Restricted scopes" tables |
| 70 | Restricted scopes need an annual CASA assessment for apps that store or transmit data server-side | §3 table; intro | ✅ | [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification): "annual security assessment", CASA, "at least every 12 months after your assessor's Letter of Assessment" |
| 71 | Intro: CASA applies "for any public app" | intro | ✏️ | CASA applies only where an app can access the data "from or through a third-party server". Now "any public app that handles that data on a server" |
| 72 | Verification "can potentially take several weeks" | §3 ¶3 | ✅ | Same page |
| 73 | CASA cost $15,000–$75,000 or ~$500 a year | §3 ¶3 | ⚠️ | Secondary and conflicting, as marked |
| 74 | Google exempts personal use and development or testing | §3 ¶4 | ✅ | Same page, "Exceptions to verification requirements" |
| 75 | (Added) A Personal user type needs no verification and escapes the 100-test-user cap and 7-day expiry | §3 ¶4; §4 ¶8 | ✏️ (added) | [Google: Manage App Audience](https://support.google.com/cloud/answer/15549945): Personal mode limits authorization "exclusively to the single Google Account that created the application" and is "not subject to the OAuth user cap or 7-day test user token expiration"; Testing allows "up to 100 test users" whose authorizations "expire seven days from the time of consent" |
| 76 | Nylas offers an already-verified shared app | §3 ¶4 | ✏️ (detail) | [Nylas](https://developer.nylas.com/docs/provider-guides/google/shared-gcp-app/): passed "Tier 3 CASA"; "available on the annual Pro plan with the Accelerator add-on … and as an add-on for the Enterprise plan". Plan terms added |
| 77 | Workspace MCP server in public preview since May 2026 | §3 ¶4 | ✅ | [Workspace Updates](https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html): "public developer preview"; "Gradual rollout starting May 1, 2026" |
| 78 | The Gmail MCP uses `gmail.readonly` and `gmail.compose` and cannot send (secondary, DragApp) | §3 ¶4 | ✏️ (marker resolved) | [Configure MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers) lists `gmail.readonly`, `gmail.compose`, `gmail.modify`; [Gmail MCP reference](https://developers.google.com/workspace/gmail/api/reference/mcp) lists `create_draft`, `get_message`, `get_thread`, label tools, `list_drafts`, `search_threads`, no send. Now cites Google and adds `gmail.modify` |
| 79 | No Calendar scope on the auth page is marked restricted | §3 table | ✅ | [Calendar API auth](https://developers.google.com/workspace/calendar/api/auth), updated 2026-09-03 |
| 80 | Graph delegated `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite` consentable by personal accounts | §3 table | ✅ | [Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference): "delegated permission is available for consent in personal Microsoft accounts" for each |
| 81 | "New multitenant apps need publisher verification" | §3 table | ✏️ | [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview): users can't consent to most new unverified multitenant apps only "if risk-based step-up consent is enabled", for users in other tenants; verification is free. Now says so |
| 82 | Apollo people search free, returns no emails; email 1 credit, mobile +8 | §3 table | ✅ | [People API search](https://docs.apollo.io/reference/people-api-search.md): "0 credits"; "doesn't return email addresses or phone numbers"; [API pricing](https://docs.apollo.io/docs/api-pricing.md): "1 credit for demographics/email; +8 credits if mobile phone is returned" |
| 83 | Apollo free-plan API capped at 600 calls a day per endpoint | §3 table | ✅ | [Rate limits](https://docs.apollo.io/reference/rate-limits.md): Free 50/min, 200/hour, 600/day, "Per endpoint" |
| 84 | (Added) Free people search needs a work-email account | §3 table | ✏️ (added) | People API search: "Requires an Apollo account registered with a work email address" |
| 85 | LinkedIn open permissions are Sign In with LinkedIn and Share on LinkedIn; talent APIs partner-only | §3 table | ✅ | [Getting access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access); [Talent docs](https://learn.microsoft.com/en-us/linkedin/talent/) (Apply Connect, Job Posting API for ATS partners) |
| 86 | Notion 180 requests a minute on most plans; Sheets 300 reads a minute per project | §3 table | ✅ | [Notion limits](https://developers.notion.com/reference/request-limits): "All other plans 180 requests per minute"; [Sheets limits](https://developers.google.com/workspace/sheets/api/limits) |
| 87 | Greenhouse forms validate a reCAPTCHA Enterprise token (secondary) | §3 ¶2 | ✅ (marker kept) | [browse.sh](https://browse.sh/skills/greenhouse.com/apply-to-jobs-dsmal1) reads the client JS; not first-party |
| 88 | Workable gives employers tools to flag automated applications | §3 ¶2 | ✅ | [Workable Help](https://help.workable.com/hc/en-us/articles/35293126257815-Managing-AI-generated-and-automated-job-applications) |

## Law and terms

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 89 | LinkedIn User Agreement effective November 3, 2025; §8.2 quotes on crawlers and plugins, bots, "copying cookies"; "restrict, suspend, or terminate your account" | §4 ¶2 | ✅ | [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement): "Effective on November 3, 2025"; §8.2 bullets quoted verbatim; the suspension clause sits in §3 |
| 90 | hiQ: $500,000 consent judgment and permanent injunction, December 2022, after a breach-of-contract ruling; Ninth Circuit on CFAA (secondary) | §4 ¶2 | ✅ (law-firm summary; marker kept) | [Proskauer](https://newmedialaw.proskauer.com/2022/12/08/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case/): judgment of $500,000, order granted December 8, 2022; hiQ "was facing a ruling that it had breached LinkedIn's User Agreement". CourtListener needs an API token |
| 91 | Proxycurl shut down July 4, 2025 after LinkedIn sued in January 2025 | §4 ¶2 | ✏️ (detail) | [Nubela](https://nubela.co/blog/goodbye-proxycurl/), dated 04 July 2025; it shut down "to comply with the legal settlement with LinkedIn". Settlement added |
| 92 | LinkedIn restricted the AIHawk creator in 2024 (secondary) | §4 ¶2 | ⚠️ | Not re-checked |
| 93 | Indeed terms last updated September 29, 2026; automation of Indeed Apply prohibited | §4 ¶3 | ✅ | [Indeed legal](https://www.indeed.com/legal): "Last Updated: September 29, 2026"; quote verbatim |
| 94 | Applicant "solely responsible for your application's content" even when Apply For Me writes it | §4 ¶3 | ✏️ | The quote sits under Indeed Apply. Apply For Me (§9, a beta for US and Canadian users) auto-submits, and its user must "assume all risk for auto-submitted content". Now quoted separately |
| 95 | CAN-SPAM covers commercial-purpose messages with no B2B exemption (search summary) | §4 table | ⚠️ | ftc.gov guide URL returns 404 this session; marker kept |
| 96 | CAN-SPAM penalty up to $53,088 per email (2025 adjustment) (secondary) | §4 table | ✏️ (marker resolved) | [16 CFR 1.98](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-A/part-1/subpart-L/section-1.98), as of 2025-01-17: FTC Act §5(m)(1)(A) "$53,088", the current version. Cited to the CFR; "per violating email" |
| 97 | PECR and UK GDPR; DUAA raises PECR fines to £17.5 million or 4% | §4 table | ⚠️ | Secondary, as marked |
| 98 | GDPR Article 14 and the household exemption | §4 table | ⚠️ | EUR-Lex GDPR page fetched but these provisions were not re-read; "re-verify" kept |
| 99 | CASL: a corporate-database address is not "conspicuously published" (search summary) | §4 table | ✏️ (in part) | Statute fetched: [CASL s. 10(9)(b)](https://laws-lois.justice.gc.ca/eng/acts/E-1.6/page-2.html) implies consent where the person "conspicuously published" the address and the message is relevant to their role. The CRTC reading of databases stays a search summary (crtc.gc.ca 403). Statute cited |
| 100 | Apollo Illinois class action (secondary); ZoomInfo 10-Q publicity suits (search summary) | §4 ¶5 | ✅ / ⚠️ | [ClassAction.org](https://classaction.org/news/apollo.io-profited-from-illinois-residents-personal-data-without-consent-class-action-says): filed May 25, 2023, No. 2023CH05114. sec.gov 403, so the 10-Q stays a search summary |
| 101 | Gmail: below 0.3% spam rate, recommend 0.1%; over 5,000 a day need SPF, DKIM, DMARC, one-click unsubscribe (RFC 8058) | §4 ¶6 | ✅ | [Google sender guidelines](https://support.google.com/a/answer/81126) |
| 102 | Yahoo: 0.3% for all senders; RFC 8058; unsubscribes honoured within 2 days | §4 ¶6 | ✅ | [Yahoo Sender Hub](https://senders.yahooinc.com/best-practices/) |
| 103 | Outlook rejects non-compliant mail from domains over 5,000 a day since May 5, 2025 (550 5.7.515) | §4 ¶6 | ✅ | [Microsoft Tech Community](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730), April 29 update: rejection as "550; 5.7.515" from May 5 |
| 104 | Personal Gmail cap about 500 recipients a day (secondary, Overloop) | §4 ¶6 | ✏️ (marker resolved) | [Gmail Help: sending limits](https://support.google.com/mail/answer/22839): "more than 500 emails sent in a day". Cited to Google |
| 105 | Google's SPF and DKIM authenticate API mail from an @gmail.com address | §4 ¶6 | ⚠️ inference | Not checked against a Google page |
| 106 | Google Limited Use: "prominent" features, no data brokers, no human reading without affirmative agreement | §4 ¶7 | ✅ | [User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) |
| 107 | Anthropic AUP: spam, fake personas, "compiling personal profiles without the subjects' awareness" | §4 ¶7 | ✏️ | [AUP](https://www.anthropic.com/legal/aup), effective Nov 12, 2026: the profile clause covers profiles built "for sale, licensing, or disclosure to third parties without those individuals' awareness and agreement". Narrowed, effective date added |
| 108 | (Added) AUP requires consumer-facing AI agents that talk to external users to disclose AI | §4 ¶7 | ✏️ (added) | Same page: "All consumer-facing chatbots or AI agents that communicate directly with external users must disclose …" |
| 109 | No US law requires candidates to disclose AI use; NYC LL144 and Illinois bind employers (secondary) | §4 ¶8 | ⚠️ | Secondary, as marked |
| 110 | EU AI Act Annex III 4(a) quote | §4 ¶9 | ✅ | [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202401689), Annex III point 4(a) |
| 111 | Article 50: AI that interacts must disclose; synthetic text marked unless "an assistive function for standard editing" | §4 ¶10 | ✅ | Art. 50(1) and 50(2) |
| 112 | "A May 2026 provisional deal reportedly moves the marking duty to December 2, 2026, with formal adoption unconfirmed" | §4 ¶10 | ✏️ | Deal of May 6, 2026 ([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)), adopted as [Regulation (EU) 2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj) of 8 July 2026 (OJ 24.7.2026). Art. 50 applies from 2 August 2026; only systems on the market before then get until 2 December 2026 for Art. 50(2); Annex III high-risk duties move to 2 December 2027. Rewritten |
| 113 | NYC LL144 binds employers and agencies (secondary) | §4 ¶9 | ⚠️ | DLA Piper page fetched but not relied on as primary |
| 114 | Colorado replaced its AI Act with a narrower disclosure law from January 1, 2027, "though sources conflict" | §4 ¶9 | ✏️ | [Colorado General Assembly: SB26-189](https://leg.colorado.gov/bills/sb26-189): "Became Law", governor signed 05/14/2026; the act "repeals and reenacts" SB 24-205's provisions on automated decision-making in consequential decisions, including employment, with developer duties "starting January 1, 2027". The Legal500 page only covers the earlier delay. Conflict flag removed, legislature cited |

## Our plans and research

| # | Claim | Where | Verdict | Source |
|---|---|---|---|---|
| 115 | Nothing built; "the next phase builds M5 to M7" | §5 ¶1 | ✏️ | [Roadmap](../../plans/roadmap.md) table: M8 and M9 (the platform) are also next-phase milestones. Now "M5 to M9" |
| 116 | D5 signs the request id, tool name and canonical input hash; quote "a missing, unknown-key or invalid signature always fails closed" | §5 ¶2 | ✅ (fields completed) | [build-sdk D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5): payload "covers the request id, kind, call id, tool name, the canonical input hash and an optional `policyVersion`". Call id added |
| 117 | `approvalReuse: "none"` refuses sticky and grouped approvals; `Harness.invokeTool()` runs code calls through the pipeline | §5 ¶2 | ✅ | [build-harness](../../plans/build-harness.md) lines 181, 452, 548 |
| 118 | Tier table T0–T5 from the triage design; T5 never registered | §5 table | ✅ (our mapping) | [build-agent AD2](../../plans/build-agent.md#ad2-the-tier-table-is-code-t5-is-never-registered-and-t4-stays-denied-until-the-owner-sets-the-caps-accepted); [agent guide §5](../../guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg) |
| 119 | AD10: no classifier approves; a detector may only raise a tier | §5 ¶3 | ✅ | [build-agent AD10](../../plans/build-agent.md#ad10-no-classifier-approves-any-call-and-a-classifier-may-only-raise-a-tier) |
| 120 | Sagas quotes: "the point of no return"; "only remedy is a correction email, which is a new external action rather than a compensation" | §5 ¶4 | ✅ | [sagas report](../reversible-actions/sagas.md) lines 17, 19 |
| 121 | Quote: "a regenerated model turn emits a new id for the same action" | §5 ¶4 | ✏️ | Not in the source. [Server rollback report](../reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped) line 38: "the model emits a fresh id for what may be the same action". Quote replaced |
| 122 | Four outcome kinds including `unknown`; `stale_approval` expiry | §5 ¶4–5 | ✅ | Server rollback line 10; sagas lines 104, 124 |
| 123 | Deferred send modelled on Gmail's Undo Send | §5 ¶5 | ✅ | [rewind versus rollback](../reversible-actions/rewind-vs-rollback.md#triage-needs-undo-windows-for-t1-approval-for-anything-that-leaves-the-org-and-a-saga-only-once-money-moves) line 82 |
| 124 | Interfaces project one append-only stream; Cloudflare `setState` syncs both ways | §5 ¶6 | ✅ | [agent UI research](../agent-ui/agent-ui-research.md) lines 90, 99 |
| 125 | Guide quotes "cannot be prevented, only contained" and "the outbound leg is the one to cut" | §5 ¶7 | ✅ | [agent guide §5](../../guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg) lines 107, 109 |
| 126 | AD1 three roles; AD5 taint denies T2+ in tainted sessions and tainted drafts never auto-allow | §5 ¶7 | ✅ | [build-agent](../../plans/build-agent.md) AD1 lines 71–80; AD5 lines 141–150 |
| 127 | CA7 dedupes on a stable id, strips hidden HTML, owner-only sender; W5 covers only CLI and GitHub | §5 ¶7, ¶10 | ✅ | [build-coding-agent CA7](../../plans/build-coding-agent.md#ca7-triggers-start-with-the-cli-and-github-webhooks-behind-one-ingress-design-decided); [W5](../../todos/ready/W5-control-plane-ingress.md) lines 14, 25–26 |
| 128 | AD14 `Helpdesk` takes no recipient | §5 ¶8 | ✅ (inference from the interface) | [build-agent AD14](../../plans/build-agent.md#ad14-one-helpdesk-interface-is-the-agents-only-way-out-with-a-fake-for-tests-a-shadow-wrapper-for-rollout-and-a-real-adapter-the-owner-names-accepted) |
| 129 | Platform plan "being merged now" | §5 ¶9 | ✏️ | It is on `main` at `720e779`. Now "now on main" |
| 130 | PF1 (ADR 0037), PF4 (ADR 0039), PF6 and PF7 (ADR 0040), PF9 (ADR 0042) accepted; PF5 proposed; PF9 egress denied by default | §5 ¶9 | ✅ | [build-agent-platform](../../plans/build-agent-platform.md) status line and headings; PF9: "Egress is denied by default". Anchors resolve to the "(accepted, ADR 00xx)" headings |
| 131 | "We did not check the user cap or refresh-token lifetime of Testing-mode apps" | §5 ¶9 | ✏️ | Now checked (row 75). Paragraph rewritten around the Personal user type; still marked as our inference |
| 132 | D9 caps model USD only; HD15 covers API routes, not cookie logins | §5 ¶10 | ✅ | [build-sdk D9](../../plans/build-sdk.md#d9-the-usd-cap-is-checked-before-each-model-call-against-a-projected-cost); [HD15](../../plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls) |
| 133 | No `outcome` field or plan-level approval kind adopted into `ToolResult` | §5 ¶10 | ✅ | [rewind versus rollback](../reversible-actions/rewind-vs-rollback.md#our-sdks-and-plans-rewind-the-conversation-and-roll-back-no-data); PF5 still proposed |
| 134 | Cloudflare `agents` 0.33.0 as the platform's first target | §6 ¶1 | ✅ | [agent-building platforms report](../deployment/agent-building-platforms.md#where-a-new-platform-could-win-what-it-must-match-and-the-first-slice) line 112; roadmap M8 row |
| 135 | Each wake re-reads the thread, cited to the storage-and-wake report | §6 ¶5 | ✏️ (attribution) | The [report's rules](../deployment/storage-and-wake.md#three-rules-come-with-the-seams) say wakes arrive at least once and need idempotency keys; the re-read is our design. Now states the rule, then the design |
| 136 | pass^5 gate; one failed safety trial blocks | §6 list | ✅ | [build-agent §5.3](../../plans/build-agent.md#53-the-passk-gate-blocks-on-task-flips-single-safety-failures-cost-and-latency) |

## Corrections made

Each correction is in the report; the five notes keep their original text, and their headers point here.

1. **Muse sources (rows 2–6, 9).** Secondary launch and feature claims became quotes from Meta's launch post, its Australia post and the Muse safety blog; "the one primary source we read" was removed.
2. **Muse template (rows 10, 13, 14).** "turns Muse into 'an agent-run job search system'" became "'a job application assistant with rules'"; "job-board logins" became "LinkedIn and job-board logins"; a new passage says the template "submits for you, once per role" and retries blocked forms in "a stealth cloud browser", so its rule prevents duplicates rather than keeping a person at submit.
3. **Muse pricing (row 7).** "Pricing runs from a free tier to Power at $20 … and Maximum at $100" became Meta's "free for most of what people need, with subscription plans", with the tier prices marked unconfirmed.
4. **LinkedIn saves (row 17).** "drove about half of all saves" became "held the largest share of saves in every quarter".
5. **Ashby referrals (rows 22, 23, 25).** "about 1% of applications (secondary)" became "under 1%" from Ashby; the 0.2% inbound offer rate became "2 per 1,000" from Ashby; "applications per hire roughly tripled" became "inbound volume tripled".
6. **Enhancv (row 29).** "several pause a role after 300 to 1,000 applicants" became "one turns a posting off once it passes a thousand applications and starts interviewing from the first 300".
7. **Prices (rows 45, 55, 57, 58).** Huntr, Hunter, Lusha and Sales Navigator now cite vendor pages; "Clay from $185 a month" became "from $167 a month, billed annually".
8. **JobTracker (row 60).** Search summary replaced by the store page, with Google's seven-day sign-in expiry.
9. **CASA scope (row 71).** "for any public app" became "any public app that handles that data on a server".
10. **Google Personal user type (rows 75, 131).** Added to the Gmail section, and the platform paragraph's "we did not check the user cap or refresh-token lifetime" became a sourced statement that Personal mode has neither limit, still flagged as our inference.
11. **Nylas (row 76).** Plan requirement and Tier 3 CASA added.
12. **Gmail MCP (row 78).** "reportedly uses `gmail.readonly` and `gmail.compose` and cannot send (secondary)" became Google's own scope list, with `gmail.modify`, and tool list.
13. **Publisher verification (row 81).** "new multitenant apps need publisher verification" became "verification is free, and without it users in work tenants that enforce risk-based step-up consent cannot consent".
14. **Apollo (row 84).** Free people search needs a work-email account.
15. **Proxycurl (row 91).** Shut down "to comply with a settlement".
16. **Indeed (row 94).** The "solely responsible" quote now stays with Indeed Apply, and Apply For Me gets its own "assume all risk for auto-submitted content".
17. **CAN-SPAM and CASL (rows 96, 99).** Penalty cited to 16 CFR 1.98; CASL s. 10(9)(b) cited beside the CRTC summary.
18. **Gmail limit (row 104).** Overloop replaced by Gmail Help.
19. **Anthropic AUP (rows 107, 108).** The profiling clause narrowed to profiles for sale or disclosure; the AI-disclosure duty for agents that talk to outsiders added, and the paragraph's foot now says an agent replying on its own must say it is an AI.
20. **EU AI Act (row 112).** "A May 2026 provisional deal reportedly moves the marking duty to December 2, 2026, with formal adoption unconfirmed" became Regulation (EU) 2026/1744's actual dates.
21. **Colorado (row 114).** "replaced its AI Act with a narrower disclosure law … though sources conflict (secondary)" became SB 26-189's signed status, scope and January 1, 2027 start, cited to the legislature.
22. **Our plans (rows 115, 116, 121, 129, 135).** "M5 to M7" became "M5 to M9"; D5's signed fields gained the call id; the misquoted server-rollback line now quotes the source; "being merged now" became "now on main"; the follow-up wake now states the at-least-once rule before our re-read design.

## Review

The whole report was reviewed with `/anthropic-skills:writing-review` after the fact-check corrections, and the findings were fixed with `/anthropic-skills:writing`.

| C | Before | After | Evidence |
|---|---|---|---|
| Coherence | 3 | 4 | Before: the thesis was the second-to-last sentence of a 315-word intro, followed by a disclaimer; "the friend's" assistant appeared with no context; the Muse paragraph ran 354 words across five foci; the Article 50 point sat inside an employer-law paragraph. After: the intro opens on the friend's question, splits into two paragraphs, the first ending on a preliminary thesis and the second on the recommendation; Muse, the Gmail workarounds, the saga and Article 50 each have their own paragraph and head |
| Continuity | 4 | 4 | Before: 21 sentences over 38 words; "career page", "employer's own posting", "hosted form", "employer's page" for one concept. After: one term, "the employer's application page" (7 uses); the 76-word AI-law sentence and the 57-word intro sentence split. About 15 long sentences remain, mostly list-bearing citations |
| Clarity | 4 | 4 | Mostly actor-first and active. Fixed: "It moves tool hosting to Google, not the verification burden" (unclear contrast); the conclusion's "second product … leaves proposed" now names the triage-shaped first slice and the proposed safety package |
| Concision | 4 | 4 | No narration or emphatics; three "reportedly" hedges are real uncertainty and stay; a duplicated head ("most likely to reach a candidate-side product") was cut |
| Cadence | 4 | 4 | Openings vary; no dash cascades; paragraph lengths now 23–260 words |

**Findings left, with reasons:**
- The "Three consequences" count in §3 runs across two paragraphs (First and Second in one, Third heading the next). The Gmail consequence needs its own paragraph, and its opening "Third," keeps the count readable.
- The one-sentence AD10 paragraph after the tier table stays, because it qualifies the whole table rather than any one row.
- About 15 sentences still exceed 38 words. Most carry inline citations or a list of quoted clauses, such as the LinkedIn §8.2 sentence, and splitting them would separate quotes from their source.
- Twenty-six secondary or search-summary markers stay in the report. They mark claims whose hosts blocked this session, claims that only competitors' pages carry, and seven claims confirmed through trade press or law-firm write-ups (rows 33, 43, 49, 50, 67, 87, 90), which are secondary by nature; the product table's header says so.

The re-check after the fixes found every touched claim matching its source, and the link checker reports 0 broken relative links in the report, this log and all five notes.
