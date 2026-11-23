# T67b: Add a "Save the manual for offline reading" control

| Field | Value |
| --- | --- |
| ID | `T67b` |
| Status | `done` |
| Plan | [Build the book §1](../../plans/build-book.md) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | [T67a](../done/T67a-manual-offline-pwa.md) |
| Size | M (one control, its worker messages and its tests) |

## Goal

Give a reader a button that saves every page of the manual for offline reading, shows how big the download is, how far it has got, and when and at which build it was saved, and removes it again. It sits in the footer or the reading menu and works when storage is denied.

## Context

- [T67a](../done/T67a-manual-offline-pwa.md): the service worker, its offline manifest (path, size and hash of every file of a build) and the registration script this control talks to.
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

- [x] Claim the todo when T67a is done.
- [x] Write the copy and fact-check its claims (storage limits, eviction, which browsers support what, as of November 2026).
- [x] Add the worker's save, remove and status messages and the saved-copy cache.
- [x] Build the control, its states and its styles (tokens only, light and dark, a 44 pixel target).
- [x] Test it against a fake worker and cache, then with Playwright offline.

## Acceptance criteria

- [x] A reader can save the manual, see the progress and the size, go offline and read any chapter, the glossary and the search.
- [x] The control shows the saved date and build, and removing the copy clears the cache and the state.
- [x] A refused quota or a browser without a worker shows a plain message and breaks nothing.
- [x] The book's tests, `check:book`, the build and `pnpm check` pass.

## Tests

As above, beside T67a's tests.

## Docs to update

`apps/manual/README.md` and the research report's status line.

## Risks and open questions

- A saved copy may be evicted by the browser; the control rechecks the cache when it loads and shows "Not saved" if it was.
- Reader-facing copy about iOS Safari and install prompts must be fact-checked against current sources.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Done on 2026-11-23 ([ADR 0059, Saving the whole book](../../decisions/0059-offline-manual-service-worker.md#saving-the-whole-book-addendum-2026-11-23)). A reader saves the whole manual from a control in the footer of every page, watches a progress bar, and then sees "Saved on <date>, version <build>" and a Remove button. A save that stops early shows as partial, never as saved.

- **Where the control lives.** The footer, because every page has one, the offline page and the contents included, and saving concerns the whole book rather than the chapter on screen. The book has no reading menu.
- **The partial-save rule.** The worker writes its saved record in the build's own cache only once every listed file is stored. A full quota stops the save at once. A dropped connection, a file from a newer deploy or Cancel also leaves it partial, with the reason and Try again, and the next save skips the stored files. The record lives beside the files, so an evicted copy shows as not saved.
- **Security.** `SAVE_ALL` takes no paths and downloads only the build's list, six files at a time, through the existing store rules. Only the active worker saves or removes, so an update never downloads ahead of the reader's Reload. The worker ignores any message that is not from a tab or window of its own origin, frames and workers included. An old worker whose cache a newer activation deleted stops and writes no record.
- **Decisions beyond the brief.** The control reads its size from `/offline-manifest.json` when the list's build matches the worker's, and treats a different build as a new version to reload for. It does not call `navigator.storage.persist()`, because Firefox answers with a permission prompt and Safari grants it mainly to Home Screen web apps. Its live region speaks only for the reader's own presses and connection changes. STATUS's old `saved` counts are now `stored`, and `saved` is the saved copy.
- **A T67a gap, fixed.** A page an older worker stamped is a constructed response of type `default`, which the store rules refused, so a saved page carried over through one update but not two. A copy read back from the worker's own cache may now be of type `default`; its bytes are still checked. The new test fails without the fix.
- **Verification.** 30 tests cover the new work (`test/offline-save.test.ts`, `test/save-offline.test.ts`), and the existing offline tests pass. `scripts/save-offline-check.mjs` passed its 24 checks in Chromium, the 390 pixel iPhone 14 context included, and `offline-browser-check.mjs`, `touch-fields-check.mjs` and `notes-browser-check.mjs` still pass. The control has no text field, so the 16 pixel field rule has nothing to apply to. Nothing ran on a real iOS Safari or Firefox.
