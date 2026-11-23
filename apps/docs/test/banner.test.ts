import assert from "node:assert/strict";
import { test } from "vitest";
import { type Hideable, revealUnreleasedBanner, showsUnreleasedBanner } from "../src/version/banner.js";

// The one rule for the banner: shown on a host that begins with `next.`, on no other. The cases are the hosts the docs
// are served from today and the ones a reader or a developer might open.
const CASES: readonly (readonly [string, boolean, string])[] = [
  ["docs.buildanagent.fyi", false, "production today"],
  ["next.docs.buildanagent.fyi", true, "main's docs after the switch"],
  ["localhost", false, "a local build"],
  ["127.0.0.1", false, "a local build by address"],
  ["docs-pr-12.account.workers.dev", false, "a pull request preview"],
  ["buildanagent-docs.account.workers.dev", false, "the Worker's own address"],
  ["nextdocs.example", false, "begins with the letters, but not with `next.`"],
  ["next.localhost", true, "begins with `next.`, so a developer can see the banner locally"],
  ["NEXT.DOCS.BUILDANAGENT.FYI", true, "host names are not case sensitive"],
  ["Docs.BuildAnAgent.fyi", false, "uppercase production"],
  ["next.docs.buildanagent.fyi.", true, "a fully qualified name ends in a dot"],
  ["docs.buildanagent.fyi.", false, "fully qualified production"],
  ["", false, "no hostname, as in a file: page"],
  ["next.", false, "nothing after the prefix"],
  ["next", false, "no dot"],
  ["docs.next.buildanagent.fyi", false, "`next.` only counts at the start"],
];

for (const [host, expected, why] of CASES) {
  test(`showsUnreleasedBanner(${JSON.stringify(host)}) is ${expected}: ${why}`, () => {
    assert.equal(showsUnreleasedBanner(host), expected);
  });
}

test("the script un-hides every banner on a next. host and touches none elsewhere", () => {
  const make = (): Hideable[] => [{ hidden: true }, { hidden: true }];
  const onNext = make();
  assert.equal(revealUnreleasedBanner(onNext, "next.docs.buildanagent.fyi"), true);
  assert.deepEqual(
    onNext.map((banner) => banner.hidden),
    [false, false],
  );
  for (const host of ["docs.buildanagent.fyi", "localhost", "127.0.0.1", "docs-pr-12.account.workers.dev", ""]) {
    const banners = make();
    assert.equal(revealUnreleasedBanner(banners, host), false, host);
    assert.deepEqual(
      banners.map((banner) => banner.hidden),
      [true, true],
      `${host} must leave the banner hidden`,
    );
  }
});

test("the script takes no banner on a page that has none, on any host", () => {
  assert.equal(revealUnreleasedBanner([], "next.docs.buildanagent.fyi"), true);
  assert.equal(revealUnreleasedBanner([], "docs.buildanagent.fyi"), false);
});
