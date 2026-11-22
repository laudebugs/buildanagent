// Chapter 10's six interceptor moments on one timeline, in the order one step of our SDK calls them, with the events an
// observer hears beside them. The observers' lane has no arrow back: an observer cannot answer the run.
import { Figure } from "../lib/svgkit.js";

const ROW = 48;
const TOP = 40;

export default function draw(): Figure {
  const figure = new Figure({ id: "six-moments", width: 520, height: 420 });
  const rowY = (index: number): number => TOP + index * ROW;

  figure.text({ x: 110, y: 22 }, "interceptors: change the run", { tone: "muted" });
  figure.text({ x: 420, y: 22 }, "observers: only watch", { tone: "muted" });

  const steps = [
    { label: "transformContext", moment: true },
    { label: "beforeModelCall", moment: true },
    { label: "the model call", moment: false },
    { label: "afterModelCall", moment: true },
    { label: "beforeToolCall", moment: true },
    { label: "the tool runs", moment: false },
    { label: "afterToolCall", moment: true },
    { label: "shouldStop", moment: true },
  ] as const;

  figure.group("lane", () => {
    figure.box({ x: 330, y: 32, width: 180, height: 380 }, { dashed: true });
  });

  figure.group("moments", () => {
    const boxes = steps.map((step, index) =>
      figure.box(
        { x: 10, y: rowY(index), width: 200, height: 28 },
        step.moment ? { label: step.label, tone: "accent" } : { label: step.label, dashed: true },
      ),
    );
    boxes.forEach((box, index) => {
      const next = boxes[index + 1];
      if (next !== undefined) figure.connect(box, next);
    });
    const watched: Record<number, string> = {
      0: "context_transformed",
      1: "model_call_start",
      3: "model_call_end",
      6: "tool_call_end",
      7: "step_end",
    };
    for (const [index, event] of Object.entries(watched)) {
      const y = rowY(Number(index)) + 14;
      figure.arrow({ x: 210, y }, { x: 330, y }, { tone: "muted", dashed: true });
      figure.text({ x: 420, y: y + 4 }, event);
    }
  });

  figure.text({ x: 420, y: rowY(4) + 4 }, "no arrow points back:", { tone: "muted" });
  figure.text({ x: 420, y: rowY(4) + 22 }, "an observer returns", { tone: "muted" });
  figure.text({ x: 420, y: rowY(4) + 40 }, "nothing the run reads", { tone: "muted" });

  return figure;
}
