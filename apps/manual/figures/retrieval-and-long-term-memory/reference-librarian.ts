// The retrieval chapter's analogy illustration: a reference librarian who fetches the few books you need. The stacks
// stand for the corpus, the librarian for the search tool and its ranking, and the desk for the model's request, which
// holds only what the librarian chose. The register's reference-librarian entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "reference-librarian", width: 520, height: 224 });

  figure.group("stacks", () => {
    figure.text({ x: 90, y: 16 }, "the stacks", { tone: "muted" });
    figure.box({ x: 10, y: 26, width: 160, height: 140 }, { tone: "muted" });
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        figure.box({ x: 22 + column * 20, y: 38 + row * 30, width: 14, height: 22 }, { tone: "muted" });
      }
    }
    figure.text({ x: 90, y: 188 }, "100,000 books", { tone: "muted" });
    figure.text({ x: 90, y: 212 }, "like: the corpus", { tone: "muted" });
  });

  figure.group("librarian", () => {
    figure.box(
      { x: 192, y: 66, width: 136, height: 60 },
      { tone: "accent", label: ["the librarian", "ranks the stock"] },
    );
    figure.text({ x: 260, y: 16 }, "question: failed export", { tone: "muted" });
    figure.arrow({ x: 260, y: 26 }, { x: 260, y: 66 }, { tone: "muted" });
    figure.text({ x: 260, y: 150 }, "like: the search", { tone: "muted" });
    figure.text({ x: 260, y: 168 }, "tool and its ranking", { tone: "muted" });
  });

  figure.group("desk", () => {
    figure.text({ x: 430, y: 16 }, "your desk", { tone: "accent" });
    figure.box({ x: 350, y: 26, width: 160, height: 140 }, { tone: "accent" });
    figure.box({ x: 390, y: 60, width: 34, height: 72 }, { label: ["1"] });
    figure.box({ x: 436, y: 60, width: 34, height: 72 }, { label: ["2"] });
    figure.text({ x: 430, y: 188 }, "two books", { tone: "accent" });
    figure.text({ x: 430, y: 212 }, "like: the request", { tone: "muted" });
  });

  figure.group("trips", () => {
    figure.arrow({ x: 170, y: 96 }, { x: 192, y: 96 }, { tone: "muted" });
    figure.arrow({ x: 328, y: 96 }, { x: 350, y: 96 }, { tone: "accent" });
  });

  return figure;
}
