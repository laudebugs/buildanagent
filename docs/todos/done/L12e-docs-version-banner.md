# L12e: Show the docs version, the unreleased banner and a "Docs for main" link

| Field | Value |
| --- | --- |
| ID | `L12e` |
| Status | `done` |
| Plan | [Publish and docs DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs) |
| Depends on | [L12](../ongoing/L12-docs-redesign.md) (L12b, merged) |
| Size | S |

## Goal

The docs header shows the SDK's version, read at build time. A small script shows an "Unreleased docs for main" banner when the page is served from a host that begins with `next.`, and nowhere else. A "Docs for main" link stands in for a version switcher. A test keeps every install line on the `@alpha` tag while only alphas exist.

## Context

- [DS4](../../plans/publish-and-docs.md#ds4-the-docs-follow-main-until-010-then-releases-accepted) and the versioning design in DS5: `docs-deploy.yml` builds `main` once and deploys that build to either host, so the build cannot know its host, and the banner is a runtime hostname check, not a build flag.
- The owner decided on 2026-11-22 that the first stable release, and so the switch to `next.docs.buildanagent.fyi`, waits until the harness work is finished. Today `docs.buildanagent.fyi` serves `main` and `next.` is unused, so the banner must stay hidden now and appear on `next.` after the switch.

## Scope

**In scope**

- The version tag from `packages/sdk/package.json` at build time.
- The hostname-checking banner script, with tests for `docs.`, `next.`, `localhost` and preview hosts, and a statement of how `noindex` is handled.
- The "Docs for main" link.
- A strict install-line test: every install line names `@alpha` while only alphas exist.

**Out of scope**

- Any `.github/workflows` edit, a CSP file (L12m) and a version switcher.

## Tasks

- [x] Read the version at build time and show it in the header.
- [x] Write the banner script and its tests.
- [x] Add the "Docs for main" link.
- [x] Write the install-line test.
- [x] Update `apps/docs/README.md`.

## Acceptance criteria

- [x] No banner shows on `docs.buildanagent.fyi`, `localhost` or a preview host, and it shows on `next.` hosts.
- [x] The header shows the SDK's version.
- [x] A test fails on an install line without `@alpha`.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

`apps/docs/test/`, reading the built site with `builtSite()`.

## Docs to update

`apps/docs/README.md` and the L12 umbrella todo.

## Outcome

- The header shows the SDK's version beside the wordmark (`src/version/version.ts`, `SiteTitle.astro`). The tag stays outside the home link, and below 30rem it is hidden to the eye and kept for screen readers.
- A `Banner` override (`Banner.astro`) holds a hidden, `role="note"` banner and one static module script that un-hides it. The only decision is `showsUnreleasedBanner(hostname)` in `src/version/banner.ts`: the lower-cased host, without one trailing dot, begins with `next.`. So `next.docs.buildanagent.fyi` and `next.localhost` show it, and `docs.buildanagent.fyi`, `localhost`, `127.0.0.1`, workers.dev previews, `nextdocs.example` and an empty host do not.
- The footer links "Docs for main" to `https://next.docs.buildanagent.fyi/` only once the SDK is stable (`mainDocsLinkFor(SDK_VERSION)` in `src/chrome.ts`, which uses the install rule's stable switch), so no page links to a host that has no deploy today. The link is one static link on every host, kept outside `siteLinks`.
- `next.` stays out of search engines through the `X-Robots-Tag: noindex` header that `site-stage-dist.mjs --noindex` writes; the build adds no robots meta tag, and a test requires that. The scripts are unchanged.
- `test/install-lines.test.ts` applies the install-line rule to every docs source page and built page: `@alpha` on every package while the SDK's version has `-alpha.`, no `@alpha` once it is stable.
- Tests: `banner.test.ts`, `install-lines.test.ts` and `version-built.test.ts`. Changing the host rule, removing the `hidden` attribute or dropping `@alpha` from an install line each failed them.
- Review fixes (PR #392): `Banner.astro` styles `.unreleased-banner` itself from `--sl-*` tokens, because Starlight scopes its banner rules to its own component; the pair is measured in `pairs.ts`. The install-line rule now reads only a command's own arguments, keeps subpaths whole, joins backslash continuations, knows `pnpm i`, `pnpm install`, `npm add`, `yarn dlx`, `bun add` and `bunx`, and throws for a prerelease other than `-alpha.`. The README names the banner's layout shift on `next.` as a known limitation: a synchronous head script would fix it but would break the one-hash CSP design, and `next.` is not live.
- Second review fixes (PR #392): the rule now joins a backslash continuation in built HTML, where Expressive Code ends each line with two block ends. It checks a package with any `@` suffix, so a range (`@^0.1.0`, `@~1`, `@>=0.1`, `@*`) and a pinned `-alpha.N` version fail the alpha rule while a range passes the stable rule. `textOfHtml` strips tags with a quote-aware pattern, because Expressive Code leaves `>` unescaped inside the copy button's `data-code`. The version-tag test normalises whitespace. The README now states that the banner's text is in every page's HTML.
