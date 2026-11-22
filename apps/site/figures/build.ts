// Writes the landing page's figure files. A figure change starts in layers.ts; the site's tests fail when a committed
// SVG differs from what this script writes, or when a drawing has an overlap or a clipped label.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { layers } from "./layers.js";

for (const { path, drawing } of layers()) {
  const problems = drawing.problems();
  if (problems.length > 0) throw new Error(`${path}: ${problems.join("; ")}`);
  const url = new URL(`../${path}`, import.meta.url);
  writeFileSync(url, drawing.toSvg());
  console.log(`wrote ${fileURLToPath(url)}`);
}
