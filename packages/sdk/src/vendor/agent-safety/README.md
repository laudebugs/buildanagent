# A copy of four `@buildanagent/agent-safety` files

`errors.ts`, `hash.ts`, `outcome.ts` and `render.ts` are byte-for-byte copies of the same files in `packages/agent-safety/src/`. They give tool results their write outcomes, and the progress check its input hash, while the safety package is private: the published SDK cannot depend on a package that is not on npm, and the pack test installs the SDK where the safety package is absent.

`test/vendored-safety.test.ts` fails if a copy differs from its source, so edit the safety package and copy the files again. Once `@buildanagent/agent-safety` is published, delete this folder and import from the package's root export instead, as the SDK plan's dependency rule says.
