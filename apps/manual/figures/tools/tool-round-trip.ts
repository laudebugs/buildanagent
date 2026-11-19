// Chapter 3's round trip of one tool call, drawn from the ADK listing and its replay: the model sees the schema, calls
// get_order_status with a number, the SDK's validation returns an error as data, the model retries with a string, and
// only then does the tool's function run and its result go back.
import { Figure } from "../lib/svgkit.js";

const LEFT = { x: 20, width: 220 };
const RIGHT = { x: 300, width: 200 };
const ROW_HEIGHT = 44;
const ROWS = [40, 112, 188, 264];

/** A box in the left lane (your code and its SDK) or the right lane (the model), on one of the four rows. */
function cell(lane: typeof LEFT, row: number) {
  return { x: lane.x, y: ROWS[row] ?? 0, width: lane.width, height: ROW_HEIGHT };
}

export default function draw(): Figure {
  const figure = new Figure({ id: "tool-round-trip", width: 520, height: 320 });

  figure.text({ x: LEFT.x + LEFT.width / 2, y: 24 }, "your code and its SDK", { style: "heading" });
  figure.text({ x: RIGHT.x + RIGHT.width / 2, y: 24 }, "the model", { style: "heading" });

  figure.group("offer", () => {
    const schema = figure.box(cell(LEFT, 0), { label: ["schema: orderId", "is a string"] });
    const sees = figure.box(cell(RIGHT, 0), { label: ["sees the name,", "description, schema"] });
    figure.connect(schema, sees);
    const call = figure.box(cell(RIGHT, 1), { label: ["calls the tool with", "{ orderId: 42 }"], tone: "accent" });
    figure.connect(sees, call);
    const validate = figure.box(cell(LEFT, 1), { label: ["the SDK validates", "the arguments"] });
    figure.connect(call, validate);

    // The first call fails validation, so the function never runs and the model reads an error instead.
    const error = figure.box(cell(LEFT, 2), {
      label: ["fails: an error result", "says expected string"],
      tone: "accent",
    });
    figure.connect(validate, error, { tone: "accent" });
    const retry = figure.box(cell(RIGHT, 2), { label: ["retries with", '{ orderId: "A-1" }'] });
    figure.connect(error, retry);

    // The retry passes, so the function runs and its result goes back to the model.
    const run = figure.box(cell(LEFT, 3), { label: ["passes: execute()", "runs in your process"] });
    figure.curve({ x: RIGHT.x, y: retry.y + 34 }, { x: 262, y: retry.y + 40 }, { x: LEFT.x + LEFT.width, y: 280 });
    const reads = figure.box(cell(RIGHT, 3), { label: ["reads the result:", "order A-1 shipped"], tone: "muted" });
    figure.connect(run, reads);
  });

  return figure;
}
