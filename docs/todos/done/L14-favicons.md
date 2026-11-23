# L14: Add the site's favicon to the manual and the docs

| Field | Value |
| --- | --- |
| ID | `L14` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-23) |
| Depends on | [L13](../done/L13-landing-page.md) |
| Size | S (one sitting) |

## Goal

Give the manual (manual.buildanagent.fyi) and the docs (docs.buildanagent.fyi) the favicon the landing page already ships, so all three sites show one icon in a browser tab. The owner asked for this on 2026-11-23.

## Context

- `apps/site/public/favicon.svg` and the `<link rel="icon">` in `apps/site/src/layouts/Base.astro`: the favicon and how the site links it. The site ships one SVG with a light and a dark colour set, and no PNG or Apple touch icon.
- [`apps/manual/public/_headers`](../../../apps/manual/public/_headers): the manual's content security policy, whose `img-src 'self'` covers an icon served from its own origin.
- `apps/manual/scripts/stage-dist.mjs` and `apps/manual/scripts/guard-deploy.mjs`, and their docs-site counterparts `scripts/ci/site-stage-dist.mjs` and `scripts/ci/site-guard-deploy.mjs`: the deploy checks that decide which files a build may upload.
- [L12](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the docs redesign owns the docs header and theme, and its follow-up reuses this todo's file, so the file name stays `favicon.svg`.

## Scope

**In scope**

- Copy `favicon.svg` byte for byte into `apps/manual/public/` and `apps/docs/public/`, under the same name as the site's.
- Link it from the manual's layout head with `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`.
- Set Starlight's `favicon` option in `apps/docs/astro.config.mjs`, and add a `head` link only if the option alone leaves one out.
- A test in each app that fails if the file or the link is missing, or if the file differs from the site's copy.
- The deploy checks accept the new file with no workflow change.

**Out of scope**

- A PNG or Apple touch icon: the site ships none, and the owner asked for the same files.
- Any other change to the docs design (L12) or the manual's layout.
- Editing anything under `.github/`.

## Tasks

- [x] Add the file and the link to the manual, with its test.
- [x] Add the file and the Starlight setting to the docs, with its test.
- [x] Check that the manual's and the docs' stage and guard scripts accept the file, and that `_headers` needs no change.
- [x] Check the icon at 16 and 32 pixels in a light and a dark colour scheme, and record how in the pull request.

## Acceptance criteria

- [x] Both built sites contain `/favicon.svg`, identical to the site's, and every built HTML page links it
- [x] The test in each app fails when the file or the link is removed
- [x] The stage and guard scripts pass on both builds with no `.github/` change
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`apps/manual/test/` and `apps/docs/test/`.

## Docs to update

The plan's todo table, and the manual's and the docs' READMEs if they list their `public/` files.

## Risks and open questions

- The SVG uses `prefers-color-scheme` inside the file, so a tab strip that doesn't pass the colour scheme to the icon shows the light colours.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [x] A `/code-review low` on the pull request, with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed

## Outcome

- Both apps ship `favicon.svg`, byte for byte the site's, and the manual's layout links it; each app has a test that fails when the file is missing or differs from the site's, and the manual's also fails when a built page lacks the link.
- Starlight already uses `/favicon.svg` as its default `favicon` and links it as `rel="shortcut icon"`, so the docs need only the file in `public/`; the explicit `favicon` setting is harmless but redundant, and the docs test cannot tell it from the default. The manual links it as `rel="icon"`, so the two sites use different `rel` spellings.
- The stage and guard scripts of both sites have no file-type allowlist and accepted real builds containing the file (manual: 92 files, docs: 595 files), so no script or workflow changed.
- At 16 pixels the outline and chevron stay legible and the underscore shrinks to a small dash in both colour schemes; the one risk is a tab strip that doesn't pass its colour scheme to the icon, which shows the light colours on a dark strip.
