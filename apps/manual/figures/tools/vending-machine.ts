// Chapter 3's analogy illustration for an error returned as data: a vending machine that hands back your coin with a
// note saying what to try instead. The register's vending-machine entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "vending-machine", width: 520, height: 260 });

  figure.group("machine", () => {
    // The cabinet, its rows of snacks and its coin slot.
    figure.box({ x: 20, y: 16, width: 220, height: 228 });
    figure.text({ x: 130, y: 38 }, "vending machine", { tone: "muted" });
    for (const [index, label] of ["A1", "A2", "A3"].entries()) {
      figure.box({ x: 36 + index * 50, y: 52, width: 42, height: 36 }, { label, tone: "muted" });
    }
    for (const [index, label] of ["B1", "B2", "B3"].entries()) {
      figure.box({ x: 36 + index * 50, y: 98, width: 42, height: 36 }, { label, tone: "muted" });
    }
    figure.box({ x: 186, y: 52, width: 46, height: 82 }, { label: ["coin", "slot"] });
    figure.box(
      { x: 36, y: 172, width: 192, height: 56 },
      { label: ["return tray:", "your coin, back"], tone: "accent" },
    );
    figure.dot({ x: 60, y: 200 }, 8, "amber");
  });

  figure.group("you", () => {
    figure.box({ x: 300, y: 52, width: 200, height: 44 }, { label: ["you insert", "one large coin"] });
    figure.arrow({ x: 300, y: 74 }, { x: 228, y: 74 });
    const note = figure.box(
      { x: 300, y: 172, width: 200, height: 56 },
      { label: ["note: exact change only,", "try two small coins"], tone: "accent" },
    );
    figure.connect({ x: 36, y: 172, width: 192, height: 56 }, note, { tone: "accent" });
    figure.text({ x: 400, y: 140 }, "the machine says", { tone: "muted" });
    figure.text({ x: 400, y: 156 }, "what to try next", { tone: "muted" });
  });

  return figure;
}
