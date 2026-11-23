# L12e: Show the docs version, the unreleased banner and a "Docs for main" link

| Field | Value |
| --- | --- |
| ID | `L12e` |
| Status | `ongoing` |
| Plan | [Publish and docs DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs) |
| Depends on | [L12](L12-docs-redesign.md) (L12b, merged) |
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

- [ ] Read the version at build time and show it in the header.
- [ ] Write the banner script and its tests.
- [ ] Add the "Docs for main" link.
- [ ] Write the install-line test.
- [ ] Update `apps/docs/README.md`.

## Acceptance criteria

- [ ] No banner shows on `docs.buildanagent.fyi`, `localhost` or a preview host, and it shows on `next.` hosts.
- [ ] The header shows the SDK's version.
- [ ] A test fails on an install line without `@alpha`.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

`apps/docs/test/`, reading the built site with `builtSite()`.

## Docs to update

`apps/docs/README.md` and the L12 umbrella todo.
