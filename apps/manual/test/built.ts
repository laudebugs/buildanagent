// The folder test/built-book.ts built the fixture book into, for the tests that read built pages. When the build
// failed, the call throws the build's error, so only the tests that read the built book fail and every other test
// still runs.
import { inject } from "vitest";

/** The folder `astro build` wrote the fixture book to for this test run; throws the build's error when it failed. */
export function builtBook(): string {
  const book = inject("builtBook");
  if ("error" in book) throw new Error(`the book build failed, so this test has no built book to read:\n${book.error}`);
  return book.out;
}
