// Chapter 23's flat figure of the five write outcomes and which of them may be retried: a write reports exactly one,
// and each one carries its own rule for what may happen next. Only `unknown` is settled by asking the other side.
import { Figure } from "../lib/svgkit.js";

const ROWS = [
  { outcome: "applied", rule: "done: a repeat reads the saved result", tone: "text" },
  { outcome: "not_applied", rule: "a new key after a fix", tone: "text" },
  { outcome: "compensated", rule: "a new operation, only if still wanted", tone: "text" },
  { outcome: "partial", rule: "resume with the same key, or ask a person", tone: "text" },
  { outcome: "unknown", rule: "ask the other side; never a fresh key", tone: "accent" },
] as const;

export default function draw(): Figure {
  const figure = new Figure({ id: "outcomes", width: 520, height: 300 });

  figure.text({ x: 80, y: 14 }, "the write reports", { tone: "muted" });
  figure.text({ x: 370, y: 14 }, "what may happen next", { tone: "muted" });

  for (const [index, row] of ROWS.entries()) {
    const y = 26 + index * 52;
    const outcome = figure.box({ x: 10, y, width: 140, height: 40 }, { label: row.outcome, tone: row.tone });
    const rule = figure.box({ x: 190, y, width: 320, height: 40 }, { label: row.rule, tone: row.tone });
    figure.arrow({ x: outcome.x + outcome.width, y: y + 20 }, { x: rule.x, y: y + 20 });
  }

  return figure;
}
