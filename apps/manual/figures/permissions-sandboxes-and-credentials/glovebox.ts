// Chapter 22's analogy illustration for a sandbox: a lab glovebox. The work happens behind the glass, and only a chosen
// item passes through the port, as only a chosen host passes through a sandbox's egress door. The register's
// lab-glovebox entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "glovebox", width: 520, height: 250 });

  figure.group("glovebox", () => {
    figure.text({ x: 120, y: 16 }, "a lab glovebox", { tone: "muted" });
    figure.box({ x: 20, y: 28, width: 200, height: 150 });
    figure.box({ x: 34, y: 42, width: 80, height: 30 }, { label: "gloves" });
    figure.box({ x: 34, y: 84, width: 120, height: 30 }, { label: "the sample", tone: "accent" });
    figure.box({ x: 34, y: 126, width: 120, height: 44 }, { label: ["behind the", "glass"] });
    figure.box({ x: 162, y: 126, width: 50, height: 44 }, { label: "port" });
    figure.text({ x: 120, y: 202 }, "things pass in and out", { tone: "muted" });
    figure.text({ x: 120, y: 220 }, "through the port", { tone: "muted" });
  });

  figure.text({ x: 260, y: 108 }, "like", { tone: "muted" });

  figure.group("sandbox", () => {
    figure.text({ x: 400, y: 16 }, "a sandbox", { tone: "muted" });
    figure.box({ x: 300, y: 28, width: 200, height: 150 });
    figure.box({ x: 314, y: 42, width: 110, height: 30 }, { label: "the command" });
    figure.box({ x: 314, y: 84, width: 160, height: 30 }, { label: "workspace: writable", tone: "accent" });
    figure.box({ x: 314, y: 126, width: 120, height: 44 }, { label: ["a read-only", "folder"] });
    figure.box({ x: 442, y: 126, width: 50, height: 44 }, { label: "door" });
    figure.text({ x: 400, y: 202 }, "only allowed hosts pass", { tone: "muted" });
    figure.text({ x: 400, y: 220 }, "through the door", { tone: "muted" });
  });

  figure.text({ x: 260, y: 242 }, "what goes wrong inside stays inside", { tone: "accent" });

  return figure;
}
