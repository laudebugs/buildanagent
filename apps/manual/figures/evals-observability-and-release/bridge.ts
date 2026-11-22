// Chapter 25's analogy illustration for pass^k: a bridge that must hold every crossing, not just one. A bridge that
// held three crossings is not trusted if it gives way on the fourth, as an agent that passed three runs is not trusted
// for passing them: one run in four failing is the 75% example. The register's bridge-every-crossing entry names it.
import { Figure } from "../lib/svgkit.js";

const ROWS = [
  { bridge: "crossing 1: holds", agent: "run 1: passes", tone: "text" },
  { bridge: "crossing 2: holds", agent: "run 2: passes", tone: "text" },
  { bridge: "crossing 3: holds", agent: "run 3: passes", tone: "text" },
  { bridge: "crossing 4: gives way", agent: "run 4: fails", tone: "accent" },
] as const;

export default function draw(): Figure {
  const figure = new Figure({ id: "bridge", width: 520, height: 290 });

  figure.text({ x: 120, y: 14 }, "a bridge", { tone: "muted" });
  figure.text({ x: 400, y: 14 }, "an agent on one task", { tone: "muted" });
  figure.text({ x: 260, y: 108 }, "like", { tone: "muted" });

  for (const [index, row] of ROWS.entries()) {
    const y = 26 + index * 44;
    figure.box({ x: 10, y, width: 220, height: 34 }, { label: row.bridge, tone: row.tone });
    figure.box({ x: 290, y, width: 220, height: 34 }, { label: row.agent, tone: row.tone });
  }

  figure.text({ x: 260, y: 226 }, "one success proves little; every crossing has to hold", { tone: "muted" });
  figure.text({ x: 260, y: 264 }, "pass^k counts a task only when all k runs pass", { tone: "accent" });

  return figure;
}
