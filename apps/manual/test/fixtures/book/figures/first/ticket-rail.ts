// The fixture book's analogy illustration: the kitchen ticket rail that the fixture register's kitchen-ticket-rail
// entry names. It is the sample of the `analogy` figure kind. It lives in the fixture book, not in figures/, because
// the analogy belongs to Chapter 1, whose todo registers it when the chapter is written.
import { Figure } from "../../../../../figures/lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "ticket-rail", width: 520, height: 240 });

  figure.group("rail", () => {
    figure.line(
      [
        { x: 20, y: 36 },
        { x: 500, y: 36 },
      ],
      { tone: "muted" },
    );
    figure.dot({ x: 20, y: 36 }, 4, "text");
    figure.dot({ x: 500, y: 36 }, 4, "text");
    figure.text({ x: 260, y: 22 }, "the ticket rail", { tone: "muted" });
  });

  const waiting = [
    { x: 370, label: ["table 4", "soup", "bread"] },
    { x: 240, label: ["table 9", "steak", "fries"] },
  ];
  figure.group("waiting", () => {
    for (const ticket of waiting) {
      figure.dot({ x: ticket.x + 50, y: 36 }, 3, "amber");
      figure.box({ x: ticket.x, y: 44, width: 100, height: 76 }, { label: ticket.label, tone: "muted" });
    }
    figure.text({ x: 500, y: 22 }, "waiting tickets", { anchor: "end", tone: "muted" });
  });

  figure.group("current", () => {
    figure.dot({ x: 90, y: 36 }, 3, "terracotta");
    const current = figure.box(
      { x: 30, y: 44, width: 120, height: 76 },
      { label: ["table 7", "pasta", "salad"], tone: "accent" },
    );
    figure.text({ x: 20, y: 22 }, "the cook's ticket", { anchor: "start", tone: "accent" });
    const pantry = figure.box({ x: 20, y: 180, width: 140, height: 44 }, { label: ["pantry: basil,", "flour, eggs"] });
    // The cook calls for ingredients and gets them back, as often as the ticket needs, before moving on.
    figure.connect(current, pantry);
    figure.curve({ x: 20, y: 210 }, { x: 2, y: 150 }, { x: 30, y: 104 }, { tone: "accent" });
    figure.text({ x: 98, y: 165 }, "calls for", { anchor: "start", tone: "muted" });
    figure.box({ x: 364, y: 180, width: 136, height: 44 }, { label: ["the pass:", "the dish is done"] });
    figure.curve({ x: 150, y: 112 }, { x: 260, y: 180 }, { x: 364, y: 202 }, { tone: "muted", dashed: true });
  });

  return figure;
}
