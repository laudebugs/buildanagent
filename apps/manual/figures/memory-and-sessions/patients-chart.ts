// Chapter 5's analogy illustration for a session: a patient's chart that travels with them between shifts. The day
// shift writes in it and the night shift reads it, as each run writes to a session and the next run's model call reads
// it. The register's patients-chart entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "patients-chart", width: 520, height: 260 });

  figure.group("chart", () => {
    // A clipboard: its clip on top, then the chart's title and three entries.
    figure.box({ x: 238, y: 12, width: 44, height: 14 }, { tone: "muted" });
    figure.box({ x: 170, y: 26, width: 180, height: 170 });
    figure.text({ x: 260, y: 50 }, "chart: bed 12", { tone: "muted" });
    figure.box({ x: 184, y: 62, width: 152, height: 30 }, { label: "12:00 fever 38.9" });
    figure.box({ x: 184, y: 100, width: 152, height: 30 }, { label: "14:00 antibiotic" });
    figure.box({ x: 184, y: 138, width: 152, height: 44 }, { label: ["allergy:", "penicillin"], tone: "accent" });
  });

  figure.group("shifts", () => {
    const day = figure.box({ x: 16, y: 80, width: 120, height: 44 }, { label: ["day shift", "writes"] });
    const night = figure.box({ x: 384, y: 80, width: 120, height: 44 }, { label: ["night shift", "reads"] });
    figure.arrow({ x: day.x + day.width, y: 102 }, { x: 170, y: 102 });
    figure.arrow({ x: 350, y: 102 }, { x: night.x, y: 102 }, { tone: "accent" });
  });

  figure.text({ x: 260, y: 222 }, "the night nurse remembers nothing of the day;", { tone: "muted" });
  figure.text({ x: 260, y: 240 }, "she reads the chart", { tone: "muted" });

  return figure;
}
