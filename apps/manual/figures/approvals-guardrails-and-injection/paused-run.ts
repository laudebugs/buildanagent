// Chapter 6's paused run: the first run ends at a pending tool call and leaves everything it needs in a store; a person
// decides later, perhaps in another process, and the second run starts from the stored copy. The three SDK listings
// differ in what the store holds, but each stores the pending call.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "paused-run", width: 520, height: 250 });

  figure.group("run-one", () => {
    const ask = figure.box(
      { x: 10, y: 20, width: 150, height: 44 },
      { label: ["run 1: model asks", "for the refund"] },
    );
    const stop = figure.box(
      { x: 10, y: 96, width: 150, height: 44 },
      { label: ["the SDK does not", "run the tool"], tone: "accent" },
    );
    figure.connect(ask, stop);
    figure.text({ x: 85, y: 166 }, "the run ends", { tone: "muted" });
  });

  figure.group("store", () => {
    figure.text({ x: 260, y: 14 }, "saved by your code", { tone: "muted" });
    const state = figure.box(
      { x: 180, y: 24, width: 160, height: 116 },
      { label: ["the messages,", "the pending call", "issue_refund(A-1),", "an approval id"] },
    );
    figure.arrow({ x: 160, y: 118 }, { x: state.x, y: 118 });
    figure.arrow({ x: state.x + state.width, y: 118 }, { x: 360, y: 118 });
  });

  figure.group("run-two", () => {
    const person = figure.box(
      { x: 360, y: 20, width: 150, height: 44 },
      { label: ["a person decides:", "approve or reject"] },
    );
    const resume = figure.box(
      { x: 360, y: 96, width: 150, height: 44 },
      { label: ["run 2 starts from", "the stored copy"], tone: "accent" },
    );
    figure.connect(person, resume);
    const ran = figure.box(
      { x: 360, y: 176, width: 150, height: 44 },
      { label: ["approved: the tool", "runs exactly once"] },
    );
    figure.connect(resume, ran);
  });

  figure.text({ x: 260, y: 164 }, "hours later, maybe in", { tone: "muted" });
  figure.text({ x: 260, y: 182 }, "another process", { tone: "muted" });

  return figure;
}
