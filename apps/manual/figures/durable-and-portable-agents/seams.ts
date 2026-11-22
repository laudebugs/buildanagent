// Chapter 24's flat figure of the seven portable seams plus the effect store, and what each target puts behind them.
// The cells are our inference from platform documentation and are untested, except the effect store, whose three
// stores exist in the agent-safety package. Cloudflare is the only target `verify/` runs.
import { Figure } from "../lib/svgkit.js";

const COLUMNS = [
  { name: "Cloudflare", x: 190 },
  { name: "AWS", x: 322 },
  { name: "Vercel", x: 452 },
] as const;

const ROWS = [
  { seam: "SessionStore", cells: ["DO SQLite", "DynamoDB", "Postgres"] },
  { seam: "SessionLock", cells: ["one object", "lease row", "lease row"] },
  { seam: "Scheduler", cells: ["DO alarm", "queue delay", "workflow hook"] },
  { seam: "KeyStore", cells: ["Worker secret", "Secrets Manager", "secret env var"] },
  { seam: "SandboxClient", cells: ["CF Sandbox", "E2B", "Vercel Sandbox"] },
  { seam: "EgressPolicy", cells: ["per backend", "per backend", "per backend"] },
  { seam: "Transport", cells: ["Web streams", "Web streams", "Web streams"] },
  { seam: "EffectStore", cells: ["DO SQLite", "DynamoDB", "Postgres"] },
] as const;

export default function draw(): Figure {
  const figure = new Figure({ id: "seams", width: 520, height: 284 });

  for (const column of COLUMNS) figure.text({ x: column.x, y: 12 }, column.name, { tone: "muted" });

  for (const [index, row] of ROWS.entries()) {
    const y = 24 + index * 32;
    const effect = row.seam === "EffectStore";
    figure.box({ x: 10, y, width: 120, height: 28 }, { label: row.seam, tone: effect ? "accent" : "text" });
    for (const [cell, column] of COLUMNS.entries()) {
      figure.text({ x: column.x, y: y + 14 }, row.cells[cell] ?? "", { tone: effect ? "accent" : "text" });
    }
  }

  return figure;
}
