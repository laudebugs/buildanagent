// Chapter 10's analogy illustration for an interceptor: a toll booth on the road that can wave a car through, charge it
// or turn it back, with a traffic camera beside the road that records every car and stops none. The camera is the
// observer; the register's toll-booths entry names this figure.
import { Figure, type Rect } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "toll-booths", width: 520, height: 226 });

  let booth: Rect;
  figure.group("road", () => {
    const car = figure.box({ x: 10, y: 40, width: 120, height: 44 }, { label: ["a car", "(the request)"] });
    booth = figure.box(
      { x: 160, y: 30, width: 190, height: 64 },
      { label: ["toll booth", "wave through, charge,", "or turn back"], tone: "accent" },
    );
    const onward = figure.box({ x: 390, y: 40, width: 120, height: 44 }, { label: ["the road on"] });
    figure.connect(car, booth);
    figure.connect(booth, onward);
  });

  figure.group("camera", () => {
    const camera = figure.box(
      { x: 160, y: 140, width: 190, height: 64 },
      { label: ["traffic camera", "records every car", "and stops none"] },
    );
    figure.connect(booth, camera, { tone: "muted", dashed: true });
    const record = figure.box({ x: 390, y: 150, width: 120, height: 44 }, { label: ["the record"] });
    figure.connect(camera, record);
    figure.text({ x: 258, y: 123 }, "same traffic", { anchor: "start", tone: "muted" });
  });

  return figure;
}
