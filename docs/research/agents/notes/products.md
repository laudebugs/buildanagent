# Products that automate the job search (as of November 2026)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-job-search-agent.md](../fact-check-job-search-agent.md) and applied in [the report](../job-search-agent.md), which supersede this note where they disagree.

**Method note, read first.** This session's network blocked direct fetches of almost every vendor site (ai.meta.com, simplify.jobs, jobcopilot.com, socialmediatoday.com and mindstudio.ai all failed DNS resolution under the session's allowlist; only github.com could be fetched). So nearly every finding below comes from **web-search result summaries**, which are secondary. Many of the underlying pages are SEO comparison blogs written by competing vendors (LoopCV, Final Round AI, Simplify, JobsAICopilot and others review their rivals). Treat every price and rating as "as reported by a secondary source, as of Nov 2026" and confirm on the vendor page before using it in a design document. The one primary source actually read is the GitHub Muse job-search template. To verify, allow ai.meta.com, simplify.jobs, jobcopilot.com, linkedin.com, chromewebstore.google.com and the vendors' own domains in the session's network settings.

## 1. Which "Muse" is the friend's assistant?

### Takeaway
The best match is **Meta Muse**, Meta's personal AI agent. Secondary reports date its launch to September 8, 2026. It connects to Gmail and Google Calendar, drafts and sends email after you approve, runs on its own cloud computer with a browser, and can render dashboard artifacts, which explains the "tracker board". The Muse job site (themuse.com) does not connect to email or draft replies, so it is a poor match.

### Cited Findings
- Meta's own Muse productivity page (seen only as a search snippet) says that once email is connected, Muse "filters out the noise", and that it "drafts, replies, sends, and organizes" email, with the user's approval. — [Meta: Muse for Productivity](https://ai.meta.com/muse/productivity/) (snippet only; fetch blocked)
- A small-business user reports: "It drafted replies, I approved them with one word, and they were sent." (secondary, user testimonial) — [3rd Coast Web Design](https://www.3rdcoastwebdesign.com/post/muse-is-an-autonomous-doer-on-a-whole-new-level)
- Reported launch date of September 8, 2026, with Gmail and Google Calendar among the launch connectors (secondary). — [UncoverAlpha](https://www.uncoveralpha.com/p/meta-just-launched-its-most-important); [aitrove](https://www.aitrove.ai/blog/meta-muse-personal-ai-agent-launch-2026); [usecarly](https://www.usecarly.com/blog/meta-muse-launch/)
- Pricing (secondary, said to cite Meta's subscriptions help page): a free tier (Meta's CEO is quoted as saying it is free up to about 100M tokens a week), **Power at $20/month for 500M Muse tokens a week**, and **Maximum at $100/month for 3B tokens a week**. The paid tiers buy more usage, not different features. — [tech-insider](https://tech-insider.org/meta-muse-personal-ai-agent-launch-2026/); [shattered.io](https://shattered.io/meta-muse-ai-agent-launch-2026/); [fieldy.ai](https://www.fieldy.ai/blog/meta-muse)
- Availability: most sources say US only, age 18+. One says the US and Canada. The sources conflict. — [privacytestlab](https://privacytestlab.com/articles/meta-muse-ai-agent); [almcorp](https://almcorp.com/meta-muse-complete-guide-personal-ai-agent/)
- The email connector reportedly filters one-time passcodes, password-reset links and magic login links out of what the agent sees, using deterministic filters plus a classifier. The Gmail connector holds one account at a time (secondary). — [eesel.ai review](https://www.eesel.ai/blog/meta-muse-agent-review); [almcorp](https://almcorp.com/meta-muse-complete-guide-personal-ai-agent/)
- Architecture and privacy (secondary): each user gets a dedicated virtual computer in Meta's cloud. Meta reportedly says employees are not supposed to inspect it but that access is "technically possible for operations and support". Meta says Muse data will not feed its ad systems. Critics point to Meta's FTC privacy settlements of 2011, 2019 and 2023, and note that these are launch claims, not audits. — [almcorp](https://almcorp.com/meta-muse-complete-guide-personal-ai-agent/); [privacytestlab](https://privacytestlab.com/articles/meta-muse-ai-agent)
- By default Muse asks before sensitive actions such as sending email. Meta's developer guidelines reportedly forbid setting sensitive writes to always-allow (secondary, job-search guide). — [HRLens Muse job-search guide](https://www.hrlens.io/articles/meta-muse-job-search-guide)
- Job-search use (third-party guides): ask Muse to keep a single tracker (a document or spreadsheet) with columns for company, role, date applied, status, next step, deadline and contact. Then have it "scan my job-search inbox since [date]" and update the tracker as new emails arrive. — [HRLens](https://www.hrlens.io/articles/meta-muse-job-search-guide); [openaimaster](https://openaimaster.ai/muse-ai-job-search-guide/)
- **Primary source (GitHub, fetched):** a community template, "An agent-run job search system for Muse", is a set of markdown files that Muse reads and follows. It sources roles from official careers boards, scores them, tailors CVs, does "one verified submit per role", and runs a rejection feedback loop. It claims to work on Muse's free plan. The template relies on these Muse features: its own computer and browser (to open careers boards and fill forms); a paired computer (a fallback for file pickers); a Gmail connector (confirmations, recruiter replies, rejections); a Google Drive connector (one tailored CV per company); a Secure Vault (job-board and LinkedIn logins); memory; scheduled runs (dispatcher, shortlist, daily briefing); one chat per application; and a **dashboard artifact** that shows the pipeline, funnel and a world map. The README also contains a referral invite code that claims bonus tokens (author's claim, unverified). — [splashdeluxe/ai-job-search-template](https://github.com/splashdeluxe/ai-job-search-template)

### Inferences
- The friend's setup (email connected, drafted replies, a tracker board) matches Meta Muse plus a dashboard artifact, possibly built from a template like the one above. Muse is a general-purpose agent, not a job-search product, so the job-search behavior comes from prompts, templates and memory.
- For our design, Muse is the closest existing model of a "whole job search agent": a cloud VM with a browser, OAuth connectors, a credential vault, scheduled runs, approval before sending, and a generated dashboard. Its pattern of filtering secrets out of email before the model sees them is worth copying.
- Alternatives if it is not Meta's: **The Muse** (themuse.com, a job board with career content; no email agent features turned up in these searches), or one of several small email-AI apps. None of them fits "connects to email + drafts replies + builds a tracker board" as well as Meta Muse.

### Gaps
- Meta's official help, privacy and connector-scope pages could not be fetched, so the tier limits, whether Outlook is supported, which OAuth scopes are requested, and data retention are all unverified.
- No official Meta documentation of a built-in "job tracker board" was found. The board is most likely a user-prompted artifact or document.

## 2. AI job-search agents and copilots

### Takeaway
The market splits into three groups. **Autofill copilots** fill the form and you click submit (Simplify Copilot, Huntr, Careerflow, LinkedIn's Apply Assistant). **Document and tracker tools** draft and track but never submit (Teal, Kickresume, Jobscan). **Volume auto-submit bots** apply without per-application approval (LazyApply, JobCopilot, Sonara, Massive, LoopCV, AIApply's auto-apply credits, Simplify's Autopilot beta). The bots have the worst reviews: refund disputes, failed submissions and ban risk. Big platforms (LinkedIn, Indeed, ZipRecruiter) are now building AI assistants into their own flows.

### Cited Findings

**Simplify (Copilot / Simplify+)**
- A free Chrome extension, Copilot, autofills applications. One source says it lists about 500,000 users on the Chrome Web Store. The paid tier, Simplify+, adds an "Autopilot" beta that submits applications for you (secondary). — [dreamworkhq](https://www.dreamworkhq.com/compare/teal-alternatives); [noxjobs](https://noxjobs.com/compare/simplify-jobs-review-auto-apply-doesnt-mean-what-you-think)
- Simplify+ reportedly costs $19.99 a week, $39.99 a month or $89.99 for 3 months. Simplify's own pages reportedly do not list the price (secondary). — [noxjobs](https://noxjobs.com/compare/simplify-jobs-review-auto-apply-doesnt-mean-what-you-think); [jobsaicopilot](https://jobsaicopilot.com/jobright-vs-simplify/)
- Simplify publishes its own tracker comparison: Simplify vs Teal vs Huntr vs Notion vs a spreadsheet (vendor content). — [Simplify blog](https://simplify.jobs/blog/best-job-application-trackers-2026)

**Teal**
- A resume builder plus job tracker. Teal's own comparison page reportedly says it does not fill in or submit applications. Teal+ costs $13 every 7 days, $29 every 30 days or $79 every 90 days, and there is a free plan (secondary). — [dreamworkhq](https://www.dreamworkhq.com/compare/teal-alternatives); [applyarc](https://applyarc.com/blog/teal-alternatives)

**Huntr**
- The free plan reportedly includes unlimited autofill, a job tracker for 100 applications and 2 job-tailored resumes. Pro costs $40 a month, $90 every 3 months or $160 every 6 months (secondary). — [sprad.io](https://sprad.io/blog/best-ai-job-search-tools-2026); [rework](https://resources.rework.com/tools/ai-tools/best-ai-tools-for-job-seekers-2026)

**Jobright**
- Mainly job matching, with autofill as a secondary feature. "Turbo" reportedly costs $39.99 a month, $89.99 for 3 months or $17.99 a week. Another source says Jobright has no public pricing page. The free tier has daily credit caps (secondary; sources conflict). — [favtutor](https://favtutor.com/jobright-ai-review/); [tryhired](https://tryhired.co/blog/jobright-ai-alternative/)

**LazyApply**
- A volume auto-apply bot. Entry plan about $99 a year with daily caps. Its homepage reportedly names Greenhouse, Dice, Indeed and ZipRecruiter (secondary). — [careery](https://careery.pro/blog/ai-job-search/best-ai-auto-apply-tools-2026); [oaki](https://www.oaki.io/blog/best-auto-apply-tools-2026)
- Trustpilot (secondary signal, as reported): about 2.1/5 in one table, and 56% of 105 reviews were one-star as of March 2026. — [resumly](https://www.resumly.ai/best/best-ai-auto-apply-tools); [jobagent.sh](https://www.jobagent.sh/blog/best-ai-auto-apply-tools-2026)

**JobCopilot**
- A pure application agent with no free tier. Pricing reportedly "from $0.93/day PREMIUM, $1.05/day ELITE" (pricing page as of Oct 16, 2026, per a secondary source). Trustpilot reportedly fell from 3.8/5 in June 2026 to 2.0/5 by Oct 16, 2026 (secondary). — [remotejobassistant](https://www.remotejobassistant.com/blog/best-ai-auto-apply-tools-2026); [tsenta](https://tsenta.com/best-apps-automatically-apply-to-jobs)

**Sonara**
- Auto-apply. Pricing conflicts: a $2.95 trial then $23.95 every 4 weeks, or about $5.95 a month billed annually. The pricing was reportedly not shown on the homepage. Sources cite BBB complaints and ProductHunt reviews describing failed submissions (secondary). — [careery](https://careery.pro/blog/ai-job-search/best-ai-auto-apply-tools-2026); [jobhire.ai](https://jobhire.ai/blog/best-ai-auto-apply-tools)

**AIApply**
- A document toolkit (about $29 a month reported) with auto-apply sold separately as credit packs (for example 10 or 250 credits). One source says the credits are non-refundable; another reports a $49-a-month plan with 100 applications. An all-in estimate is about $68 a month. Trustpilot is reportedly about 4.3/5 (700+ reviews, July 2026), but one checker reports a BBB rating of F (secondary). — [dreamworkhq AIApply](https://www.dreamworkhq.com/compare/aiapply-alternatives); [LoopCV directory: AIApply](https://www.loopcv.pro/directory/aiapply/) (a competitor); [oaki](https://www.oaki.io/blog/best-auto-apply-tools-2026)

**Massive (usemassive)**
- An auto-apply service with no published pricing. Third-party estimates run from about $39 to $99 a month (for example a $49 "Passive" tier and a $99 tier). Trustpilot is reportedly about 1.7/5 in one table (secondary, competitor sources). — [LoopCV directory: Massive](https://www.loopcv.pro/directory/massive/); [jobsaicopilot](https://jobsaicopilot.com/use-massive-review/); [resumly](https://www.resumly.ai/best/best-ai-auto-apply-tools)

**LoopCV**
- Auto-apply with published pricing: a free-forever plan with limited monthly applications, and paid plans from €9.99 a month. An August 2026 snapshot showed free, $19.99, $59.99 and $89.99 a month (secondary). — [lastroundai](https://lastroundai.com/blog/best-auto-apply-job-tools-2026); [applyall](https://applyall.com/guides/best-auto-apply-services)

**Jobscan**
- Resume-to-job keyword matching ("ATS scan"). Premium costs $49.95 a month or $89.95 for 3 months. The free plan gives 5 scans a month. Auto Apply is sold as extra credits ($8.50 for 5, $15 for 10, $35 for 25), and reportedly nothing submits without your approval (secondary). — [autoapplymax](https://www.autoapplymax.com/blog/best-auto-apply-job-tools-2026); [fastapply](https://blog.fastapply.co/best-ai-job-application-automation-tools-2026)

**Careerflow**
- A tracker, LinkedIn optimizer and Chrome extension. Premium costs $8.99 a week, $23.99 a month, $54.99 a quarter or $172.99 a year as of Oct 2026. Premium Plus ($44.99 a month) adds AI mock interviews. Complaints: surprise renewals, stuck ATS scores, and a Reddit thread titled "Do not use Careerflow AI" about bugs. Trustpilot is 3.8 from 19 reviews; the Chrome extension is rated 4.4 from 288 ratings (secondary). — [jobsaicopilot Careerflow](https://jobsaicopilot.com/careerflow-ai-review/); [wobo](https://www.wobo.ai/blog/careerflow-review/)

**Kickresume**
- A resume and cover-letter builder, about $8 a month on the yearly plan ($96 a year). The AI writer and ATS checker are paid features. Trustpilot is reportedly 4.6/5 (n=3,585). The main complaint is AI credits being blocked mid-billing cycle (secondary; reviewed on Final Round's blog, a competitor). — [Final Round AI blog](https://www.finalroundai.com/blog/kickresume-review-pros-cons)

**Final Round AI**
- Interview prep, plus a live interview "copilot". Pricing conflicts: $149 a month (limited copilot sessions), or about $25 a month annualized; another source says the shortest option is $250 for two months. A 3-day money-back guarantee is reportedly denied for "substantial usage". Trustpilot is about 3.9 (255 reviews), with about 40% one-star per another source. Reviewers flag that employers treat live copilot use in interviews as cheating (secondary; one source is LoopCV, a competitor). — [LoopCV blog](https://blog.loopcv.pro/final-round-ai-review/); [interviewsidekick](https://interviewsidekick.com/blog/final-round-ai-review)

**Wonsulting**
- No 2026 pricing or feature data turned up in these searches (see Gaps).

**Big platforms**
- **LinkedIn Premium Apply Assistant:** Social Media Today reported on June 24, 2026 that LinkedIn is gradually rolling out to paid members an AI tool that pre-fills applications and drafts cover letters for top-match roles. LinkedIn says the AI assistance is not shown to recruiters. One review says it shows a confidence indicator before submission (secondary). — [Social Media Today](https://www.socialmediatoday.com/news/linkedin-automates-job-application-process-for-premium-users/823719/); [letsdatascience](https://letsdatascience.com/news/linkedin-launches-premium-apply-assistant-to-autofill-applic-5adb3af3); [ResumeHog](https://resumehog.com/blog/posts/june-2026-ai-job-tool-review-linkedin-vs-auto-apply-bots.html)
- **LinkedIn AI job search:** natural-language job search, and a job tracker. A single secondary source says filter-based search is being phased out from September 2026. Easy Apply is reportedly being renamed "LinkedIn Apply" (July 2026, unconfirmed). — [SocialBee](https://socialbee.com/blog/linkedin-updates-news-features/); [Influent](https://influent.co/blog/linkedin-updates-october-2026); [Jobsistant](https://www.jobsistant.com/guides/linkedin-2026-ai-changes)
- **Indeed Career Scout:** introduced September 10, 2025 as an AI career coach for discovering career paths, customizing resumes and practicing interviews. It uses profile, skills, experience and job-search activity. Indeed's claim that users are "38% more likely to get hired" comes from its own testing (vendor claim). An Indeed personal agent called "Pathfinder" is reportedly rolling out (single secondary source). — [HR Grapevine](https://www.hrgrapevine.com/us/content/article/2025-09-19-openai-indeed-unveil-rival-ai-hiring-platforms); [careertipset](https://careertipset.com/blog/ai-job-search-tools-indeed-linkedin-ziprecruiter)
- **ZipRecruiter Phil:** an AI career advisor that drafts profile and resume text from a few answers, emails job alerts, adds skills from your resume, and "pitches top job seekers directly to employers". — [ZipRecruiter blog](https://www.ziprecruiter.com/blog/new-job-seeker-tools/) (vendor); [careertipset](https://careertipset.com/blog/ai-job-search-tools-indeed-linkedin-ziprecruiter)
- **OpenAI Jobs Platform:** announced September 2025 with a mid-2026 target. It would match candidates to employers by demonstrated AI competencies, with Walmart and BCG named as collaborators, and pair with OpenAI Academy certifications (goal: certify 10M Americans by 2030). **No source confirmed a launch as of Nov 2026.** — [Campus Technology](https://campustechnology.com/articles/2025/09/10/openai-to-launch-ai-powered-jobs-platform-by-mid-2026.aspx); [Entrepreneur](https://www.entrepreneur.com/business-news/openai-working-on-linkedin-rival-ai-to-match-jobs/496787); [Built In](https://builtin.com/articles/openai-jobs-platform)
- In one unverified comparison, LinkedIn (96.8%) and Indeed (96.1%) recommended the most real, open jobs, because they search their own listings. The method is unclear. — [First Page Sage](https://firstpagesage.com/seo-blog/which-ai-is-best-for-job-seeking/)

**Bans and backlash (cross-cutting)**
- LinkedIn's User Agreement reportedly bans bots and extensions that automate activity on LinkedIn. Tools that only fill external company career pages reportedly fall outside it. LinkedIn applies daily and speed limits to Easy Apply (secondary, from vendor blogs). — [lastroundai](https://lastroundai.com/blog/linkedin-auto-apply-bots); [studojo](https://studojo.com/blog/auto-apply-linkedin-jobs-allowed); [HRLens](https://www.hrlens.io/articles/ai-agent-apply-on-linkedin-blocked)
- LinkedIn reportedly restricted the creator of the open-source AIHawk Easy Apply bot in September 2024 (citing Semafor; secondary). — [lastroundai](https://lastroundai.com/blog/linkedin-auto-apply-bots)
- No verified public count of auto-apply bans exists, per two sources. — [jobsaicopilot](https://jobsaicopilot.com/does-auto-apply-get-you-blacklisted/); [backdoorai](https://backdoorai.app/blog/auto-apply-linkedin-ban)

### Inferences
- Human approval is the dividing line. The well-reviewed tools keep the person at the submit button; the poorly reviewed ones submit at volume. Our agent should default to approval per application (or per batch) and to "one verified submit per role" (the Muse template's rule).
- Applying on LinkedIn through automation is a ban risk. Applying on employer ATS pages (Greenhouse, Lever, Workday) through the agent's own browser is the safer route.
- Billing (weekly plans, non-refundable credits, denied refunds) drives the complaints as much as product quality does. It is a trust signal worth designing against.

### Gaps
- No primary pricing pages, Chrome Web Store user counts or extension permissions were fetched (network blocked). Exact Chrome permissions (for example "read and change all your data on all websites") are unverified for every extension.
- Nothing found on Wonsulting's 2026 tools, Google's careers or agent features for job seekers, or a documented ChatGPT-agent or Claude job-application workflow.
- No independent outcome data (interview rate per application) for any tool; only vendor claims.
- No Reddit or recruiter first-hand data on AI-generated application floods was retrieved.

## 3. Contact-finding tools used by job seekers

### Takeaway
Job seekers use these tools to find recruiter and hiring-manager emails for direct outreach. The free tiers are small: Hunter and Apollo give about 50 credits a month, Lusha 40 a month, ContactOut 5 a day, RocketReach 5 a month. Clay and Sales Navigator are priced for sales teams ($119.99 and $185 a month and up).

### Cited Findings
- **Apollo:** free allowance figures conflict: 900 credits a year, 50 email credits a month, or 100 a month. One outlier claims 10,000 a month (secondary). — [supered](https://www.supered.io/blog/rocketreach-vs-apollo/); [moderninbound](https://moderninbound.com/blog/rocketreach-vs-apollo)
- **Hunter:** the free plan renews 50 credits a month. Email only, no phone numbers (secondary). — [enrich.so](https://www.enrich.so/blog/best-hunter-alternatives)
- **Lusha:** 40 free credits a month. Phone reveals cost 5 credits per Lusha's pricing page as quoted, or 10 per another source (secondary). — [ZoomInfo pipeline blog](https://pipeline.zoominfo.com/sales/lusha-alternatives) (a competitor); [derrick-app](https://derrick-app.com/tools/contactout-review)
- **ContactOut:** free 5 emails, 5 phones and 5 exports a day, labelled "Limited time only" by one source. The Email plan is about $49 a month billed annually. It is most relevant for recruiter lookups (secondary). — [derrick-app](https://derrick-app.com/tools/contactout-review); [sparkle.io](https://sparkle.io/blog/contactout-alternatives/)
- **RocketReach:** free tier of 5 lookups a month, no card needed (secondary). — [moderninbound](https://moderninbound.com/blog/best-rocketreach-alternatives)
- **LinkedIn Sales Navigator Core:** $119.99 per seat per month billed monthly, or $1,079.88 a year billed annually (LinkedIn's plan page as checked Sep 19, 2026, per a secondary source). Older figures were $99.99. 30-day free trial. — [joinvalley](https://www.joinvalley.co/blog/linkedin-sales-navigator-cost-explained-2026); [hublead](https://www.hublead.io/sales-navigator-cost-calculator)
- **Clay:** a free plan with 100 Data Credits and 500 Actions a month, capped at 200 rows (after a March 2026 pricing change). Launch costs $185 a month (2,500 credits, 15,000 actions); Growth from $495 a month (secondary). — [joinvalley Clay](https://www.joinvalley.co/blog/clay-pricing-and-credits-explained-2026); [crustdata](https://crustdata.com/reviews/clay)

### Inferences
- For an agent, Hunter's and Apollo's APIs plus their free credits are enough for low-volume hiring-manager lookup. Clay and Sales Navigator are overkill for one person.
- Cold outreach from a seeker's personal Gmail risks spam complaints. Email verification and send caps belong in the outreach tool.

### Gaps
- No source specific to job seekers' use of these tools (use rates, response rates) was found. API access on free tiers and privacy and GDPR complaints about these data brokers were not researched.

## 4. Email and CRM tracking used by seekers

### Takeaway
A long tail of Chrome extensions reads Gmail to classify job emails (applied, interview, rejection, offer) and updates a board or a Google Sheet. Most are small, early-stage and request Gmail read scopes. Huntr, Teal, Simplify and Careerflow provide boards. Notion and Airtable templates are the do-it-yourself default.

### Cited Findings
- **JobTally:** a free Chrome extension that tracks rejections by keyword matching and flags "ghosted" companies after 60+ days of silence. It requests read-only Gmail access. — [JobTally](https://presdinworks.in/jobtally)
- **JobTracker, "AI Gmail Job Tracker":** sorts emails into Applied, Interview and Offer stages. Invite-only because it is in Google's OAuth testing mode (secondary summary of the listing). — [Chrome Web Store](https://chromewebstore.google.com/detail/jobtracker-%E2%80%94-ai-gmail-job/eaiogfbalcpeiogebndnelahdcnakglc)
- **JobSnap:** avoids a direct Gmail connection and uses a Gmail filter to capture job emails instead. — [usejobsnap](https://www.usejobsnap.com/)
- Other listings: Gmail Job Application Tracker, Applendium, Application Tracker for Gmail, Careerbase (tracks from Gmail and LinkedIn into its own dashboard), Job Trail (statistics). — [Chrome Web Store: Gmail Job Application Tracker](https://chromewebstore.google.com/detail/gmail-job-application-tra/lkpjngmdfncejiomkofogfdoppgifmkh); [Applendium](https://chromewebstore.google.com/detail/applendium-job-applicatio/aaalkagnioipinkfogjlgkdoacebaoji); [Careerbase](https://chromewebstore.google.com/detail/careerbase-job-applicatio/hapmidcahdbnmeknokijfemdibkocgma); [Job Trail](https://chromewebstore.google.com/detail/job-trail-application-tra/kbocjankplddefjcmobfnbbjhnlohobd)
- Open-source: **job-tracker-sync** reads job emails and updates the matching row's status in a Google Sheet, and needs your own Google OAuth client. **Job-Application-Tracker** saves applications, reviews Gmail updates and exports to Sheets (pre-release). — [LebrontoJ/job-tracker-sync](https://github.com/LebrontoJ/job-tracker-sync); [Chen-Kyle/Job-Application-Tracker](https://github.com/Chen-Kyle/Job-Application-Tracker)
- Some tracker extensions ask the user to supply a third-party AI API key; some store data only in the browser (secondary summary). — [search summary of the listings above]
- Huntr's free board covers 100 applications; Teal and Careerflow include trackers (see section 2). LinkedIn now has a built-in job tracker. — [sprad.io](https://sprad.io/blog/best-ai-job-search-tools-2026); [SocialBee](https://socialbee.com/blog/linkedin-updates-news-features/)

### Inferences
- Gmail classification (keyword rules plus an LLM) driving a status board is a solved, commoditized pattern. The hard parts are matching an email to the right application row, and the Gmail restricted-scope verification that keeps small tools in "testing mode".
- The "Gmail filter instead of OAuth" approach (JobSnap) is a privacy-light design worth considering.

### Gaps
- Specific Notion and Airtable job-search templates, their popularity and their automation (Zapier or Make) were not found. Gmail OAuth scopes per extension were not verified.
