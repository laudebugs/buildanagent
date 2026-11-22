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

## Licence

The docs are CC BY 4.0 ([LICENSE-DOCS](../../LICENSE-DOCS)), and every page's footer says so.
