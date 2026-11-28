# L12m: Serve a strict Content Security Policy for the docs site

| Field | Value |
| --- | --- |
| ID | `L12m` |
| Status | `done` |
| Plan | [Publish and docs DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs) |
| Depends on | [L12](../ongoing/L12-docs-redesign.md) (L12b has no todo file of its own), [L12l](../done/L12l-docs-markdown-twins.md) |
| Size | S to M |

## Goal

docs.buildanagent.fyi sends a Content Security Policy (CSP): a response header that tells the browser which scripts, styles and other files a page may load and run. The policy allows the docs' own files, allows each inline script by the hash of its exact text and states its one exception for `style=` attributes. The owner answered yes to question 9b, "Strict CSP", on 2026-11-26.

## Context

- [L12](../ongoing/L12-docs-redesign.md), the L12m row and its [amendments of 2026-11-25](../ongoing/L12-docs-redesign.md#amendments-to-the-sub-todos-2026-11-25): decide `style-src` in writing, limit the CSP line to 1,900 characters, and check the policy in a browser once L12y exists.
- [`apps/manual/public/_headers`](../../../apps/manual/public/_headers): the book's policy, which needs no hash because the book inlines nothing.
- [`scripts/ci/site-stage-dist.mjs`](../../../scripts/ci/site-stage-dist.mjs) and [`site-guard-deploy.mjs`](../../../scripts/ci/site-guard-deploy.mjs): the deploy writes main's `apps/docs/public/_headers`, never the artifact's, and the guard checks it ([CI plan §3g](../../plans/ci.md#3g-both-sites-deploy-to-cloudflare-with-a-preview-per-pull-request-l8-added-2026-11-22), [ADR 0049](../../decisions/0049-two-sites-on-cloudflare.md)).
- Cloudflare's [`_headers` documentation](https://developers.cloudflare.com/workers/static-assets/headers/) for Workers static assets: the format and the limits of 100 rules and 2,000 characters per line.

### Amendments copied from L12 (2026-11-25)

- **Decide `style-src` in writing.** Built pages carry `style=` attributes from Expressive Code and Starlight. A `style-src 'self'` policy needs each moved to a class, or the policy states its exception.
- **Limit the CSP line.** The build fails when the CSP line passes 1,900 characters. Confirm Cloudflare's 2,000-character limit in its docs first.
- **Check it in a browser.** Once L12y exists, one browser check loads a page and finds no CSP violation, coloured code and a working search.

## Scope

**In scope**

- `apps/docs/src/csp/`: the policy, derived from the built pages, and the build step that writes `dist/_headers`.
- `apps/docs/public/_headers`, committed, which the deploy serves, and the `headers` script that rewrites it.
- `apps/docs/test/csp.test.ts` and the README section.

**Out of scope**

- Any change to `.github/workflows/` or to the deploy scripts (see Outcome for what the owner may want).
- A browser check in CI, which L12y would add if the owner accepts it.
- Other security headers, such as `Strict-Transport-Security` and `X-Content-Type-Options`, which the book sends (a follow-up).

## Tasks

- [x] Check whether Astro 7 has its own CSP option (it does, `security.csp`, and this todo does not use it; see Outcome).
- [x] Measure what the built pages load and inline: scripts, styles, `style=` attributes, fonts, images, workers and fetches.
- [x] Confirm Cloudflare's `_headers` format and line limit, and that the deploy carries the file.
- [x] Write the policy module, the build step, the `headers` script and the committed file.
- [x] Decide `style-src` in writing.
- [x] Write the tests and the README section.
- [x] Check the policy in Chrome through `wrangler dev`.
- [x] Update the L12 umbrella, the plan's table and the fact-check log.

## Acceptance criteria

- [x] `apps/docs/public/_headers` sends the policy on `/*`, with `script-src` holding `'self'`, `'wasm-unsafe-eval'` and one hash per inline script, and no `'unsafe-inline'` for scripts.
- [x] The build writes `dist/_headers` from the built site and fails on an inline event handler, a `javascript:` URL, a `<style>` element in a page or a CSP line over 1,900 characters.
- [x] A served SVG that needs its own `<style>`, today only the favicon, gets a rule that detaches the site-wide policy and allows that style by hash.
- [x] The build also fails on a `<noscript>` in a page, an SVG `<set>` or `<animate>` that changes an `href`, a script in a served SVG or XML file (prefixed names included) and a policy source outside the allowlist.
- [x] A test fails on a stale committed file, a built inline script whose hash is missing, an unused hash and a CSP line over 1,900 characters.
- [x] The `style-src` decision and the reason for each directive are written in `apps/docs/README.md` and `src/csp/policy.ts`.
- [x] `pnpm check`, `pnpm typecheck` and the docs tests pass.

## Outcome

The docs now carry a CSP in `apps/docs/public/_headers`. The policy is defence in depth: it blocks an injected inline script, an event-handler attribute, a `javascript:` link and any file from another origin. Injected markup could still add a `style=` attribute and restyle part of a page.

**The policy as built on 2026-11-26.** The CSP line has 1,000 characters, 13 of them hashes. The value, without the hashes, is:

```text
default-src 'none'; script-src 'self' 'wasm-unsafe-eval' <13 hashes>; style-src 'self' 'unsafe-inline'; style-src-elem 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

`default-src` and `base-uri` are `'none'`, stricter than the brief's `'self'`, to match the book's policy. No page uses `<base>` or loads anything the list leaves out.

**The `style-src` decision: an exception for attributes only.** Starlight and Expressive Code write tens of thousands of `style=` attributes, such as `--depth` in the sidebar and `style="--0:#F2E8DC;--1:#2A1E16"` on code. Moving them to classes would mean rewriting Starlight's components or its HTML after every build. The policy therefore sends `style-src 'self' 'unsafe-inline'` with `style-src-elem 'self'`, and the build writes every stylesheet as a file (`build.inlineStylesheets: "never"`). A browser that knows `style-src-elem` allows inline styles in attributes only. The decision lives in the README and here, not in an ADR, because it follows Starlight's output and changes with it.

**The favicon has its own rule.** `favicon.svg` colours its strokes from a `<style>` element and must stay a copy of the site's icon. The site-wide `style-src-elem 'self'` would block that style when a reader opens the file. The build therefore writes a `/favicon.svg` rule that detaches the site-wide header (`! Content-Security-Policy`) and sets `default-src 'none'; style-src 'sha256-…'; frame-ancestors 'none'`. Through `wrangler dev`, Chrome then drew the opened file's strokes in colour with no violation.

**The first review's fixes.** The checks now read HTML with a small tokenizer (`src/csp/html.ts`), so code in a `data-code` attribute is never read as a tag. An unquoted attribute value follows HTML's rules. A script inside `<svg>` or `<math>`, or one that holds `<!--`, fails the build. A `javascript:` URL counts only in an attribute that holds a URL. The build also reads every served SVG and XML file.

**The later reviews' fixes.** The second review found offsets taken from `toLowerCase()`, which "İ" lengthens. The tokenizer now lower-cases ASCII letters only, so its offsets fit the original text. An SVG's style is hashed from the same CRLF-normalized text the tokenizer read, and a `/` inside an unquoted value no longer closes a tag. A `<noscript>` in a page fails the build, because its content is never checked, and so does an SVG `<set>` or `<animate>` that changes an `href`.

The third review made the source test an allowlist, run on the committed file. Only `'self'`, `'none'` and hashes may appear anywhere, plus `data:` in `img-src`, `'wasm-unsafe-eval'` in `script-src` and `'unsafe-inline'` in `style-src`. A served SVG's style now starts at the tag's own end, so a `>` in a quoted value cannot shift it, and a prefixed `<s:script>` or `<s:style>` counts as a script or a style. Tests cover each limit on the file: the CSP line, the 2,000-character line, the 100 rules and an unmatchable file name.

**Astro's own option was not used.** Astro 7 has `security.csp`, which adds a `<meta http-equiv="content-security-policy">` tag to each page. A `<meta>` policy cannot set `frame-ancestors`, and Astro's documentation says its CSP does not support Shiki's inline styles. The docs' deploy already serves a `_headers` file, so one header for every page is the simpler place.

**The deploy needed no change.** `site-stage-dist.mjs` already writes main's `public/_headers` into the staged site and `site-guard-deploy.mjs` checks it, so committing the file is enough. The artifact's own `dist/_headers` is never served. A local `wrangler dev` served the header on pages, on Markdown twins and on the 404 page, and did not serve `_headers` itself.

**Browser check.** Through `wrangler dev`, Chrome 158 reported no violation on five pages: the home page, a page with tabs and a figure, a quick start, a reference page and the 404 page. Code kept its colours, search returned results, tabs and the theme select worked, and an injected inline script and `<style>` were blocked. Playwright is not in the repository, so no test repeats this check.

**For the owner: previews and releases carry main's policy.** The deploy never trusts a pull request's `_headers`, so a preview uses main's. A pull request that changes an inline script therefore shows that script blocked on its preview until it merges. A stable release deploys its own commit's pages with main's `_headers`, so a script that changed on main after the release is blocked on the release's pages.

Two fixes would close the gap, and both need a deploy change, which this todo does not make: stage the release's `_headers` from its tag, or make the guard refuse a deploy whose pages carry a hash the policy lacks.

## Tests

`apps/docs/test/csp.test.ts`, with unit tests of the parser and a fresh build through `builtSite()`.

## Docs to update

- `apps/docs/README.md`: the new section and the two older mentions of this work.
- The [L12 umbrella](../ongoing/L12-docs-redesign.md): the L12m row, an "L12m progress" paragraph, question 9b and the Q4i row.
- The [plan's todo table](../../plans/publish-and-docs.md#4-round-l-and-its-todos).

## Risks and open questions

- **A Starlight upgrade changes the hashes.** The test fails until someone runs `pnpm --filter @buildanagent/docs headers` and commits the file.
- **The line limit.** 13 hashes take 1,000 characters, so about 16 more inline scripts fit before the build fails at 1,900.
- **No browser in CI.** A runtime violation that the static checks cannot see, such as a script that a page builds at run time, would go unnoticed until L12y or a manual check.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and the docs tests pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
