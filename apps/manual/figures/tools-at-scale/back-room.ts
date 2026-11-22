// Chapter 13's analogy illustration for deferred tools: a hardware store shelves the common tools where a customer sees
// them and keeps the rest in the back room, fetched on request. The shelf stands for the definitions every request
// carries and the back room for the tools a search loads. The register's hardware-store-back-room entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "back-room", width: 520, height: 236 });

  figure.group("shelf", () => {
    figure.text({ x: 120, y: 14 }, "the shelf: in plain sight", { tone: "muted" });
    figure.box({ x: 10, y: 22, width: 220, height: 150 });
    figure.box({ x: 24, y: 36, width: 192, height: 32 }, { label: "hammer" });
    figure.box({ x: 24, y: 78, width: 192, height: 32 }, { label: "tape measure" });
    figure.box({ x: 24, y: 120, width: 192, height: 32 }, { label: "screws" });
    figure.text({ x: 120, y: 194 }, "like: the tools every", { tone: "muted" });
    figure.text({ x: 120, y: 212 }, "request carries", { tone: "muted" });
  });

  figure.group("back-room", () => {
    figure.text({ x: 400, y: 14 }, "the back room: asked for", { tone: "muted" });
    figure.box({ x: 290, y: 22, width: 220, height: 150 }, { tone: "accent" });
    figure.box({ x: 304, y: 36, width: 192, height: 32 }, { label: "hole saw" });
    figure.box({ x: 304, y: 78, width: 192, height: 32 }, { label: "pipe die set" });
    figure.box({ x: 304, y: 120, width: 192, height: 32 }, { label: "tile cutter" });
    figure.text({ x: 400, y: 194 }, "like: the tools a search", { tone: "muted" });
    figure.text({ x: 400, y: 212 }, "loads on the next step", { tone: "muted" });
  });

  figure.group("trips", () => {
    figure.text({ x: 260, y: 66 }, "asks", { tone: "muted" });
    figure.arrow({ x: 230, y: 78 }, { x: 290, y: 78 });
    figure.text({ x: 260, y: 116 }, "brings", { tone: "muted" });
    figure.arrow({ x: 290, y: 128 }, { x: 230, y: 128 }, { tone: "accent" });
  });

  return figure;
}
