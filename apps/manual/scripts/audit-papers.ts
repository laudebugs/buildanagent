// `pnpm --filter @buildanagent/manual audit:papers`: how the chapters name the register's research papers, for the
// content todos. It prints a report, writes nothing and exits 0; check:book enforces the rules.
import { loadBook } from "../src/book/load.js";
import { auditPapers, formatAudit } from "../src/book/paper-audit.js";

console.log(formatAudit(auditPapers(loadBook())));
