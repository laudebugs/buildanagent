# 0057. Keep each chapter's third-party listings, and add our SDK's as the first tab once it supports each feature

- **Status:** Accepted (owner, 2026-11-19); supersedes the listings rule in [ADR 0052](0052-book-in-apps-on-cloudflare.md)
- **Date:** 2026-11-19
- **Plan:** [build-book.md, BK8](../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted)

## Context

[ADR 0052](0052-book-in-apps-on-cloudflare.md) took its listings rule from the owner's first decision on code: listings come from `verify/*/examples` "until our own packages replace them chapter by chapter". When todo B11 landed, Chapter 1 became the first chapter whose `switchTo` todos were all done, and todo T50 had to choose. It could replace the chapter's AI SDK and ADK listings with ours, or keep them and add ours beside them. On 2026-11-19 the owner chose to keep them: "we'll add our SDK as functionality becomes available."

## Decision

- A chapter keeps every listing from a third-party SDK, such as the AI SDK, ADK or Pi, with its file, region, notes and replay.
- Once our SDK supports what a listing shows, the chapter turns that listing into a `:::tabs` block. Our SDK's listing is the first tab, and the third-party listing, unchanged, sits beside it.
- A listing our SDK cannot show yet stays a single listing until the feature lands. No chapter waits for all its features before gaining its first tab.

## Consequences

- ADR 0052's listings rule no longer applies; the rest of ADR 0052 stands. ADR 0052 keeps its text, as an accepted record must, and its status line names this record.
- Each chapter's `switchTo` lists the todos whose code its listings will gain as tabs. `book:switch-report` names a chapter ready for tabs on our own packages once those todos are done.
- [T50](../todos/ready/T50-chapter-call-workflow-loop-on-our-sdk.md) adds our tabs to Chapter 1 first. Every other chapter gains its tabs in a follow-up todo opened when its `switchTo` todos are done.
- Readers see the loop in the code the rest of the book builds on, and still see how two other SDKs write it.
