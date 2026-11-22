// Chapter 25's analogy illustration for pass^k: a bridge that must hold every crossing, not just one. A bridge that
// held the first crossing is not trusted if it fails one in four, as an agent that passed once is not trusted for
// passing once. The register's bridge-every-crossing entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "bridge", width: 520, height: 250 });

  figure.group("bridge", () => {
    figure.text({ x: 130, y: 14 }, "a bridge", { tone: "muted" });
    figure.box({ x: 10, y: 28, width: 240, height: 40 }, { label: "crossing 1: holds" });
    figure.box({ x: 10, y: 78, width: 240, height: 40 }, { label: "crossing 2: holds" });
    figure.box({ x: 10, y: 128, width: 240, height: 40 }, { label: "crossing 3: gives way", tone: "accent" });
  });

  figure.text({ x: 260, y: 98 }, "like", { tone: "muted" });

  figure.group("agent", () => {
    figure.text({ x: 390, y: 14 }, "an agent on one task", { tone: "muted" });
    figure.box({ x: 270, y: 28, width: 240, height: 40 }, { label: "run 1: passes" });
    figure.box({ x: 270, y: 78, width: 240, height: 40 }, { label: "run 2: passes" });
    figure.box({ x: 270, y: 128, width: 240, height: 40 }, { label: "run 3: fails", tone: "accent" });
  });

  figure.text({ x: 260, y: 196 }, "one success proves little; every crossing has to hold", { tone: "muted" });
  figure.text({ x: 260, y: 232 }, "pass^k counts a task only when all k runs pass", { tone: "accent" });

  return figure;
}
