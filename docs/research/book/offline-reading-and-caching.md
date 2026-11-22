# The book already loads from Cloudflare's cache, and a service worker would add offline reading at the cost of a reversed non-goal

[Issue #175](https://github.com/laudebugs/buildanagent/issues/175) asks whether the owner wants to reverse the book plan's decision that an offline service worker is out of scope ([book plan §1](../../plans/build-book.md)). The first question is what the reader wants. A book that stays readable on a flaky connection needs at most a header change. A book that opens with no connection at all needs a service worker, its own build script, an offline end-to-end test and an ADR. This report, as of November 2026, sets out what the deployed Worker already does, three options and a recommendation. The owner decides, and nothing here changes the plan.

## What a reader gets today

The book is an assets-only Worker, so Cloudflare serves every file without running Worker code ([Workers static assets](https://developers.cloudflare.com/workers/static-assets/)). It caches each file across its network and sends `Cache-Control: public, max-age=0, must-revalidate` by default ([headers](https://developers.cloudflare.com/workers/static-assets/headers/)). That header lets the browser keep a copy but requires a check with the server before each reuse, and the `ETag` on the file lets the check return a short "not modified" answer instead of the file. Our `apps/manual/public/_headers` overrides this for one path: files under `/_astro/` carry a content hash in their names and get `max-age=31536000, immutable`, so a browser reuses them for a year without any request.

On a flaky connection, then, the stylesheet, scripts and fonts load from the browser's cache, while each chapter page needs one round trip to confirm it is current. If that round trip fails, the page fails. Nothing in the repo shows how often that happens to readers, and the page sizes were not measured for this report.

## Three options

| Option | What it changes | What it costs | What a reader gets |
| --- | --- | --- | --- |
| A. Change nothing | Nothing | Nothing | Fast repeat visits on a working connection; a failed revalidation fails the page |
| B. Let pages be reused while stale | A `Cache-Control` rule for HTML in `_headers`, adding `stale-while-revalidate` and `stale-if-error` | A header change and a browser test | A cached chapter shows at once and refreshes in the background, if the browser honours the directives |
| C. Reverse the non-goal | A service worker that precaches the chapters, assets and search index | A build step that lists the files, an offline end-to-end test, an ADR, and a plan for stale caches | A chapter opens with no connection at all |

Option B has two limits. First, MDN defines `stale-while-revalidate` as reusing a stale response while it revalidates, and `stale-if-error` as reusing one when an upstream error or a local error occurs ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)). The page's compatibility table did not load for this report, so which browsers' HTTP caches honour the two directives on a page navigation is unverified, and a test in real browsers must answer it before the change ships. Second, `_headers` joins the values when two rules set the same header, so a new `Cache-Control` rule for pages must not also match `/_astro/*`, or that path would carry both values. The Cloudflare page shows a `! Cache-Control` line that detaches the earlier value before a rule sets its own.

Option C has a cost that the plan's own evidence already records: the garment book's hand-written service worker needed its own build script and offline test ([book plan §1](../../plans/build-book.md), row 29 of the plan's fact-check log). Our policy already allows a worker from our own origin (`worker-src 'self'` in `_headers`, which Pagefind needs), so the policy would not block it. Cloudflare also warns that the browser's check "does not keep related requests on one version or prevent version skew", and a service worker that holds old pages while new hashed files deploy would have to handle that.

## Recommendation

Ask the owner which was meant before building anything. If the aim is a book that stays readable on a flaky connection, leave the non-goal in place, try option B behind a browser test, and keep A if the test shows no gain. Reverse the non-goal, with an ADR, only if the owner wants chapters to open with no connection at all. This report leaves issue #175 open for that answer.
