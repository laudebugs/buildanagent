# Fact-check: the maintainability checks

This log checks the tool claims that todo Q2 makes on 2026-11-22 in [`maintainability.md`](../../guidelines/maintainability.md#how-its-checked), `.dependency-cruiser.json`, `.jscpd.json` and `knip.jsonc`. Each row records what the pinned tool did when it ran in this repository, because the tools' behaviour on TypeScript 7 is not in their documentation.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| Q2-1 | The four tools are pinned to releases at least a week old: dependency-cruiser 18.7.2, jscpd 5.4.3, knip 6.45.1 and @swc/core 1.16.22 | ✅ | The npm registry's publish times (`npm view <package> time`, read 2026-11-22): 2026-11-02, 2026-11-08, 2026-11-11 and 2026-11-05 |
| Q2-2 | dependency-cruiser 18.7.2 supports TypeScript up to 6 only, and without another parser it reads a handful of files and still passes | ✅ | Its own output on this repo: "typescript: >=2.0.0 <7.0.0 … Support for typescript@>=7 will follow when its API is published and stable", with "11 modules, 13 dependencies cruised" where the packages hold hundreds |
| Q2-3 | Setting `options.parser` to `swc`, with `@swc/core` installed, makes dependency-cruiser read the TypeScript sources | ✅ | The same command with the setting cruised 298 modules and 961 dependencies |
| Q2-4 | An import by package name resolves into another package's `src/` through our `source` condition, and only a relative import has the dependency type `local` | ✅ | Without `dependencyTypes: ["local"]`, the cross-package rule reported 79 violations, every one an import such as `@buildanagent/gateway`; with it, none, and a seeded `../../gateway/src/index.js` import failed |
| Q2-5 | jscpd's `ignorePattern` skips code that matches the pattern, which leaves import lists out of the clone count | ✅ | With the import pattern in `.jscpd.json`, the one remaining clone, two identical import lists, was gone and a seeded 14-line copy still failed |
| Q2-6 | knip's `ignoreExportsUsedInFile` leaves out an export that only its own file uses, while an export nothing uses still fails | ✅ | Without it knip reported 21 exports and types; with it, none on `main`, and a seeded unused file failed |
