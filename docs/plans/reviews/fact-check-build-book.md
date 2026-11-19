# Fact-check: the book plan

This log checks the factual claims in [build-book.md](../build-book.md), ADRs [0051](../../decisions/0051-book-in-apps-on-cloudflare.md), [0052](../../decisions/0052-book-stack-and-deploy.md) and [0053](../../decisions/0053-reuse-garment-textbook-code.md), and todos T1–T42 and U18–U21. Claims were checked on 2026-11-19 against four kinds of source. Repo claims were read at `main` `eddc212` in the first passes and at `ea70a57` from the sixth pass on. Package claims come from `npm view <package> time`, `engines`, `peerDependencies` and the packed `.d.ts`. Cloudflare claims come from developers.cloudflare.com, read through Cloudflare's documentation search. Garment textbook claims come from `tajistudios/garment-engineering-textbook` at commit `bca44b0`, read with `gh api`. Design choices that are our own proposals are not facts and have no row. Rows follow the numbers the plan cites, so some ranges hold related claims in order.

## Package versions and compatibility

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 1 | `astro` 7.4.11 was published on 2026-11-11 and is the newest release at least a week old; 7.4.13 is the latest | BK3, ADR 0052 | ✅ | `npm view astro time`: 7.4.11 at 2026-11-11T17:35Z, 7.4.12 on 2026-11-13, 7.4.13 on 2026-11-18 |
| 2 | `@astrojs/markdown-remark` 7.3.8 (2026-11-11) is the pin; 7.3.10 is the latest | BK3, ADR 0052 | ✅ | `npm view`: 7.3.8 on 2026-11-11, 7.3.9 on 2026-11-13, 7.3.10 on 2026-11-18 |
| 3 | `wrangler` 4.160.1 (2026-11-11) is the pin, because 4.161.0 came out on 2026-11-12 at 13:40 UTC; 4.165.0 is the latest | BK3, ADR 0052 | ✅ | `npm view wrangler time`: 4.160.1 at 2026-11-11T14:45Z, 4.161.0 at 2026-11-12T13:40Z, 4.165.0 on 2026-11-18 |
| 4 | `pagefind` 1.6.0 (2026-11-01) is the newest release and is over a week old | BK3 | ✅ | `npm view pagefind time`; it has no install scripts and ships platform binaries as optional dependencies |
| 5 | `remark-directive` 4.0.0 was released on 2025-02-27 and is the latest | BK3 | ✅ | `npm view remark-directive time` |
| 6 | `unist-util-visit` 5.2.0 (2026-10-24) is the latest | BK3 | ✅ | `npm view unist-util-visit time` |
| 7 | `@astrojs/cloudflare` would be pinned at 14.4.7 (2026-11-10); 14.4.9 is the latest | BK3, ADR 0052 | ✅ | `npm view`: 14.4.7 on 2026-11-10, 14.4.8 on 2026-11-13, 14.4.9 on 2026-11-18 |
| 8 | Astro 7.4.11 requires Node 22.23.4 or later, and our `.nvmrc` names `22` | BK3, T1 | ✏️ | `npm view astro@7.4.11 engines` gives `"node": ">=22.23.4"`, and `.nvmrc` holds `22`. The first draft said CI's `22` resolves to 22.23.4 or later, which was not checked; the plan now has T1 confirm it |
| 9 | `@astrojs/markdown-remark` 7.3.8 exports `unified()`, and Astro 7's default Markdown processor is Sätteri | BK3 | ✅ | The packed `dist/index.d.ts`, line 19, exports `unified`. `astro@7.4.11` depends on `@astrojs/markdown-satteri` 0.4.9, and the garment repository's `astro.config.mjs` calls it "Astro 7's default Markdown processor (Sätteri)" |
| 10 | `@astrojs/check` 0.9.12 accepts TypeScript 5 or 6 as a peer, and the root pins TypeScript 7.0.2 | BK3, ADR 0052, risk 2 | ✅ | `npm view @astrojs/check peerDependencies`: `"typescript": "^5.0.0 \|\| ^6.0.0"`; root `package.json` |

## Repository claims

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 11 | Every harness's `tsconfig.json` includes `examples/**/*.ts`, every `test` script runs `tsc -p tsconfig.json` and then the examples, and CI runs `pnpm typecheck` and `pnpm test` on every push | BK8, BK9, T4 | ✅ | `verify/vercel-ai-sdk/tsconfig.json`; the `test` script in all eight `verify/*/package.json`; `.github/workflows/ci.yml` |
| 12 | `ScriptedModel` lives in `@buildanagent/sdk/testing` and implements the gateway's adapter type | BK9 tier 4 | ✏️ | The owner's addition placed it in "our gateway's … (packages/gateway testing)". It is in `packages/sdk/src/testing/scripted-model.ts`, exported through `@buildanagent/sdk`'s `./testing`, and todo B3 records `ScriptedModel implements ModelAdapter`, a gateway type. `packages/gateway/src/testing/index.ts` exports only the offline guards. The plan states the corrected location |
| 13 | The anatomy skill is not committed under `.agents/skills/` on `main`; it is MIT-licensed, from `wheresryan22/anatomy` | BK10, T7 | ✏️ | The owner's decision says "our repo has the 'anatomy' skill". `.agents/skills/` on `main` holds the eight SDK skills and a README only. The skill is installed for the owner's agents, outside this repository, with an MIT `LICENSE`; `gh api repos/wheresryan22/anatomy` reports MIT, public, `main` at `1482e84` (2026-10-18). The plan says so, and T7 vendors a pinned copy |
| 14 | The repo holds 70 example programs in `verify/*/examples/` | Plan intro, ADR 0051 | ✅ | `ls verify/*/examples/*.ts` lists 70 files, not counting `lib/` helpers |
| 15 | Every example file the plan and the chapter todos name exists | §4, T10–T25 | ✅ | A script checked each `verify/<sdk>/examples/<name>.ts` path in the plan and the todos; none is missing |
| 16 | The AI SDK harness mocks with `MockLanguageModelV4` and has a `check()` helper; the Claude Agent SDK harness mocks the Messages API | BK9 tier 3, T5 | ✅ | `verify/vercel-ai-sdk/examples/lib/check.ts`; `verify/claude-agent-sdk/README.md` ("model calls go to a local mock of the Anthropic Messages API") |
| 17 | CI's results-drift check fails when anything but timings changed in `results/run-examples.json` | BK9 tier 3, T5 | ✅ | `ci.yml` comment before `node scripts/ci/results-drift.mjs` |
| 18 | The listing caption would read `ai@7.0.162` for the AI SDK harness | BK9 | ✅ | `verify/vercel-ai-sdk/package.json` pins `"ai": "7.0.162"` |
| 19 | The repo's documents cite inline and keep their evidence in fact-check logs, and only the harness teardown has a sources section | BK6 | ✅ | `grep '^## (Sources\|References\|Bibliography)'` over `docs/research`, `docs/guides` and the reference guides finds only `docs/research/harness-architectures.md` |

## The garment textbook repository

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 20 | The repository is private and has no licence file | BK16, ADR 0053 | ✅ | `gh api repos/tajistudios/garment-engineering-textbook`: `private: true`, `license: null` |
| 21 | Its numbered slugs needed about fifty redirects after four renumbering todos | BK5, BK16 | ✅ | `astro.config.mjs` holds 49 redirect entries; its comment names four moves (todos 53, 66, 90 and 255) |
| 22 | It runs Astro 7.4.2, `@astrojs/cloudflare` 14.4.2, Wrangler 4.153.0 and Pagefind 1.5.2 | ADR 0052 | ✅ | Its `package.json` |
| 23 | It needs the adapter and a Worker only to check sign-in | BK3, ADR 0052 | ✅ | `wrangler.jsonc` comments ("every page is prerendered") and `scripts/guard-deploy.mjs`, which refuses a deploy without the Access-checking Worker |
| 24 | `remark-citations.mjs` fails the build on an unknown source id | BK6 | ✅ | Its header comment: "An ID that isn't in the source register fails the build, naming the file" |
| 25 | `rehype-figures.mjs` fails on missing alt text or a missing caption, and inlines `viewer:` fragments with no frame that work without JavaScript | BK11, T7 | ✅ | Its header comment |
| 26 | `figure_staleness.py` compares each committed SVG with its generator's output | BK11, T6 | ✅ | `assert_current()` reads each committed file and asserts equality with the drawn body |
| 27 | `svgkit.py` embeds a font subset as a data URI, raises on glyphs outside it, and has checked `iso_line()` and `arrowhead()` | BK11, T6 | ✅ | `svgkit.py` lines 5, 46, 56, 66 and 75 |
| 28 | `check.py` enforces nine fixed sections, and its rewrite plan says the fixed names break its writing rule | BK5, BK16 | ✅ | `scripts/check.py` line 14 ("exactly the 9 H4 sections"); `docs/plans/chapter-rewrite-plan.md` line 28 |
| 29 | Its offline reading needs its own build script and end-to-end test | §1 non-goals | ✅ | `scripts/offline-build.mjs`; the `test:offline` script in `package.json` |
| 30 | Its deploy job shares self-hosted runners with pull-request code, and the repository flags this itself | BK16 | ✅ | `docs/architecture.md` line 62: "`CLOUDFLARE_API_TOKEN` now shares a machine with PR code" |
| 31 | Its deploy workflow never cancels a running deploy, runs only when `DEPLOY_ENABLED` is `true`, installs without a cache and uses a fresh `$HOME` | BK15, BK16 | ✅ | `.github/workflows/deploy.yml` lines 19–21, 45, 68 and 75–80 |
| 32 | It commits reader emails, Access application IDs and AUD tags | BK16, ADR 0053 | ✅ | The owner's decision (2026-11-19) names "reader emails, Access IDs". `guard-deploy.mjs` requires a 64-hex `ACCESS_AUD` in `wrangler.deploy.jsonc`. We did not open the files that hold the values, so that no personal data entered this session's notes |
| 33 | Every file path in BK16's reuse table exists at `bca44b0` | BK16 | ✅ | `gh api …/git/trees/HEAD?recursive=1` lists each path |

## Cloudflare and the domain

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 34 | The zone buildanagent.fyi uses Cloudflare's name servers, as of 2026-11-19 | BK2 | ✅ | `dig NS buildanagent.fyi` returns two `*.ns.cloudflare.com` servers |
| 35 | manual.buildanagent.fyi has no DNS record yet | BK2, T9 | ✅ | `dig` returns no A, AAAA or CNAME record on 2026-11-19 |
| 36 | A custom domain is set with `routes: [{ pattern, custom_domain: true }]`; the Worker is the origin and Cloudflare creates the DNS record and certificate | BK15, ADR 0052 | ✅ | [Custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/); [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) ("The Worker **is** the origin. Cloudflare creates DNS records and SSL certificates automatically") |
| 37 | Cloudflare refuses a custom domain on a hostname with an existing CNAME record | BK2, T9 | ✅ | Custom domains: "You cannot create a Custom Domain on a hostname with an existing CNAME DNS record or on a zone you do not own" |
| 38 | A static Astro build deploys with `assets.directory` and no `main` | BK3, ADR 0052 | ✅ | [Cloudflare, Astro](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/): "there's no `main` field in this config" |
| 39 | Workers static assets support a `_headers` file | BK15, T9 | ✅ | [Migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/): "`_headers` and `_redirects` files are supported natively in Workers with static assets"; the [headers page](https://developers.cloudflare.com/workers/static-assets/headers/) is linked from the preview docs |
| 40 | Worker Previews need Wrangler 4.135.0 or later, are created with `wrangler preview`, deleted with `wrangler preview delete`, and are public by default | BK15, T9 | ✅ | [Previews](https://developers.cloudflare.com/workers/previews/) |
| 41 | `workers.dev` Preview URLs carry `X-Robots-Tag: noindex`; custom-domain Preview URLs do not | BK15, T9 | ✅ | [Preview custom domains](https://developers.cloudflare.com/workers/previews/custom-domains/), "Protect Preview content" |
| 42 | `preview_urls` controls `workers.dev` Preview URLs separately from `workers_dev`, and disabling `workers_dev` leaves Preview URLs on | BK15 | ✅ | Preview custom domains ("Production and Preview `workers.dev` URLs are configured separately. Set `preview_urls`"); [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) ("Disabling your `workers.dev` route does not disable Version URLs, Preview URLs, or Deployment URLs") |
| 43 | `preview_urls: true` also turns on Version URLs, which use production resources | T9 risks | ✅ | [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/): "The Wrangler configuration field is still named `preview_urls`", and Version URLs use "production resources" |
| 44 | The anatomy skill's audit prints `audit passed`, its line check prints `line ends: 0`, and one 3D figure's full audit took 17 minutes | BK11, risk 4, T7 | ✅ | `references/verify.md` lines 63–72, 109–111 and 156 (a 28-part figure with one turn, one hinge and one clip) |
| 45 | Astro, Wrangler and the adapter each shipped several releases in the week before 2026-11-19 | Risk 1 | ✅ | Rows 1, 3 and 7 |

## Facts the chapter todos rely on

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 46 | The feature table opens with "a model calls tools in a loop until a stop condition holds" | T10 | ✅ | [Feature table](../../comparison/feature-table.md), first paragraph |
| 47 | The SDKs' default caps run from one step to 500 model calls | T13 | ✅ | Feature table heading "Loop control: default caps range from 1 step to 500 model calls" |
| 48 | State lives in eight places across the SDKs | T15 | ✅ | [Deep comparison](../../comparison/deep-comparison.md) heading "State lives in eight places" |
| 49 | Our SDK has six interceptors with observers beside them | T19 | ✅ | [ADR 0006](../../decisions/0006-interceptor-names.md) |
| 50 | The harness guide proposes five context layers, cheapest first | T20 | ✅ | [Harness guide §3](../../guides/agent-harness.md) heading |
| 51 | A write reports one of five outcomes | T23 | ✅ | [SG3](../close-sdk-gaps.md#sg3-a-write-reports-one-of-five-outcomes-and-unknown-is-never-retried-with-a-fresh-key-accepted) |
| 52 | There are eight portable seams | T24 | ✅ | [ADR 0043](../../decisions/0043-standalone-safety-core.md) adds `EffectStore` as the eighth |
| 53 | The main report's thesis is "Own the loop, rent the sandbox", and it places SDKs in three tiers of loop ownership | T10, T17 | ✅ | [Main report](../../research/agent-sdks-and-harness-design.md): title and the heading "Vendor SDKs split into three tiers of loop ownership" |

## The owner's decisions

Each row checks that a document records the owner's words as given on 2026-11-19.

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 54 | A textbook on how to build an agent, with images and example code from this repository, in two parts | BK1, ADR 0051 | ✅ | Owner's decisions, quoted |
| 55 | The book lives at `apps/book` and is published on Cloudflare at manual.buildanagent.fyi; public, no sign-in; prose CC BY 4.0, code Apache-2.0 OR MIT | BK2, ADR 0051 | ✅ | Owner's decisions, quoted |
| 56 | Code comes from `verify/` now and switches to `packages/` as its todos land | BK8, ADR 0051 | ✅ | Owner's decision, quoted |
| 57 | Figures mix flat SVG diagrams with a few interactive isometric centerpieces | BK10 | ✅ | Owner's decision, quoted; row 13 corrects where the skill lives |
| 58 | Three directions A, B and C are on the canvas, unpicked; then four warm variations of C, C1–C4, after the owner liked C's layout with warmer colours and other fonts; the design todo's first task is the pick | BK12, T2 | ✅ | Owner's decision and the owner's addition, both 2026-11-19 |
| 59 | The garment repository's code may be reused with credit, and its personal data and `CLAUDE.md` rules are never copied | BK16, ADR 0053 | ✅ | Owner's decision, quoted. Whether reuse includes relicensing under Apache-2.0 OR MIT is not in the owner's words, so ADR 0053 and T1 ask the owner |
| 60 | Code blocks become interactive in tiers 1–3 from the same checked regions, with tier 4 later and no provider keys in the browser | BK9, T5 | ✅ | The owner's addition (2026-11-19) |

## Claims the writing-review fixes touched

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 61 | Every workflow's actions are locked in `actions.lock` | BK15, as reworded | ✅ | [AGENTS.md](../../../AGENTS.md) layout: "Every action is locked by `.github/workflows/actions.lock`" |
| 62 | The garment book typed figure numbers into captions by hand | Plan intro | ✅ | `rehype-figures.mjs` header: the caption paragraph "starts with bold text “Fig. N.N”", written by the author |

## Second pass: the owner's answers of 2026-11-19

These rows check the claims added for BK12's design, BK15's deploy setup, BK16's licence, BK17 and BK18, and todos T2, T7, T9, T26 and T27. Font facts were read from `google/fonts` at `main` `5bd87df` (2026-11-18). Contrast ratios use the WCAG 2 relative-luminance formula, computed for every pair.

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 63 | Instrument Serif is on Google Fonts under the SIL Open Font License 1.1 | BK12, T2 | ✅ | `ofl/instrumentserif/METADATA.pb` (`license: "OFL"`) and `OFL.txt` ("licensed under the SIL Open Font License, Version 1.1") |
| 64 | Literata is on Google Fonts under the OFL 1.1 | BK12, T2 | ✅ | `ofl/literata/METADATA.pb` and `OFL.txt` |
| 65 | Google Sans Code is on Google Fonts under the OFL 1.1 | BK12, T2 | ✅ | `ofl/googlesanscode/METADATA.pb` (added 2024-11-21) and `OFL.txt` |
| 66 | Google Sans Code ships a `TRADEMARKS.md` that limits use of its name for modified versions, and its OFL names no Reserved Font Names | T2 | ✅ | `ofl/googlesanscode/TRADEMARKS.md`: "Google also does not include within the Open Font License … any Reserved Font Names", and the rules for Modified Font Software |
| 67 | Every text colour meets WCAG AA on its background, the lowest being the light accent at 4.80:1 and the panel's terracotta at 5.93:1 | BK12, T2 | ✅ | Light page `#FAF3E8`: text 14.70, soft 9.73, muted 7.22, accent 4.80, link 7.32. Dark page `#2A1E16`: text 13.62, soft 10.02, muted 6.94, accent 7.63. Panel `#17110D`: text 15.46, amber 9.12, terracotta 5.93, olive 12.02, comment 6.59 |
| 68 | The rule colours reach 1.30:1 and 1.39:1 on their pages | BK12, T2 | ✅ | `#E4D6C2` on `#FAF3E8` and `#45352A` on `#2A1E16`, by the same formula |
| 69 | The proposed dark link colour, the dark accent, reaches 7.63:1 on the dark page | BK12, T2 | ✅ | Row 67 |
| 70 | Environment secrets reach only jobs that reference the environment, and only after a required reviewer approves; deployment branches can be limited to selected branches | BK15, BK18, T9, T27 | ✅ | [GitHub, environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments): "a job cannot access environment secrets until one of the required reviewers approves it"; the options "Protected branches only" and "Selected branches and tags" |
| 71 | On GitHub Free, environment secrets work only in public repositories, and this repository is public | BK15, T9 | ✅ | Same page: "environment secrets are only available in public repositories"; `gh api repos/laudebugs/buildanagent` reports `visibility: public` |
| 72 | Adding or changing a custom domain needs Zone > Workers Routes > Write on the zone, and later deploys that leave it unchanged need only Workers edit access | BK15, T9 | ✅ | [Cloudflare, Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/), "Routes and Custom Domains" |
| 73 | Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment | BK15, T9 | ✅ | [Cloudflare, system environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/) |
| 74 | Cloudflare's preview example checks `github.event.pull_request.head.repo.full_name == github.repository` before exposing credentials | BK15, T9 | ✅ | [Cloudflare, Previews examples](https://developers.cloudflare.com/workers/previews/examples/): "Before exposing Cloudflare credentials, verify that `github.event.pull_request.head.repo.full_name == github.repository`" |
| 75 | Cloudflare documents deploying Workers from GitHub Actions with a token from the "Edit Cloudflare Workers" template, scoped down to one account | T9 | ✅ | [Cloudflare, GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) |
| 76 | `sdk-updates.yml` opens pull requests with verify results | BK18, T27 | ✅ | [AGENTS.md](../../../AGENTS.md) layout: it "opens one pull request per harness with its verify result" |
| 77 | The owner picked direction C's layout, C4's page colours in both modes, C1's code and figure panels, and Instrument Serif, Literata and Google Sans Code | BK12, T2 | ✅ | Owner's decision, 2026-11-19, with every hex value as given. The reference board is the owner's private design canvas page, cited but not opened |
| 78 | Code in prose must resolve to a listing, a transcript or a pinned `.d.ts`, or carry a hand-checked marker citing a fact-check row, and the build fails otherwise | BK17, T26 | ✅ | Owner's decision, 2026-11-19 |
| 79 | CI never calls providers; a hand-started workflow with the owner's key in a protected environment compares live flows, and a difference opens an issue | BK18, T27 | ✅ | Owner's decision, 2026-11-19 |
| 80 | The owner approved vendoring the anatomy skill at `1482e84` | BK10, T7 | ✅ | Owner's answer, 2026-11-19: "yes" |
| 81 | Code derived from the garment repository is published under Apache-2.0, not Apache-2.0 OR MIT | BK16, ADR 0053, T1 | ✅ | Owner's answer, 2026-11-19: "Apache 2.0". This answers the question row 59 left open |
| 82 | The owner sets up the Cloudflare zone, the GitHub environments, their protection rules, the tokens and the secrets | BK2, BK15, T9, risk 5 | ✅ | Owner's answers, 2026-11-19: "we'll set this up" and "We'll set up gh actions with cloudflare" |
| 83 | The plan is not yet approved; the owner wants a review first, including a check that the outline covers every part of building an agent | Plan status | ✅ | Owner's answer, 2026-11-19 |
| 84 | `docs/design/book-tokens.json` records the BK12 colours and their contrast: light text 14.70, soft 9.73, muted 7.22, accent 4.80, link 7.32; dark text 13.62, soft 10.02, muted 6.94, accent 7.63; panel text 15.46, comment 6.59, amber 9.12, terracotta 5.93, olive 12.02; rules 1.30 and 1.39 | BK12; T2 | ✅ | Computed with the WCAG 2.x relative-luminance formula from the hex values in the file, 2026-11-19; matches row 67 for the lowest pairs |

## Third pass: the coverage review and the owner's rules of 2026-11-19

These rows check the claims added for the revised outline (§4), BK1 and BK18–BK22, the AGENTS.md rule, and todos T10–T39 and U18–U21. Each finding of the owner's coverage review that the plan acts on was checked against its cited file or URL first. Web pages were read on 2026-11-19.

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 85 | T24 names the seven seams of ADR 0033 plus `EffectStore` from ADR 0043 | BK19, T24 | ✏️ | Row 52 and the first outline said "eight portable seams" while citing sources that say seven: ADR 0033 line 13 ("the same seven seams") and the portable agents report's title ("Seven seams let our harness deploy anywhere"). ADR 0043 adds `EffectStore`. Corrected in T24 |
| 86 | After a rollback the model gets one of four failure outcomes, and SG3's five add `applied` on success | BK19, T23 | ✏️ | Row 51 and the first outline said "the five outcomes" without reconciling. The server rollback report's heading (line 68) says "one of four outcomes"; SG3 and the sagas report (line 106) say five. T23 now states both and how they relate |
| 87 | Anthropic recommends "finding the simplest solution possible, and only increasing complexity when needed", separates workflows ("predefined code paths") from agents, and names five workflow patterns | BK1, T10, T17 | ✅ | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer |
| 88 | Agents use about 4× the tokens of chat and multi-agent systems about 15×; Anthropic's judge was one LLM call scoring 0.0–1.0 with a pass-fail grade, on a starting set of about 20 queries | T17, T25 | ✅ | [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system): "about 4× more tokens", "about 15× more tokens", "scores from 0.0-1.0 and a pass-fail grade", "about 20 queries" |
| 89 | OpenAI's guide says to prototype with the most capable model and then try smaller ones, and lists guardrail types from relevance and safety classifiers to tool safeguards and rules-based protections | T11, T14, U21 | ✅ | [A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf), read with `pdftotext`: "build your agent prototype with the most capable model … try swapping in smaller models"; its guardrail table |
| 90 | OWASP's 2025 list has LLM01 Prompt Injection, LLM06 Excessive Agency and LLM08 Vector and Embedding Weaknesses | T14, T22, T36, U18 | ✅ | [OWASP Top 10 for LLM applications](https://genai.owasp.org/llm-top-10/) |
| 91 | MCP 2026-07-28 adds multi round-trip requests (`input_required`) and `server/discover`, deprecates Roots, Sampling, Logging and dynamic client registration, and asks for a deterministic `tools/list` order to improve prompt cache hits | BK19, T18, T21 | ✅ | [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog): major changes 3 and 7, minor change 3, deprecated items 1 and 4 |
| 92 | Agent guide §5 says prompt injection "cannot be prevented, only contained", names the lethal trifecta, and says the outbound leg is the one to cut | T14, T22 | ✅ | `docs/guides/agent.md` lines 107–109 |
| 93 | Six of the eight capstones let the model choose whose customer record to read | T12 | ✅ | [Agent guide](../../guides/agent.md), opening paragraph |
| 94 | The OpenAI triage capstone has an input guardrail against prompt injection | T14 | ✅ | `verify/openai-agents-sdk/examples/09-triage-agent.ts` lines 3 and 32–33 |
| 95 | `copilot-sdk/00-sandbox.ts` calls itself a "Harness self-check, not an SDK behavior" | T22, T31 | ✅ | Its first line |
| 96 | `claude-agent-sdk/01-hello-agent.ts` is 16 lines and shows no stream or usage, while `vercel-ai-sdk/01-generate-text.ts` "returns the model's text and usage" | T11, T28 | ✅ | `wc -l` and each file's header |
| 97 | The on-topic examples the first outline left unused exist: `04-guardrails`, `03-permission-deny`, `09-long-term-store`, `04-sessions-state`, `08-streaming` and `02-sql` | §4 | ✅ | `ls` of each path |
| 98 | Tool search in the Claude Agent SDK defers MCP tools by default, and the SDK exposes `skills` | T30 | ✅ | [Claude Agent SDK reference](../../reference/claude-agent-sdk/guide.md) lines 122 and 225 |
| 99 | The harness plan's HD3 revision makes the request view append-only for signed thinking, because Anthropic models run a prefix check | T11, BK19 | ✅ | `docs/plans/build-harness.md`, HD3's plan-review-2 revision |
| 100 | The SDK guide says reasoning signatures are valid only for the model that produced them, so a cross-provider replay drops them | T18 | ✅ | `docs/guides/agent-sdk.md` line 39 |
| 101 | The 12-factor report names ingress as the one gap it exposes | T24 | ✅ | [Report title](../../research/external-designs/twelve-factor-agents.md) and its factor 11 row |
| 102 | The main report has the section "Planning should start as ReAct and earn every extra agent", and calls external state artifacts the most effective memory for long-running work | T17, T20, U18 | ✅ | `docs/research/agent-sdks-and-harness-design.md` lines 107 and 111 |
| 103 | The browser-use report has a watch-and-take-over section and a section making the network and the credential the boundary; the agent UI research says every agent UI projects one sequenced event log | T35 | ✅ | `docs/research/browser-use/browser-use.md` headings at lines 116 and 146; `docs/research/agent-ui/agent-ui-research.md` line 12 |
| 104 | The highest research todo is U17, on `main` through #36 (`ea70a57`), so the next free IDs are U18–U21 | BK19 | ✅ | `docs/todos/done/` on `main` at `ea70a57`; row 133 records the correction |
| 105 | MAP found that "70% rely on prompting off-the-shelf models instead of weight tuning" | U21 | ✅ | The U17 [source-update report](../../research/source-update-2026-11-19.md), line 26, quoting [arXiv 2512.04123](https://arxiv.org/abs/2512.04123); a secondary reading of the paper's abstract, so U21 rereads the paper |
| 106 | The OpenAI TypeScript SDK lacks the voice pipeline, and the harness pins `@openai/agents-realtime` 0.21.0 | U20 | ✅ | [TypeScript gaps](../../comparison/typescript-gaps.md) heading; `verify/openai-agents-sdk/package.json` |
| 107 | A2A's latest released version is 1.0.0 | U19 | ✅ | [A2A specification](https://a2a-protocol.org/latest/specification/): "Latest Released Version 1.0.0" |
| 108 | The chapter and section todos plan 61 analogies, every analogy and every concept distinct | BK22, §4 | ✅ | A script over the todos' analogy tables |
| 109 | Each of the six opening types opens three of the eighteen chapters, and no two consecutive chapters share one | BK22, §4 | ✅ | Computed from the reading order in §4 |
| 110 | The owner set the Part I arc, the four topic groups, new `verify/` examples, the per-section fact-check rule, the voice and analogy rules, and the live run's keys and cost cap | BK1, BK18–BK22, AGENTS.md | ✅ | The owner's decisions and quoted words, 2026-11-19 |

## Fourth pass: the live run's keys and which harnesses can use them

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 111 | The live run uses both providers: the owner briefly chose Anthropic only, then added the OpenAI key | BK18, T27 | ✅ | Owner's answers, 2026-11-19: "actually, we'll only be using the ANTHROPIC_API_KEY", then "I'll add the OPENAI key too - added" |
| 112 | The harness-to-provider map in BK18: Claude Agent SDK on Anthropic natively; OpenAI Agents SDK on OpenAI natively, with no Anthropic provider pinned; Copilot SDK on either through BYOK with no GitHub sign-in; AI SDK, Cloudflare Agents and LangChain on either through pinned provider packages; Pi on either through pi-ai; Google ADK on neither | BK18, T27 | ✏️ | `verify/*/package.json` pins: `@ai-sdk/anthropic` 4.0.96 and `@ai-sdk/openai` 4.0.108 (AI SDK, Cloudflare), `@langchain/anthropic` 1.6.0 and `@langchain/openai` 1.8.0, `@openai/agents-openai` 0.21.0 with no Anthropic package, `@earendil-works/pi-ai` 1.5.2 whose `index.d.ts` exports Anthropic Messages and OpenAI Responses and Completions APIs. [Copilot reference](../../reference/copilot-sdk/guide.md): BYOK sends calls to "OpenAI, Azure or Anthropic endpoints" and "bypasses GitHub Copilot authentication entirely"; the harness's mock already uses `type: "anthropic"`. [ADK reference](../../reference/google-adk/guide.md): TypeScript 2.5.0 lacks the LiteLLM connector, and models resolve to the built-in Gemini class. The request's examples put the Copilot SDK among harnesses with no path; the references show BYOK reaches both providers, so the map says so |
| 113 | The GitHub environments `book-preview`, `book-production` and `live-run` exist, and `live-run` holds `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` | BK18, T9, T27 | ✅ | The coordinator listed secret names only, not values, on 2026-11-19. Their protection rules were not checked, so T9 and T27 check them by name before the first deploy and the first live run |

## Fifth pass: the Cloudflare tokens and the separate centrepieces

Cloudflare pages were read on 2026-11-19.

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 114 | The Cloudflare secrets are not yet in `book-production` or `book-preview` | BK15, T9 | ✅ | The coordinator's listing of secret names, 2026-11-19 |
| 115 | Workers Editor can read, update, deploy and rename existing Workers but cannot create or delete them, and creating a Worker needs Workers Admin; API tokens can be scoped to one Worker | BK15, ADR 0052, T9 | ✅ | [Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/): "Cannot create or delete Workers"; "Creating a new Worker requires Workers Admin because per-Worker permissions can only apply to Workers that already exist" |
| 116 | Changing a custom domain needs Zone › Workers Routes › Write on the zone, custom domains do not yet support per-Worker roles, and a deploy that leaves the domain unchanged needs only Editor | BK15, T9 | ✅ | Same page: "*Zone* > *Workers Routes* > *Write*, scoped to each affected zone"; "Custom Domains do not currently support per-Worker roles. Support is planned"; "you can deploy new Worker versions with only `Editor` access, as long as the deployment does not add, update, or remove that connection" |
| 117 | Wrangler needs an account-owned API token to use granular permissions | BK15, T9 | ✅ | [Cloudflare, authorization](https://developers.cloudflare.com/workers/authorization/): "To use granular permissions with Wrangler, authenticate with an account-owned API token" |
| 118 | Cloudflare's GitHub Actions guide uses the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and advises scoping the token as much as possible | BK15, T9 | ✅ | [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/): "We recommend scoping these down as much as possible" |
| 119 | The first token table named "Account > Workers Scripts > Edit" for both tokens | BK15 | ✏️ | Replaced with Cloudflare's current role names: Account › Workers › Editor for both, plus Zone › Workers Routes › Write on the zone for production only, and a one-time Admin step to create the Worker (rows 115–117) |
| 120 | The isometric centrepieces stay exact technical diagrams, and the ticket rail and the glovebox become separate flat analogy illustrations placed before them | BK10, BK22, T7, T10, T22 | ✏️ | The owner's decision, 2026-11-19: "keep them separate". The previous pass had the two centrepieces double as analogy illustrations; BK10, BK22, T7, T10 and T22 now follow the decision |

| 121 | Dark-mode links use `#F2C2A4`, 10.05:1 on the dark page; links are underlined in both modes | BK12; T2; `docs/design/book-tokens.json` | ✅ | Owner's answer, 2026-11-19 ("we'll go with A"); ratio computed with the WCAG 2.x formula; link vs body text 1.35:1, below 3:1 |

| 122 | The owner approved the 61 proposed analogies as they stand | BK22 | ✅ | Owner's answer, 2026-11-19 ("analogies are okay") |

## Sixth pass: the rebase onto `main`, theme-following panels and the DS3 deploy split

This pass rebased the plan onto `main` at `ea70a57`, after #35 (`dc2fdb5`) and U17. Claims about #35 were read from `docs/plans/publish-and-docs.md` and the L todos at that commit.

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 123 | The light panel's colours on `#F3EADB` reach: text 13.59, comment 5.45, amber 5.50, olive 6.03, terracotta 5.32; the dark panel's on `#17110D`: text 15.46, comment 6.59, amber 9.12, olive 12.02, terracotta 5.93; the light panel sits 1.08:1 from the page, and both grid colours reach 1.11:1 | BK12, T2, `docs/design/book-tokens.json` | ✅ | Recomputed with the WCAG 2 relative-luminance formula from the hex values; every figure matches the owner's, and the file records each ratio |
| 124 | `book-preview` and `book-production` each hold `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; `book-production` and `live-run` allow only protected branches (`main`); `live-run` has the owner as required reviewer | BK15, BK18, T9, T27 | ✏️ | The coordinator's API reads, 2026-11-19, of secret names and environment rules only. Row 114's "not yet" is superseded, and T27's pre-run check now confirms the reviewer instead of listing it as pending |
| 125 | Code and figure panels follow the theme: a light panel one shade darker than the page in light mode, C1 Ember in dark mode | BK12, T2, T6, T7 | ✏️ | The owner's decision, 2026-11-19: "approved those colors" (canvas board "Panels that follow the theme: light and dark"). It replaces BK12's earlier "C1 Ember in both modes" |
| 126 | #35 took ADRs 0047–0050, so the book's ADRs are 0051–0053 | ADR index, plan, todos | ✏️ | `docs/decisions/` on `main` at `ea70a57` has 0047–0050 from #35; the book's three records, first drafted as 0047–0049, are renumbered and every reference updated |
| 127 | DS3 splits each site into a build workflow on `pull_request` and pushes to `main` with no secrets that uploads `dist/`, and a deploy workflow on `workflow_run` that GitHub runs from `main`, takes `wrangler.toml` from `main`, never runs the pull request's code, deploys production only for a push to `main` from this repository, and finds the pull request from `head_sha` | BK15, T8, T9 | ✅ | [publish-and-docs.md, DS3](../publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted) |
| 128 | #35's owner setup grants the token "Workers Scripts edit and Zone Workers Routes edit", says "L8 confirms" the permissions, and names the secrets without an environment | BK15 | ✅ | [publish-and-docs.md §3](../publish-and-docs.md#3-what-the-owner-sets-up), item 3 |
| 129 | `apps/docs` pins Astro 7.4.11, and DS2 has `pnpm-workspace.yaml` add `apps/*` | BK4, T1 | ✅ | [DS1](../publish-and-docs.md#ds1-starlight-docs-with-a-generated-api-reference-accepted) and [L5](../../todos/ready/L5-docs-app.md); [DS2](../publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted): "`pnpm-workspace.yaml` adds `apps/*`" |
| 130 | Starlight uses Pagefind for its search | BK4 | ✅ | `npm view @astrojs/starlight@0.42.10 dependencies` lists `pagefind` `^1.5.2` and `@pagefind/default-ui` |


## Seventh pass: the first code review of #37

The first code-review round (high) on pull request #37 confirmed 19 findings. These rows check each claim a fix added or changed.

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 131 | The three listing tiers, and live editing as a later fourth, are the owner's decision, so BK9 is Accepted and only its mechanism is Proposed | BK9 | ✏️ | The owner's addition of 2026-11-19 set the tiers; BK9 had been marked Proposed throughout |
| 132 | A flow difference in the live run opens an issue and never fails CI | BK18 | ✅ | The owner's decision of 2026-11-19, already in T27's risks; BK18's accepted paragraph now says it too |
| 133 | U17 is on `main` through #36 (`ea70a57`), not only on `docs/research-source-update` | BK19, T21, U21, rows 104–105 | ✏️ | `docs/todos/done/U17-research-source-update.md` and `docs/research/source-update-2026-11-19.md` exist on `main` at `ea70a57`; the plan, row 104, row 105 and the two todos now link the merged report |
| 134 | T1 adds the Apache-2.0 exception to LICENSE; this branch does not change LICENSE | ADR 0053 | ✏️ | `git diff main -- LICENSE` is empty; the ADR had said LICENSE "records the exception" |
| 135 | `apps/` holds the docs and website too, and whichever of L5, L7 or T1 lands first adds `apps/*` | ADR 0051 | ✏️ | [ADR 0049](../../decisions/0049-two-sites-on-cloudflare.md) and [DS2](../publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted); ADR 0051 had called the book the folder's first entry and had T1 add `apps/*` |
| 136 | T8 writes `book-build.yml` rather than adding a job to `ci.yml` | ADR 0052 | ✏️ | BK14 and T8 since the sixth pass |
| 137 | Cloudflare recommends `wrangler.jsonc` for new projects, and some newer Wrangler features need a JSON config | BK15, ADR 0052, T9 | ✅ | [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/): "Cloudflare recommends using `wrangler.jsonc` for new projects, and some newer Wrangler features will only be available to projects using a JSON config file" |
| 138 | DS3's sites set `not_found_handling = "404-page"`, `workers_dev = false` and `preview_urls = true`, and a new Worker's `preview_urls` starts from its `workers_dev` value | BK15, T9 | ✅ | [DS3](../publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted); row 42 |
| 139 | Every pull request, a fork's included, gets a preview, because the deploy workflow never runs pull-request code | T9 | ✏️ | T9's goal still said only same-repository branches get previews; BK15, row 127 and DS3 say forks do |
| 140 | The owner replaced two analogies: compaction becomes "a TV show's 'previously on' recap" and the unknown outcome becomes "a dropped phone order" | BK22, T20, T23 | ✅ | Owner's answers, 2026-11-19; the desk stays with the context window and the parcel's tracking history with tracing |
| 141 | `@openai/agents` 0.21.0 has `computerTool`, a `Computer` type and `Agent.asTool()`, and `@ai-sdk/anthropic` 4.0.96 declares `computerToolset_20260801` | T40, T42 | ✅ | `verify/openai-agents-sdk/node_modules/@openai/agents-core/dist/` (`computerTool`, `type Computer`, `agent.d.ts` line 404); `verify/vercel-ai-sdk/node_modules/@ai-sdk/anthropic/dist/index.d.ts` |
| 142 | No `verify/` harness pins a browser driver | BK20, T40 | ✅ | No `verify/*/package.json` names `playwright` or `puppeteer` |
| 143 | After the two replacements the chapter and section todos still plan 61 analogies, every one distinct | BK22 | ✅ | The same script as row 108, rerun |
| 144 | ADR 0053's status is Accepted, a value the decisions README allows, and the file list stays a Proposed part of the plan's BK16 | ADR 0053, BK16 | ✏️ | [Decisions README](../../decisions/README.md), "Status"; the ADR had a split status |

**Totals:** 144 claims: 126 ✅, 18 ✏️, 0 ⚠️.
