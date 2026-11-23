# 0059. Make the manual installable and readable offline with a per-build service worker

- **Status:** Accepted (owner, 2026-11-23, on [issue #175](https://github.com/laudebugs/buildanagent/issues/175))
- **Date:** 2026-11-23
- **Plan:** [Book plan §1](../plans/build-book.md#1-goal-and-non-goals) (the reversed non-goal); todos [T67a](../todos/done/T67a-manual-offline-pwa.md) and [T67b](../todos/ready/T67b-manual-save-for-offline.md)

## Context

The book plan kept an offline service worker out of scope, because the owner's garment book needed its own build script and offline test for one. [The research report on offline reading](../research/book/offline-reading-and-caching.md) found that the deployed Worker revalidates every file but the hashed ones under `/_astro/` before each reuse, so a chapter fails to load when that check fails. The report offered three options, and on 2026-11-23 the owner chose the third: a reader should be able to install the manual and open it with no connection. That choice reverses the non-goal, and this record sets out how the worker stays safe on a public site and correct across deploys.

## Decision

The manual gets a web app manifest, icons drawn from the favicon, an offline page and a service worker at `/sw.js` that stores only the files of the build it came with.

- **One cache per build, checked byte for byte.** After Pagefind, `scripts/offline-build.mjs` lists every file of `dist/` with its size and SHA-256 in `/offline-manifest.json`, and leaves out `_headers`, `sw.js`, the list itself and `404.html`. It bundles `src/offline/sw.ts` with esbuild into one classic script, `/sw.js`, with the list and the build's id, the first 16 hex digits of a hash over the list, stamped above it. The worker names its cache `manual-<id>` and stores a response only when the request is a same-origin GET for a listed path and the response is a 200 of type `basic`, not redirected, with no `Set-Cookie`, no `Vary: *`, no `no-store` or `private`, and the listed size and hash. A cache key is the origin and path alone, so a query string or fragment can never select another entry. Because every changed file changes the list, every deploy changes the worker's bytes, which is what makes a browser install it as an update.
- **The shell on install, the rest on request.** The worker saves the home page, the offline page and the search page with every stylesheet, script, font, icon and manifest they link. Install fails, and the old worker keeps serving, if any shell file is missing or is not this build's. Pages a reader opens are saved as they arrive when their bytes match. Saving the whole book is the reader's choice through T67b's control, because a first visit should not spend about 5 MB of a reader's data unasked.
- **Pages network-first, assets from the same build.** A page comes from the network unless the network fails or takes more than 3 seconds; then the saved copy shows, or the offline page for a page that is not saved. A slow network with nothing saved is waited for. Hashed files (`/_astro/`, Pagefind's index and fragments) come from the cache first. Any other asset comes from the network first, unless its page came from the cache or matched the list, and then from the cache first. A page and its assets therefore come from one build. The brief proposed stale-while-revalidate for unhashed assets, but it would serve an old build's script under a new build's page, so the worker does not use it.
- **Updates wait for the reader.** The worker never calls `skipWaiting()` by itself. A new build's worker installs, carries over every saved file whose bytes are unchanged, and waits. `public/scripts/offline.js` then shows "A new version of the manual is ready" with Reload and Not now. Reload sends `{ type: "SKIP_WAITING" }`, and the page reloads only after the new worker takes control. The new worker deletes older `manual-` caches when it activates, never before.
- **Production host only.** The layout writes the hosts that may register the worker into `<meta name="manual-offline-hosts">`, from the Astro config's `site`. Any other host, a preview at `pr-<n>.manual.buildanagent.fyi` included, registers nothing and removes a worker and `manual-` caches that an earlier visit left. A build may add one host through `MANUAL_OFFLINE_TEST_HOST`, which accepts only `127.0.0.1` or `localhost`, so the browser check can run on loopback and no setting can add a host that serves readers.
- **Headers.** `_headers` adds `manifest-src 'self'` to the policy, because `default-src 'none'` would block the manifest. It sends `/sw.js` and `/offline-manifest.json` with `Cache-Control: no-cache`, and the manifest as `application/manifest+json`. The worker sits at the root, so it needs no `Service-Worker-Allowed` header. The policy's `worker-src 'self'` already covers it, and every script stays a same-origin file.

The page and the worker speak a small message protocol. A reply goes to the message's `MessagePort` when the page sends one, and otherwise to the sending page:

| Message | Sent by | Reply |
| --- | --- | --- |
| `{ type: "STATUS" }` | any page | `{ type: "STATUS", build, total: { files, bytes }, saved: { files, bytes }, shell: { files, saved } }` |
| `{ type: "SKIP_WAITING" }` | the update notice's Reload | none; the waiting worker activates and the page reloads on `controllerchange` |
| `{ type: "SAVE_ALL" }` | T67b's control | `{ type: "UNSUPPORTED", request: "SAVE_ALL" }` until T67b saves every listed file and reports progress |
| `{ type: "REMOVE_ALL" }` | T67b's control | `{ type: "UNSUPPORTED", request: "REMOVE_ALL" }` until T67b deletes the saved copy |

The worker ignores any other message and any message from another origin.

## Consequences

- **Cost.** The build gains a step, and `esbuild` 0.28.2, already in the lockfile through `packages/agent-safety`, becomes a dependency of the manual. Forty-one tests cover the worker's rules, the registration script, the icons and manifest, and a fixture build through the offline step. `scripts/offline-browser-check.mjs` drives the worker in Chromium offline. It is not part of `pnpm test`, because it needs a browser.
- **Stale caches.** A reader who never presses Reload keeps reading the old build until every tab of the book closes, which is how a waiting worker behaves. A saved page that a deploy changed is gone from the new cache until the reader opens it again or saves the book in T67b.
- **Storage.** Browsers may evict a site's storage under pressure, and Safari may evict it after a period without use, so an offline copy is a convenience, not an archive. T67b tells the reader so.
- **Changing the icons.** An edit to `public/favicon.svg` fails the icon test until `pnpm --filter @buildanagent/manual icons` draws the icons again.
- **Rollback.** To withdraw the feature, ship a `/sw.js` that deletes every `manual-` cache and unregisters itself on activate, and remove the registration from the layout. Browsers check `/sw.js` for updates on every navigation to the book, so returning readers pick it up on their next visit. Deleting `/sw.js` alone is not enough, because a browser keeps an installed worker when its update check fails.
