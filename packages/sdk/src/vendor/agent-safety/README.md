# A copy of eight `@buildanagent/agent-safety` files

`bytes.ts`, `errors.ts`, `hash.ts`, `outcome.ts`, `pending.ts`, `render.ts`, `signer.ts` and `testing.ts` are byte-for-byte copies of the same files in `packages/agent-safety/src/`. They give tool results their write outcomes, the progress check its input hash, signed pauses their signers and pending record, and the testing export its fixed-key test signer, while the safety package is private: the published SDK cannot depend on a package that is not on npm, and the pack test installs the SDK where the safety package is absent. The SDK re-exports the signers, the hash, the pending-record types and `SafetyError` from these copies unchanged, and its testing export re-exports `testSigner()` and `TEST_KEY_ID`.

`test/vendored-safety.test.ts` fails if a copy differs from its source, so edit the safety package and copy the files again. Because the copies are byte-identical, a request the SDK signs verifies with the package's own signer over the same key, and `test/pending.test.ts` checks that the two sign identical payloads.

The copies are separate modules, so each holds its own state. `ephemeralSigner()` keeps one random key per module, and a process that loads both the SDK and the safety package has two ephemeral keys: a pause signed by one's default signer does not verify with the other's. Hosts that need both pass one `hmacSigner()` to each.

Once `@buildanagent/agent-safety` is published, delete this folder and import from the package's root export instead, and `testSigner()` from its `testing` subpath, as the SDK plan's dependency rule says.
