# 0048. Build the library docs on Astro Starlight, with the API reference generated from TSDoc

- **Status:** Accepted (owner, 2026-11-19)
- **Date:** 2026-11-19
- **Plan:** [publish-and-docs.md, DS1](../plans/publish-and-docs.md#ds1-starlight-docs-with-a-generated-api-reference-accepted)

## Context

The owner asked on 2026-11-19 for documentation for the libraries, and chose Astro Starlight, which Lamina PDF's docs use. ADR 0008 already requires a CI check that fails on an undocumented export, and our guidelines require reader-facing pages in plain English with code from tested examples.

## Decision

`apps/docs` builds the docs with Astro and Starlight. TypeDoc, through `starlight-typedoc`, generates the API reference from each package's exported TSDoc, and its `notDocumented` validation, with warnings as errors, is ADR 0008's undocumented-export check. Pages follow [docs-writing.md](../guidelines/docs-writing.md) and show code only from tested files under `packages/*/examples/`. The docs are CC BY 4.0, as all our documentation is.

## Consequences

- The docs app pins TypeScript 6.0.x for TypeDoc, which doesn't yet accept TypeScript 7.
- B20 keeps the README checks and `llms.txt`; the docs site and the undocumented-export check move to todos L5 and L6.
