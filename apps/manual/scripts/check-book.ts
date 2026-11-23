// `pnpm --filter @buildanagent/manual check:book`: every content rule the build applies, run before the build. It
// prints its notes on the register's papers, then each problem as file:line: message, and exits 1 when there is any.
import { checkBookReport } from "../src/book/check-book.js";
import { formatProblem } from "../src/book/problems.js";

const { problems, notes } = await checkBookReport();
for (const note of notes) console.log(note.startsWith("  ") ? note : `check:book: ${note}`);
for (const problem of problems) console.error(formatProblem(problem));
if (problems.length > 0) {
  console.error(`check:book: ${problems.length} problem(s)`);
  process.exitCode = 1;
} else {
  console.log("check:book: the book passes every content rule");
}
