// Chapter 2's analogy illustration for tokens and cost: a taxi meter that runs on both legs of the trip. The register's
// taxi-meter entry names it. The fares are the streamed call of verify/vercel-ai-sdk/examples/10-streaming-usage.ts
// at Claude Sonnet 5.5's rates: $0.0034 for the 3,000 input tokens out and $0.0020 for the 200 output tokens back.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "taxi-meter", width: 520, height: 250 });

  const code = figure.box({ x: 20, y: 60, width: 110, height: 60 }, { label: ["your code"] });
  const model = figure.box({ x: 390, y: 60, width: 110, height: 60 }, { label: ["the model"] });

  figure.group("legs", () => {
    figure.arrow({ x: code.x + code.width, y: 76 }, { x: model.x, y: 76 }, { tone: "text" });
    figure.text({ x: 260, y: 66 }, "out: 3,000 input tokens", { tone: "text" });
    figure.arrow({ x: model.x, y: 104 }, { x: code.x + code.width, y: 104 }, { tone: "accent" });
    figure.text({ x: 260, y: 124 }, "back: 200 output tokens", { tone: "accent" });
  });

  figure.group("cab", () => {
    // A small cab on the road between the two ends, its roof sign and two wheels.
    figure.box({ x: 230, y: 12, width: 60, height: 24 }, { label: "TAXI", tone: "accent" });
    figure.dot({ x: 242, y: 42 }, 4, "text");
    figure.dot({ x: 278, y: 42 }, 4, "text");
  });

  figure.group("meter", () => {
    figure.box(
      { x: 150, y: 150, width: 220, height: 88 },
      { label: ["the meter", "out leg:   $0.0034", "back leg:  $0.0020", "fare:      $0.0054"], tone: "accent" },
    );
    figure.line(
      [
        { x: 260, y: 130 },
        { x: 260, y: 150 },
      ],
      { tone: "muted", dashed: true },
    );
  });

  return figure;
}
