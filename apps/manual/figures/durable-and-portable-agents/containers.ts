// Chapter 24's analogy illustration for portable seams: a standard shipping container fits any ship, crane and truck,
// as a seam's interface fits any target. Each port still needs its own crane, as each target needs its own adapter.
// The register's shipping-containers entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "containers", width: 520, height: 250 });

  figure.group("container", () => {
    figure.text({ x: 260, y: 14 }, "one standard container", { tone: "muted" });
    figure.box({ x: 190, y: 24, width: 140, height: 50 }, { label: "the same code", tone: "accent" });
  });

  figure.group("ports", () => {
    const ports = [
      { x: 10, name: "ship" },
      { x: 180, name: "crane" },
      { x: 350, name: "truck" },
    ] as const;
    for (const port of ports) {
      const holder = figure.box({ x: port.x, y: 110, width: 160, height: 44 }, { label: port.name });
      figure.arrow({ x: 260, y: 74 }, { x: holder.x + holder.width / 2, y: holder.y });
    }
  });

  figure.group("adapters", () => {
    figure.text({ x: 90, y: 188 }, "its own fittings", { tone: "muted" });
    figure.text({ x: 260, y: 188 }, "its own fittings", { tone: "muted" });
    figure.text({ x: 430, y: 188 }, "its own fittings", { tone: "muted" });
  });

  figure.text({ x: 260, y: 230 }, "the box is standard, and each port needs its own crane", { tone: "accent" });

  return figure;
}
