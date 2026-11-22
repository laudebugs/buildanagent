// Chapter 23's analogy illustration for persist-before-execute: a shop writes the order in its ledger before the
// courier leaves, and writes the result in a second line when the courier is back. A missing second line says the
// order went out and nobody knows how it ended. The register's ledger-before-courier entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "ledger", width: 520, height: 250 });

  figure.group("ledger", () => {
    figure.text({ x: 110, y: 14 }, "the ledger", { tone: "muted" });
    figure.box({ x: 10, y: 24, width: 200, height: 130 });
    figure.box({ x: 22, y: 36, width: 176, height: 40 }, { label: ["1 · intent:", "send order 42"] });
    figure.box({ x: 22, y: 100, width: 176, height: 40 }, { label: ["2 · result:", "delivered"], tone: "accent" });
  });

  figure.group("courier", () => {
    figure.text({ x: 365, y: 14 }, "the courier", { tone: "muted" });
    const leaves = figure.box({ x: 270, y: 36, width: 190, height: 40 }, { label: "leaves with order 42" });
    const back = figure.box({ x: 270, y: 100, width: 190, height: 40 }, { label: "comes back: delivered" });
    figure.connect(leaves, back);
    figure.arrow({ x: 210, y: 56 }, { x: 270, y: 56 });
    figure.arrow({ x: 270, y: 120 }, { x: 210, y: 120 });
  });

  figure.text({ x: 260, y: 186 }, "line 1 is written before the courier leaves,", { tone: "muted" });
  figure.text({ x: 260, y: 204 }, "line 2 after the courier is back", { tone: "muted" });
  figure.text({ x: 260, y: 230 }, "a line 1 with no line 2 means: ask the customer", { tone: "accent" });

  return figure;
}
