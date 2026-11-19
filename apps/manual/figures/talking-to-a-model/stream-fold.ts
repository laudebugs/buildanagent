// Chapter 2's stream figure: the streamed answer of verify/vercel-ai-sdk/examples/10-streaming-usage.ts, its eleven
// deltas (the mock splits after each space) folding into one message, and the usage that arrives with the stream's
// last part, split into the four token classes and priced at Claude Sonnet 5.5's rates (examples/lib/rates.ts).
import { Figure } from "../lib/svgkit.js";

const DELTAS = ["Prompt ", "caching ", "bills ", "a ", "cache ", "read ", "at ", "0.05x ", "the ", "input ", "rate."];

const CLASSES = [
  { name: "uncached", tokens: "1,000", cost: "$0.00200" },
  { name: "cache read", tokens: "1,500", cost: "$0.00015" },
  { name: "cache write", tokens: "500", cost: "$0.00125" },
  { name: "output", tokens: "200", cost: "$0.00200" },
];

export default function draw(): Figure {
  const figure = new Figure({ id: "stream-fold", width: 520, height: 330 });

  figure.group("deltas", () => {
    figure.text({ x: 10, y: 20 }, "11 deltas, in order", { anchor: "start", style: "heading" });
    // Two rows of chips, each as wide as its text, so the pieces read like the stream that carried them.
    let x = 10;
    let y = 32;
    for (const delta of DELTAS) {
      const width = figure.measure(delta.trim()) + 20;
      if (x + width > 510) {
        x = 10;
        y += 34;
      }
      figure.box({ x, y, width, height: 26 }, { label: delta.trim(), tone: "muted" });
      x += width + 6;
    }
  });

  figure.box(
    { x: 10, y: 130, width: 500, height: 46 },
    { label: ["assistant", "Prompt caching bills a cache read at 0.05x the input rate."], tone: "accent" },
  );
  figure.arrow({ x: 260, y: 98 }, { x: 260, y: 130 }, { tone: "accent" });
  figure.text({ x: 268, y: 118 }, "fold", { anchor: "start", tone: "accent" });

  figure.group("usage", () => {
    figure.text({ x: 10, y: 206 }, "usage, with the last part", { anchor: "start", style: "heading" });
    const width = 119;
    CLASSES.forEach((cls, index) => {
      figure.box(
        { x: 10 + index * (width + 8), y: 216, width, height: 66 },
        { label: [cls.name, `${cls.tokens} tokens`, cls.cost], tone: index === 3 ? "accent" : "text" },
      );
    });
    figure.text({ x: 510, y: 316 }, "total: $0.0054", { anchor: "end", style: "heading", tone: "accent" });
  });

  return figure;
}
