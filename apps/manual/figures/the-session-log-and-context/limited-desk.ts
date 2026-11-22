// The session-log chapter's analogy illustration for the context window: a desk with limited space. The session log is
// the drawer that holds every entry, the desk holds only what the harness put on it, and the model reads the desk. The
// register's limited-desk entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "limited-desk", width: 520, height: 262 });

  figure.group("drawer", () => {
    figure.box(
      { x: 8, y: 30, width: 150, height: 150 },
      { tone: "muted", label: ["session log", "the drawer", "every entry"] },
    );
    figure.text({ x: 83, y: 205 }, "the model cannot", { tone: "muted" });
    figure.text({ x: 83, y: 222 }, "open the drawer", { tone: "muted" });
  });

  figure.group("desk", () => {
    figure.box({ x: 214, y: 30, width: 298, height: 150 }, { tone: "accent" });
    figure.text({ x: 363, y: 50 }, "the desk: the context window", { tone: "accent" });
    figure.box({ x: 230, y: 62, width: 266, height: 30 }, { label: "system prompt" });
    figure.box({ x: 230, y: 98, width: 266, height: 30 }, { label: "summary of earlier work" });
    figure.box({ x: 230, y: 134, width: 266, height: 30 }, { label: "recent messages" });
  });

  figure.group("harness", () => {
    figure.arrow({ x: 158, y: 105 }, { x: 214, y: 105 }, { tone: "accent" });
    figure.text({ x: 186, y: 92 }, "harness", { tone: "accent" });
    figure.text({ x: 186, y: 128 }, "decides", { tone: "accent" });
  });

  figure.group("model", () => {
    figure.arrow({ x: 363, y: 180 }, { x: 363, y: 212 });
    figure.box({ x: 283, y: 212, width: 160, height: 36 }, { label: "model reads the desk" });
  });

  return figure;
}
