// `pnpm --filter @buildanagent/manual book:switch-report`: for each written chapter, the todos in its `switchTo` and
// which of them are done, so we know which chapters can move their listings from verify/ to our own packages (BK8).
// It is a report, not a check: `pnpm test` runs it, and it exits 0 even when the book does not load, which
// `check:book` reports instead.
import { loadBook } from "../src/book/load.js";
import { chapterSwitches, formatSwitches } from "../src/book/switch-report.js";

console.log("book:switch-report: which chapters can move their listings to our own packages");
try {
  for (const line of formatSwitches(chapterSwitches(loadBook()))) console.log(`  ${line}`);
} catch (error) {
  console.log(
    `  The book does not load, so there is nothing to report; run check:book. (${String(error).split("\n")[0]})`,
  );
}
