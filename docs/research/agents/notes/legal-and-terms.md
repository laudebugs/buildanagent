# Legal, terms-of-service and deliverability limits on automating a job search (as of November 2026)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-job-search-agent.md](../fact-check-job-search-agent.md) and applied in [the report](../job-search-agent.md), which supersede this note where they disagree.

Research notes, not legal advice. Where the law is unsettled the notes say so. Collected 2026-11-18.

Method note: WebFetch could not resolve most hosts in this session (linkedin.com, ftc.gov, support.google.com). Pages marked **[primary, fetched]** were downloaded with curl through the session proxy and grepped verbatim. ftc.gov, crtc.gc.ca and openai.com returned HTTP 403 to curl, so CAN-SPAM, CASL and OpenAI policy findings rest on search summaries and are marked **[secondary]** or **[search summary]**. Law-firm blogs and press are marked **[secondary]**.

## 1. LinkedIn: User Agreement bans, enforcement, and the risk of automating your own account

### Takeaway
LinkedIn's User Agreement (effective 3 November 2025) bans both scraping by any means "including … browser plugins and add-ons" and "bots or other unauthorized automated methods" that send messages, add contacts or engage with posts, so an agent that drives a job seeker's own LinkedIn account breaches the contract even when it reads only what the user could see. The enforcement record (hiQ's $500,000 consent judgment, Proxycurl's July 2025 shutdown) shows LinkedIn wins on contract and fake-account theories even though scraping public pages is probably not a CFAA crime.

### Cited Findings
- The User Agreement is "Effective on November 3, 2025" (current version as of November 2026). — [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) **[primary, fetched]**
- Section 8.2 (Don'ts), verbatim: "Develop, support or use software, devices, scripts, robots or any other means or processes (such as crawlers, browser plugins and add-ons or any other technology) to scrape or copy the Services, including profiles and other data from the Services;" — [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) **[primary, fetched]**
- Section 8.2, verbatim: "Use bots or other unauthorized automated methods to access the Services, add or download contacts, send or redirect messages, create, comment on, like, share, or re-share posts, or otherwise drive inauthentic engagement;" — [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) **[primary, fetched]**
- Section 8.2, verbatim: "Override any security feature or bypass or circumvent any access controls or use limits of the Services (such as search results, profiles, or videos);" and "Copy, use, display or distribute any information (including content) obtained from the Services, whether directly or through third pa[rties] …"; also bans using another's account "(such as sharing log-in credentials or copying cookies)" and "'framing', 'mirroring', or otherwise simulating the appearance or function of the Services; Overlay or otherwise modify the Serv[ices]". — [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) **[primary, fetched]**
- Remedy clause, verbatim: "LinkedIn reserves the right to restrict, suspend, or terminate your account if you breach this Contract or the law or are misusing the Services (e.g., violating any of the Dos and Don'ts or Professional Community Policies)." — [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) **[primary, fetched]**
- LinkedIn's "Prohibited software and extensions" help page reportedly says it does not allow "crawlers, bots, browser plug-ins, or browser extensions that scrape, modify the appearance of, or automate activity on LinkedIn's website" and that such tools "may become non-operational without notice." — [revenueflow.com](https://www.revenueflow.com/blog/linkedin-web-scraping), [northlight.ai](https://northlight.ai/blog/is-linkedin-automation-against-the-rules) **[secondary; help page not fetched]**
- A March 2026 "BrowserGate" report by Fairlinked e.V. reportedly found LinkedIn scans for installed browser extensions. — [noobclaw.com](https://noobclaw.com/blog/linkedin-automation-rules-2026/) **[secondary, unverified]**
- hiQ v. LinkedIn: the Ninth Circuit's 2022 remand ruling held that scraping publicly accessible pages is unlikely to be "without authorization" under the CFAA; the Supreme Court had vacated the 2019 decision in light of *Van Buren* (2021). — [Wikipedia: hiQ Labs v. LinkedIn](https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn) **[secondary]**
- In November 2022 the N.D. Cal. granted LinkedIn summary judgment on breach of contract, holding the User Agreement's scraping and fake-profile bans enforceable; on 6–8 December 2022 the parties stipulated to a $500,000 consent judgment and permanent injunction, hiQ stipulated to losses sufficient for CFAA liability, and hiQ agreed to destroy scraped data. Case No. 17-cv-03301 (N.D. Cal.). — [Proskauer New Media & Technology Law](https://newmedialaw.proskauer.com/2022/12/08/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case/), [MediaPost](https://www.mediapost.com/publications/article/380493/web-scraper-agrees-to-pay-linkedin-500000-destr.html), [ZwillGen](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/) **[secondary]**. Sources differ on whether the filing date was 6, 7 or 8 December 2022.
- LinkedIn sued Proxycurl (operated by Nubela) in January 2025, alleging "the unauthorized creation of hundreds of thousands of fake accounts and the scraping of millions of LinkedIn member profiles." — [Social Media Today](https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/) **[secondary]**
- Proxycurl shut down on 4 July 2025; CEO Steven Goh said there was no point fighting, citing the American Rule on fees and LinkedIn's resources; Nubela said it shut the service to comply with a settlement with LinkedIn. Settlement terms were not found. — [Nubela blog "Goodbye Proxycurl"](https://nubela.co/blog/goodbye-proxycurl/), [Bloomberg Law](https://news.bloomberglaw.com/artificial-intelligence/linkedins-war-against-bot-scrapers-ramps-up-as-ai-gets-smarter) **[company statement + secondary]**
- Apollo's and Seamless.AI's LinkedIn company pages were reportedly taken down in 2024 over scraping concerns. — [LeadGenius](https://www.leadgenius.com/resources/cognism-class-actions-and-the-shaky-future-of-b2b-data) **[secondary, vendor-affiliated]**

### Inferences
- The 8.2 bans attach to the *method* (bots, scripts, extensions), not to whether data is public or whether the actor is the account owner. An agent that logs into the user's own account and sends connection requests, InMail or messages, or that reads profiles via browser automation, is a contract breach; the realistic consequence for an individual is account restriction or permanent loss of the account, not a lawsuit. Lawsuits so far target commercial scrapers with fake accounts.
- Copying cookies to run a headless session is named explicitly ("copying cookies"), so session-reuse designs are squarely out.
- Safe default for the agent: no automated LinkedIn actions at all. Draft messages and let the human click send in LinkedIn's own UI; read only data the user pastes or exports (LinkedIn's own data-export feature).

### Gaps
- The Professional Community Policies text and the "Prohibited software and extensions" help page could not be fetched; quotes come from secondary sources.
- No public data on how often LinkedIn restricts individual accounts for automation, or on appeal outcomes.
- Proxycurl settlement terms and docket entries were not retrieved from CourtListener.

## 2. Cold email to recruiters and hiring managers: CAN-SPAM, GDPR/UK GDPR/PECR, CASL, and contact-data vendors

### Takeaway
A one-to-one, individually written email from a job seeker about their own candidacy is probably not a "commercial electronic mail message" under CAN-SPAM, but templated outreach at volume moves toward it, and CAN-SPAM has no B2B exemption. In the UK, PECR lets you email corporate subscribers without consent, but UK GDPR still applies to the named recipient, and CASL in Canada is stricter: implied consent from a published address requires the recipient to have published it themselves, which rules out most Apollo-style lookups.

### Cited Findings
**CAN-SPAM (US)**
- CAN-SPAM classifies by the message's "primary purpose": commercial (advertising or promoting a commercial product or service) versus transactional/relationship; the law "makes no exception for business-to-business email." — [FTC CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) **[search summary; ftc.gov returned 403 to direct fetch]**
- Each violating email carries a civil penalty of up to $53,088 (2025 inflation adjustment). — [Adaptive Security](https://www.adaptivesecurity.com/blog/email-compliance-penalties), [FTC guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) **[secondary; check FTC for a 2026 adjustment]**
- Requirements for commercial messages include no false headers or deceptive subject lines, identifying the message as an ad, a valid physical postal address, a clear opt-out honoured within 10 business days, and responsibility for what agents do on your behalf. — [FTC CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) **[search summary]**

**UK: PECR and UK GDPR**
- Under PECR, unsolicited email marketing to "corporate subscribers" (companies, LLPs, Scottish partnerships, government bodies) needs no consent or soft opt-in; sole traders and unincorporated partnerships are "individual subscribers" and need consent. ICO email guidance was reportedly updated 28 April 2026. — [Data Protection Network](https://dpnetwork.org.uk/direct-marketing/), [bloorengineering.com](https://www.bloorengineering.com/learn/corporate-subscriber-pecr-definition-what-b2b-marketers-need-to-know) **[secondary; ICO pages not fetched]**
- UK GDPR still applies to B2B email when the individual is identifiable, so a lawful basis (typically legitimate interests) and an opt-out are needed. — [Data Protection Network](https://dpnetwork.org.uk/direct-marketing/) **[secondary]**
- The Data (Use and Access) Act 2025 raises PECR maximum fines from £500,000 to £17.5 million or 4% of global turnover; commencement of the next phase was reportedly 5 February 2026, and ICO legitimate-interests guidance was reportedly updated 23 March 2026. — [Wikipedia: Data (Use and Access) Act 2025](https://en.wikipedia.org/wiki/Data_(Use_and_Access)_Act_2025), [expertfirmmarketing.co.uk](https://expertfirmmarketing.co.uk/professional-services-marketing-uk-gdpr-ico-enforcement) **[secondary; sources disagree on commencement]**
- EU/UK GDPR Article 14 requires the controller to inform a data subject when personal data was obtained from someone else (source, purposes, rights) within a reasonable period and at the latest at first communication. — [GDPR on EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj) **[primary, not fetched this session; from prior knowledge of the text — re-verify]**

**CASL (Canada)**
- An address found only by querying a corporate database is not "conspicuously published." — [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm) **[search summary; crtc.gc.ca returned 403]**
- Relying on conspicuous-publication implied consent requires showing the recipient published the address, there was no statement refusing unsolicited messages, and the message relates to the recipient's business role; the sender bears the burden. — [CRTC implied-consent guidance](https://crtc.gc.ca/eng/com500/guide.htm), [BLG on the 2020 FCA decision](https://www.blg.com/en/insights/2020/07/federal-court-of-appeal-rules-casl-constitutionally-valid-and-provides-interpretive-guidance) **[search summary + secondary]**
- Per the FCA decision as read by counsel, the sender must show the recipients themselves published the address, which may not be possible with third-party directories. — [Torys](https://www.torys.com/Our%20Latest%20Thinking/Publications/2020/06/fca-confirms-casl-is-constitutional-but-limits-business-communications-exemption) **[secondary]**
- The CRTC FAQ says a recruiter's email about an open position that offers a job-alert subscription would likely be commercial and subject to CASL. — [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm) **[search summary]**

**Contact-data vendors**
- ZoomInfo's SEC filings disclose pending putative class actions over its Datanyze subsidiary's use of names in free trials under the Illinois (Feb 2023), Ohio (Mar 2023) and California/Nevada/Indiana/Alabama (Oct 2024) right-of-publicity laws, a March 2025 Quebec privacy class action, and 2025 suits under Colorado's telemarketing-fraud act over listed cell numbers; still pending in the 10-Q for the quarter ended June 2026. — [ZoomInfo 10-Q, Q2 2026](https://www.sec.gov/Archives/edgar/data/0001794515/000179451526000056/zi-20260630.htm), [ZoomInfo 10-K FY2025](https://www.sec.gov/Archives/edgar/data/1794515/000179451526000012/zi-20251231.htm) **[primary filing, via search summary]**
- Apollo.io faces an Illinois Right of Publicity Act class action alleging it used residents' profiles to advertise its subscription without consent. — [ClassAction.org](https://classaction.org/news/apollo.io-profited-from-illinois-residents-personal-data-without-consent-class-action-says) **[secondary]**
- ZoomInfo v. Zenleads (Apollo.io) is mainly a patent dispute in Delaware. — [CourtListener](https://www.courtlistener.com/opinion/10854442/zoominfo-technologies-llc-v-zenleads-inc-dba-apolloio/) **[primary, via search summary]**
- Apollo's GDPR notice describes a "Data Contributor Network" in which users share business-contact data while using Apollo, and lists rights to object, portability and complaint to a supervisory authority. — [Apollo GDPR processing notice](https://www.apollo.io/privacy-policy/processing-notice) **[company, via search summary]**
- A data-removal service claims Apollo's extension syncs users' email contacts into Apollo's database. — [offlist.me](https://www.offlist.me/remove-from-apollo-io) **[secondary, interested party]**

### Inferences
- CAN-SPAM: no authority found that squarely addresses a job seeker's self-promotion email. A person offering their own labour is arguably promoting a "service", so the conservative design is to behave as if CAN-SPAM applies once outreach is templated: truthful From/subject, the sender's postal address, and honouring "no thanks" replies. Unsettled.
- GDPR/UK GDPR: a job seeker acting purely for themselves may fall under the household exemption, but an agent *vendor* processing recruiter data for many users is a controller or processor and needs a lawful basis, an Article 14 notice path and a suppression list. Unsettled for the individual; clear for the vendor.
- CASL: addresses bought from Apollo/ZoomInfo do not support implied consent; prefer addresses the recruiter published (job post, own site) and include sender ID and an unsubscribe mechanism.
- Vendors' own legal exposure (publicity-rights suits) is a reason for the agent not to depend on them by default.

### Gaps
- Exact CASL exemption text for messages sent in response to a job posting or inquiry (s. 6(5) and the Electronic Commerce Protection Regulations) was not retrieved.
- No regulator (FTC, ICO, CRTC, EU DPA) action against Apollo found; no ICO fine against a job seeker found.
- FTC and ICO pages were not fetched verbatim.

## 3. Email deliverability rules that hit automated outreach

### Takeaway
Gmail, Yahoo and Outlook all require SPF/DKIM/DMARC alignment and one-click unsubscribe only for bulk senders (about 5,000+ messages a day), so a job seeker sending dozens of emails is outside the bulk tier, but every sender must keep Gmail- and Yahoo-reported spam rates under 0.3%, and personal Gmail caps outbound mail at roughly 500 recipients a day.

### Cited Findings
- Gmail, all senders (since 1 February 2024): SPF or DKIM, valid forward and reverse DNS, TLS, spam rate in Postmaster Tools "below 0.3%", RFC 5322 formatting, no impersonating Gmail From: headers. — [Google: Email sender guidelines](https://support.google.com/a/answer/81126) **[primary, fetched]**
- Gmail, senders of more than 5,000 messages a day to Gmail accounts: SPF *and* DKIM, DMARC (policy may be `none`), From: domain aligned with SPF or DKIM, and "Marketing messages and subscribed messages must support one-click unsubscribe, and include a clearly visible unsubscribe link in the message body," via `List-Unsubscribe-Post: List-Unsubscribe=One-Click` and `List-Unsubscribe` (RFC 8058). — [Google: Email sender guidelines](https://support.google.com/a/answer/81126) **[primary, fetched]**
- Gmail: "Keep spam rates reported in Postmaster Tools below 0.10% and avoid ever reaching a spam rate of 0.30% or higher"; the guidelines cover mail to "personal Gmail accounts," i.e. addresses ending @gmail.com or @googlemail.com. — [Google: Email sender guidelines](https://support.google.com/a/answer/81126) **[primary, fetched]**
- Gmail display-name guidance flags deceptive practices such as names implying a threaded conversation ("User (2)") or using the recipient's name as the display name. — [Google: Email sender guidelines](https://support.google.com/a/answer/81126) **[primary, fetched]**
- Yahoo, all senders: SPF or DKIM, spam rate below 0.3%, valid DNS, RFC 5321/5322. Bulk senders: SPF and DKIM, DMARC, alignment, a working list-unsubscribe header supporting one-click (RFC 8058 POST "highly recommended", mailto acceptable), a visible unsubscribe link, and honouring unsubscribes "within 2 days". Yahoo publishes no numeric bulk threshold. — [Yahoo Sender Hub best practices](https://senders.yahooinc.com/best-practices/) **[primary, fetched]**
- Microsoft Outlook (consumer domains), for domains sending over 5,000 emails a day: mandatory SPF, DKIM and DMARC; from 5 May 2025 non-compliant mail is rejected with "550; 5.7.515 Access denied, sending domain [SendingDomain] does not meet the required authentication level." Functional unsubscribe links, valid From/Reply-To and list hygiene are listed as recommended practices, not requirements. — [Microsoft Defender for Office 365 blog](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730) **[primary, fetched]**
- Personal Gmail is commonly reported at 500 recipients per rolling 24 hours, Workspace at 2,000 per user per day; the Gmail API does not raise these caps and allows up to 500 recipients per message. — [Overloop](https://overloop.com/blog/gmail-sending-limits), [usecarly.com](https://www.usecarly.com/blog/gmail-api-limits/) **[secondary; Google help page on limits not fetched]**

### Inferences
- Mail sent through the Gmail API from a user's @gmail.com account is authenticated by Google's own SPF/DKIM for gmail.com, so the bulk-sender authentication rules are met automatically; the binding limits are the ~500/day cap and recipients' spam reports. A burst of templated cold mail that draws spam complaints can hurt the user's personal account reputation.
- The 0.3% threshold is measured per sending domain in Postmaster Tools, which an individual @gmail.com user cannot see, so the agent cannot monitor it and should cap volume conservatively (tens, not hundreds, a day) and keep messages individual.

### Gaps
- Google's own Gmail sending-limits help page was not fetched; the 500/2,000 figures are secondary.
- No official Google statement found on how API-sent mail from consumer accounts is treated differently from UI-sent mail.

## 4. Job boards and ATS terms, employer policies, and candidate-fraud trends

### Takeaway
Indeed's terms (updated 29 September 2026) expressly ban automating Indeed Apply "outside of Indeed's official vendors and tooling," while Indeed itself now offers an agentic "Apply For Me" tool, so the sanctioned route is the platform's own agent. ATS career sites (Greenhouse, Workday) add bot detection and CAPTCHAs, and the candidate-fraud wave (Gartner forecasts one in four candidate profiles fake by 2028) is pushing employers toward identity verification that automated applicants will increasingly hit.

### Cited Findings
- Indeed Terms "Last Updated: September 29, 2026." Verbatim: "Use of any automation, scripting, or bots to automate the Indeed Apply process outside of Indeed's official vendors and tooling is prohibited." Indeed may require email or phone verification to apply. — [Indeed legal terms](https://www.indeed.com/legal) **[primary, fetched]**
- Indeed: "Before submitting your Indeed Apply application, you should review all information … You are solely responsible for your application's content." — [Indeed legal terms](https://www.indeed.com/legal) **[primary, fetched]**
- Indeed offers an "Apply For Me" tool whose answers (from profile information and past screener responses) are "AI-Generated Content" under Section D.9; "You use AI-Generated Content and the Apply For Me tool at your own risk; accuracy is not guaranteed." Indeed's AI-Generated Content definition lists "chatbots, Agentic AI, draft cover letters or resumes." Indeed also references "bot mitigation validation" stored in a profile with permission. — [Indeed legal terms](https://www.indeed.com/legal) **[primary, fetched]**
- Greenhouse candidate terms URL returned 404; no primary Greenhouse or Workday text on automated applications was found. Secondary sources disagree on whether ATS sites prohibit automated submission; several report bot detection and intermittent CAPTCHA walls on Workday and some Greenhouse tenants. — [fastapply.co](https://blog.fastapply.co/which-job-boards-allow-auto-apply-2026), [applygoat.com](https://applygoat.com/blogs/are-auto-apply-bots-against-job-site-terms-of-service-what-indeed-and-linkedin-actually-say) **[secondary, vendor-interested]**
- No reliable evidence was found of employers formally blacklisting candidates for auto-applying; claims of duplicate-application flags are vendor assertions. — [jobsaicopilot.com](https://jobsaicopilot.com/does-auto-apply-get-you-blacklisted/) **[secondary, unverified]**
- Gartner (31 July 2025) predicts that by 2028 one in four candidate profiles worldwide will be fake; in a 2Q25 survey of 3,000 candidates, 6% admitted interview fraud; only 26% of applicants trust AI to evaluate them fairly. Gartner recommends identity verification and in-person interviews. — [Gartner press release](https://www.gartner.com/en/newsroom/press-releases/2025-07-31-gartner-survey-shows-just-26-percent-of-job-applicants-trust-ai-will-fairly-evaluate-them) **[primary]**
- Secondary sources tie the trend to deepfake interviews and North Korean IT-worker schemes; a Pindrop figure on deepfake use among such applicants could not be verified. — [hirelytica.com](https://hirelytica.com/blog/fake-candidate-crisis-identity-verification-2026) **[secondary]**
- Some employers add an AI-use question or attestation to applications, and a few name undisclosed AI use as grounds for removal; most private employers have no written policy. — [argoland.ai](https://argoland.ai/blog/disclose-ai-use-job-applications-2026), [University of Miami career blog, Sept 2026](https://customcareer.miami.edu/blog/2026/09/22/should-you-tell-an-employer-you-used-ai-to-apply/) **[secondary]**

### Inferences
- Default design: the agent finds and ranks jobs and pre-fills drafts, but a human reviews and clicks submit; never solve CAPTCHAs or bypass verification (also barred by LinkedIn 8.2's "circumvent any access controls").
- Rising identity verification means an agent that applies at volume with unverified or inconsistent data will look like the fraud employers screen for.

### Gaps
- Workday and Greenhouse candidate-facing terms not retrieved; Glassdoor terms not checked (Glassdoor's terms were not fetched this session).
- Specific employer statements (e.g. company career pages banning AI in applications) not retrieved.

## 5. Honesty constraints: truthful answers, misrepresentation, AI-use disclosure

### Takeaway
The candidate owns every answer: Indeed makes the applicant "solely responsible" for application content even when its own AI fills it in, so an agent must never invent or guess facts such as work authorization, salary history, degrees or years of experience. No US law found requires candidates to disclose AI use; the duty to disclose sits with employers, and the candidate's risk is misrepresentation.

### Cited Findings
- Indeed: applicant is "solely responsible for your application's content"; Apply For Me answers are used "at your own risk; accuracy is not guaranteed." — [Indeed legal terms](https://www.indeed.com/legal) **[primary, fetched]**
- AI disclosure laws in hiring (Illinois amendments effective 1 January 2026, NYC LL 144) bind employers, not applicants; outside such places employers need not disclose AI use. — [Vensure](https://vensure.com/resources/blog/ai-disclosure-laws-employers/) **[secondary]**
- Guidance to candidates: the line is misrepresentation, not the tool; if asked directly about AI use, answer honestly. — [argoland.ai](https://argoland.ai/blog/disclose-ai-use-job-applications-2026), [K&L Gates](https://www.klgates.com/Should-Job-Applicants-be-Permitted-to-Use-Artificial-Intelligence-3-27-2024) **[secondary]**
- Anthropic's Usage Policy bars impersonating real individuals or creating fake personas "to convince people they are interacting with a human when they are not," and bars facilitating spam and fraud. — [Anthropic Usage Policy](https://www.anthropic.com/legal/aup) **[primary, fetched]**

### Inferences
- Screening questions on work authorization, sponsorship, criminal history, salary and certifications should be answered only from user-confirmed facts and flagged for human confirmation; misstatements can justify rescinding an offer or later termination. US federal Form I-9 attestation is separate, but a false authorization answer on an application is still a misrepresentation.
- Where an application asks whether AI was used, the agent should surface the question to the user, not answer it.

### Gaps
- No primary statute or case found on liability for AI-generated false statements in job applications; this is general misrepresentation or fraud law and is unsettled as applied to agents.
- Salary-history bans (state laws barring employers from asking) were not researched.

## 6. Platform-provider policies: Google API User Data Policy, Microsoft, OpenAI/Anthropic

### Takeaway
Reading or sending Gmail through Google APIs puts the agent under the Limited Use rules: data may only power prominent user-facing features, may not be transferred except with consent or for security or law, may not be read by humans without the user's affirmative agreement, and restricted scopes require an annual third-party security assessment. Anthropic's Usage Policy bars spam, fake personas and undisclosed impersonation.

### Cited Findings
- Google API Services User Data Policy, Limited Use, verbatim: "Limit your use of data to providing or improving user-facing features that are prominent in the requesting application's user interface"; "Transfers of data are not allowed, except: To provide or improve … user-facing features … and only with the user's consent; For security purposes …; To comply with applicable laws …". — [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) **[primary, fetched]**
- "Don't allow humans to read the data, unless: You first obtained the user's affirmative agreement to view specific messages, files, or other data …; It is necessary for security purposes …". — [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) **[primary, fetched]**
- Prohibited: "Transferring or selling user data to third parties like advertising platforms, data brokers, or any information resellers" and using it for ads or credit decisions. — [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) **[primary, fetched]**
- Secure Data Handling: apps using Sensitive and Restricted Scopes "must pass an annual security assessment and obtain a Letter of Assessment from a Google-designated third party," depending on the API and number of users. — [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) **[primary, fetched]**
- Anthropic Usage Policy prohibits: "Promote or facilitate the generation or distribution of spam"; creating "fake personas, accounts … to mislead people about … whether they are interacting with a human"; and compiling or enriching "personal data from multiple sources to build profiles of individuals for sale, licensing, or disclosure to third parties without those individuals' awareness and agreement." — [Anthropic Usage Policy](https://www.anthropic.com/legal/aup) **[primary, fetched]**

### Inferences
- Sending email *as the user* in their own name, with their approval, fits within Anthropic's policy; mass unsolicited outreach or a persona pretending to be a human assistant does not.
- An agent that reads Gmail to track recruiter replies needs a restricted scope (e.g. read access), which triggers verification and the annual assessment for a published app; a single-user personal tool in testing mode avoids publication but is capped in users.

### Gaps
- OpenAI usage policies returned 403 and were not checked.
- Microsoft Graph / Outlook API data-use terms equivalent to Limited Use were not retrieved.
- Which Gmail scopes are "restricted" versus "sensitive" (gmail.send is believed sensitive, gmail.readonly restricted) was not confirmed from Google's scope list.

## 7. AI-in-hiring laws: do they touch candidate-side tools?

### Takeaway
NYC Local Law 144, Colorado's AI law and the EU AI Act's high-risk employment category all regulate tools used *to evaluate candidates* (employers, employment agencies, vendors), not tools a candidate uses to apply, so a job seeker's agent is outside their high-risk duties; the EU AI Act's Article 50 transparency duties for chatbots and synthetic text are the provisions most likely to reach a candidate-side product.

### Cited Findings
- EU AI Act Annex III point 4(a) lists as high-risk "AI systems intended to be used for the recruitment or selection of natural persons, in particular to place targeted job advertisements, to analyse and filter job applications, and to evaluate candidates"; 4(b) covers decisions on work relationships. — [Regulation (EU) 2024/1689, EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202401689) **[primary, fetched]**
- Article 50(1): providers must design AI systems that interact directly with people so they are informed they are interacting with an AI, unless obvious; 50(2): providers of systems generating synthetic text must mark outputs as machine-readable and detectable, except where the system performs "an assistive function for standard editing" or does not substantially alter the input. — [Regulation (EU) 2024/1689, EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202401689) **[primary, fetched]**
- Digital Omnibus on AI, provisional deal of 7 May 2026: Annex III high-risk obligations move from 2 August 2026 to 2 December 2027; Annex I to 2 August 2028; Art. 50(2) watermarking moves to 2 December 2026. Formal adoption was pending as of the sources found. — [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/), [Hogan Lovells](https://www.hoganlovells.com/en/publications/eu-legislators-agree-to-delay-for-highrisk-ai-rules) **[secondary]**
- NYC LL 144 defines an AEDT as a computational process from "machine learning, statistical modeling, data analytics, or artificial intelligence" used to "substantially assist or replace discretionary decision making for employment decisions"; it binds employers and employment agencies (bias audits, 10-business-day candidate notice). — [Perkins Coie](https://perkinscoie.com/insights/update/new-york-city-adopts-final-rules-law-governing-automated-employment-decision-tools), [DLA Piper, Jan 2026](https://www.dlapiper.com/en/insights/publications/2026/01/critical-audit-of-nyc-ai-hiring-law-signals-increased-risk-for-employers) **[secondary]**
- Colorado: SB 24-205 was delayed to 30 June 2026 (SB 25B-004), then repealed and replaced on 14 May 2026 by SB 26-189, a narrower automated-decision disclosure law applying from 1 January 2027; enforcement of SB 24-205 had been stayed in xAI litigation. One source conflicts and says SB 24-205 became operative 30 June 2026 with enforcement stayed. — [Legal500](https://www.legal500.com/intelligence/united-states/technology/colorado-delays-comprehensive-ai-law-with-further-changes-anticipated), [imiel.dev](https://imiel.dev/explore/us-ai-legislation-2026/colorado/); contradicted by [availablelaw.com](https://availablelaw.com/blog/colorado-ai-act-in-effect-2026) **[secondary]**

### Inferences
- A candidate-side agent does not "evaluate candidates," so Annex III 4(a) does not apply to it. If the product's own AI talks to recruiters (e.g. an AI that replies to emails), Art. 50(1) disclosure may apply to the provider in the EU; drafting text the user edits and sends is closer to the "assistive function" carve-out. Unsettled.
- A feature that ranks *jobs* for a seeker is not an employment decision about a person; a feature that ranks *candidates* for recruiters would be.

### Gaps
- SB 26-189's enrolled text was not retrieved; whether it reaches consumer-side tools is unconfirmed.
- Whether the Omnibus has been formally adopted and published in the Official Journal by November 2026 was not confirmed.
