// Chapter 2's transcript figure: the two requests of the LangChain streaming example's run
// (verify/langchain/results/transcripts/08-streaming.json), each a list of messages with roles. The second request
// carries the first one's message again, with the model's tool call and the tool's result, because the model keeps
// nothing between calls.
import { Figure, type Rect } from "../lib/svgkit.js";

const CARD = { width: 170, height: 40 };
const LEFT = 30;
const RIGHT = 320;

/** A message card: its role on the first line, its content on the second. */
function card(x: number, y: number): Rect {
  return { x, y, ...CARD };
}

export default function draw(): Figure {
  const figure = new Figure({ id: "resent-history", width: 520, height: 270 });

  figure.group("first", () => {
    figure.text({ x: LEFT + CARD.width / 2, y: 24 }, "request 1", { style: "heading" });
    const user = figure.box(card(LEFT, 40), { label: ["user", "Find it"] });
    const reply = figure.box(card(LEFT, 220), { label: ["assistant", "calls lookup"], tone: "accent" });
    figure.connect(user, reply, { tone: "muted" });
    figure.text({ x: LEFT + CARD.width / 2 + 8, y: 140 }, "model reply", { anchor: "start", tone: "muted" });
  });

  figure.group("second", () => {
    figure.text({ x: RIGHT + CARD.width / 2, y: 24 }, "request 2", { style: "heading" });
    figure.box(card(RIGHT, 40), { label: ["user", "Find it"] });
    figure.box(card(RIGHT, 90), { label: ["assistant", "calls lookup"] });
    const result = figure.box(card(RIGHT, 140), { label: ["tool", "found"] });
    const reply = figure.box(card(RIGHT, 220), { label: ["assistant", "Here it is."], tone: "accent" });
    figure.connect(result, reply, { tone: "muted" });
    // The first request's message and the model's first reply both go back out in the second request.
    figure.curve(
      { x: LEFT + CARD.width, y: 240 },
      { x: 260, y: 230 },
      { x: RIGHT, y: 110 },
      { tone: "accent", dashed: true },
    );
    figure.arrow({ x: LEFT + CARD.width, y: 60 }, { x: RIGHT, y: 60 }, { tone: "accent", dashed: true });
    figure.text({ x: 260, y: 52 }, "sent again", { tone: "accent" });
  });

  return figure;
}
