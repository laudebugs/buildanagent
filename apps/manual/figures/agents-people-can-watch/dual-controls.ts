// This chapter's analogy illustration for browser takeover: a driving instructor's dual controls. The instructor can take
// the wheel at any moment, and the car must know who is driving. An agent that does not pause when a person takes
// over keeps sending its own input, and the two fight for the wheel. The register's dual-controls entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "dual-controls", width: 520, height: 250 });

  figure.group("car", () => {
    figure.text({ x: 120, y: 14 }, "a driving lesson", { tone: "muted" });
    figure.box({ x: 10, y: 28, width: 220, height: 40 }, { label: "the learner drives" });
    figure.box({ x: 10, y: 78, width: 220, height: 40 }, { label: "the instructor takes over", tone: "accent" });
    figure.box({ x: 10, y: 128, width: 220, height: 40 }, { label: "the learner lets go" });
  });

  figure.text({ x: 260, y: 98 }, "like", { tone: "muted" });

  figure.group("browser", () => {
    figure.text({ x: 400, y: 14 }, "an agent in a browser", { tone: "muted" });
    figure.box({ x: 290, y: 28, width: 220, height: 40 }, { label: "the agent acts" });
    figure.box({ x: 290, y: 78, width: 220, height: 40 }, { label: "a person takes over", tone: "accent" });
    figure.box({ x: 290, y: 128, width: 220, height: 40 }, { label: "the agent pauses" });
  });

  figure.text({ x: 260, y: 196 }, "the car must know who is driving", { tone: "muted" });
  figure.text({ x: 260, y: 232 }, "a takeover is recorded, and the agent stops sending input", { tone: "accent" });

  return figure;
}
