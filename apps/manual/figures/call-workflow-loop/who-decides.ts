// Chapter 1's sample figure: a call, a workflow and a loop side by side, with who decides the next step in each. It
// draws with every helper in svgkit.ts, so a change to the kit shows up here first.
import { Figure, type Rect } from "../lib/svgkit.js";

const COLUMN = 190;
const GAP = 20;
const BOX = { width: 130, height: 40 };
const ROWS = [50, 130, 210];

/** A box in a column, centred, on one of the three rows. */
function cell(column: number, row: number): Rect {
  const centre = 10 + column * (COLUMN + GAP) + COLUMN / 2;
  return { x: centre - BOX.width / 2, y: ROWS[row] ?? 0, ...BOX };
}

export default function draw(): Figure {
  const figure = new Figure({ id: "who-decides", width: 630, height: 300 });
  const centre = (column: number) => 10 + column * (COLUMN + GAP) + COLUMN / 2;

  figure.group("call", () => {
    figure.text({ x: centre(0), y: 28 }, "A call", { style: "heading" });
    const code = figure.box(cell(0, 0), { label: "your code" });
    const model = figure.box(cell(0, 1), { label: "model" });
    const answer = figure.box(cell(0, 2), { label: "answer", tone: "muted" });
    figure.connect(code, model);
    figure.connect(model, answer);
  });

  figure.group("workflow", () => {
    figure.text({ x: centre(1), y: 28 }, "A workflow", { style: "heading" });
    const first = figure.box(cell(1, 0), { label: "step 1: model" });
    const second = figure.box(cell(1, 1), { label: "step 2: tool" });
    const third = figure.box(cell(1, 2), { label: "step 3: model" });
    figure.connect(first, second);
    figure.connect(second, third);
  });

  figure.group("loop", () => {
    figure.text({ x: centre(2), y: 28 }, "A loop", { style: "heading" });
    const model = figure.box(cell(2, 0), { label: "model", tone: "accent" });
    const tool = figure.box(cell(2, 1), { label: "tool" });
    const answer = figure.box(cell(2, 2), { label: "answer", tone: "muted", dashed: true });
    figure.connect(model, tool);
    // The tool's result goes back to the model, which decides whether to call again or answer.
    const right = model.x + model.width;
    figure.curve(
      { x: right, y: tool.y + 20 },
      { x: right + 34, y: 110 },
      { x: right, y: model.y + 22 },
      { tone: "accent" },
    );
    figure.curve(
      { x: model.x, y: model.y + 20 },
      { x: model.x - 26, y: 150 },
      { x: answer.x + 20, y: answer.y },
      { tone: "muted", dashed: true },
    );
  });

  figure.group("deciders", () => {
    figure.line(
      [
        { x: 10, y: 256 },
        { x: 620, y: 256 },
      ],
      { tone: "muted", dashed: true },
    );
    for (const column of [0, 1, 2]) {
      figure.text({ x: centre(column), y: 274 }, "next step:", { tone: "muted" });
    }
    figure.dot({ x: centre(0) - 52, y: 289 }, 3.5, "amber");
    figure.text({ x: centre(0), y: 293 }, "your code");
    figure.dot({ x: centre(1) - 52, y: 289 }, 3.5, "amber");
    figure.text({ x: centre(1), y: 293 }, "your code");
    figure.dot({ x: centre(2) - 52, y: 289 }, 3.5, "terracotta");
    figure.text({ x: centre(2), y: 293 }, "the model", { tone: "accent" });
  });

  return figure;
}
