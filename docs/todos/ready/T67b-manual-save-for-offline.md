# T67b: Add a "Save the manual for offline reading" control

| Field | Value |
| --- | --- |
| ID | `T67b` |
| Status | `ready` |
| Plan | [Build the book §1](../../plans/build-book.md) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | [T67a](../ongoing/T67a-manual-offline-pwa.md) |
| Size | M (one control, its worker messages and its tests) |

## Goal

Give a reader a button that saves every page of the manual for offline reading, shows how big the download is, how far it has got, and when and at which build it was saved, and removes it again. It sits in the footer or the reading menu and works when storage is denied.

## Context

- [T67a](../ongoing/T67a-manual-offline-pwa.md): the service worker, its offline manifest (path, size and hash of every file of a build) and the registration script this control talks to.
- [`docs/research/book/offline-reading-and-caching.md`](../../research/book/offline-reading-and-caching.md): the cost and the stale-cache risk.
- [`apps/manual/public/scripts/`](../../../apps/manual/public/scripts): the book's other reader controls (`notes.js`, `reading.js`) show the pattern: a plain script, no inline code, tokens for colour.

## Scope

**In scope**

- The control: "Save the manual for offline reading", the build's total size from the offline manifest, `navigator.storage.estimate()` for the room left, a progress bar for the download, "Saved on <date>, version <build>", a "Remove the saved copy" button and a state shown while the browser is offline.
- The worker's side: a message to save all, a cache for the saved copy named by the build, a refresh of it when a new build is ready and the reader accepts the update, and an error report for a refused quota.
- Behaviour when storage is denied or the browser has no service worker: the control says so and does nothing else.
- Tests: the control's states against a fake worker, the worker's save and remove against a fake cache, and a Playwright check that a saved manual opens offline and the saved date and build show.
- Reader-facing copy drafted with the writing skill, with fact-check rows for every claim about browser behaviour.

**Out of scope**

- The service worker's base, the manifest and the icons (T67a).
- Chapter content.
- `.github/workflows/`.

## Tasks

- [ ] Claim the todo when T67a is done.
- [ ] Write the copy and fact-check its claims (storage limits, eviction, which browsers support what, as of November 2026).
- [ ] Add the worker's save, remove and status messages and the saved-copy cache.
- [ ] Build the control, its states and its styles (tokens only, light and dark, a 44 pixel target).
- [ ] Test it against a fake worker and cache, then with Playwright offline.

## Acceptance criteria

- [ ] A reader can save the manual, see the progress and the size, go offline and read any chapter, the glossary and the search.
- [ ] The control shows the saved date and build, and removing the copy clears the cache and the state.
- [ ] A refused quota or a browser without a worker shows a plain message and breaks nothing.
- [ ] The book's tests, `check:book`, the build and `pnpm check` pass.

## Tests

As above, beside T67a's tests.

## Docs to update

`apps/manual/README.md` and the research report's status line.

## Risks and open questions

- A saved copy may be evicted by the browser; the control rechecks the cache when it loads and shows "Not saved" if it was.
- Reader-facing copy about iOS Safari and install prompts must be fact-checked against current sources.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
