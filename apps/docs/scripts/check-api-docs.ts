// Fails when an export of the gateway or the SDK has no TSDoc: `pnpm check:api-docs`. The docs app's tests run the same
// check, so `pnpm test` enforces it too.
import { checkApiDocs } from "../src/api/check.js";
import { API_PACKAGES, typeDocOptions } from "../src/api/packages.js";

let failed = false;
for (const pkg of API_PACKAGES) {
  const { problems } = await checkApiDocs(typeDocOptions(pkg));
  console.log(`${pkg.name}: ${problems.length === 0 ? "every export is documented" : `${problems.length} problem(s)`}`);
  for (const problem of problems) console.log(`  ${problem}`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
