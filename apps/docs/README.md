# @buildanagent/docs

The docs for `@buildanagent/gateway` and `@buildanagent/sdk`, built with Astro and Starlight for docs.buildanagent.fyi. The site is private and static: `pnpm --filter @buildanagent/docs build` writes it to `dist/`, and a broken internal link fails the build.

## Write a page that passes the tests

Pages live in `src/content/docs/`, and the explicit sidebar in `astro.config.mjs` names each one, in the order start, concepts, guides, testing, reference. `pnpm --filter @buildanagent/docs test` checks every page against [docs-writing.md](../../docs/guidelines/docs-writing.md):

- The first paragraph has 50 words or fewer, a sentence has 40 or fewer, and a paragraph has 100 or fewer.
- No todo, decision or round id, repository path or banned word appears, and headings are in sentence case.
- Each code block follows a sentence that introduces it. A block of more than five lines comes from a tested example, and a shorter inline block must type-check against the packages.
- Every page except the home page is in the sidebar and ends with a link to the next page.

## Show an example file

A fence with a `file` attribute takes its code from a file under a package's `examples/` folder, so the docs never show code that no longer runs. `region` picks a `// #region` of the file:

````md
```ts file="packages/sdk/examples/order-agent.ts" region="run"
```
````

The build replaces the fence's body with the region and titles the block with the file's name. A path outside an `examples/` folder, or a region that is missing, fails the build.

## The API reference is generated

TypeDoc writes a page for every export of the gateway and the SDK under `src/content/docs/reference/gateway/` and `reference/sdk/` each time Astro builds. The pages are not committed, and the tests skip them. The entry points come from each package's own `exports` map, so the reference matches what users import (`src/api/packages.ts`).

`pnpm check:api-docs` fails when an exported function, class, interface, type alias, variable or enum has no TSDoc, or a `{@link}` doesn't resolve. `pnpm test` runs the same check, so CI enforces it, and a test builds the site and requires a page for every export.

TypeDoc 0.28 reads TypeScript only up to 6.0, so this app pins TypeScript 6.0.3 for it, while the rest of the repo builds with TypeScript 7. Only TypeDoc should use the pin: any tool that resolves `typescript` from this app sees 6.0.3, so the `typecheck` script and the test that type-checks inline blocks resolve the repo root's TypeScript instead.

Each entry file names its module for its import path with an `@module` tag, so the reference shows `@buildanagent/gateway/anthropic`, not the path of a source file.

## Licence

The docs are CC BY 4.0 ([LICENSE-DOCS](../../LICENSE-DOCS)), and every page's footer says so.
