// The retrieval chapter's figure for the tenant filter: Acme's query "settings export" ranked across both tenants and
// then filtered, against filtered to Acme's articles and then ranked. The ids and their order come from T41's example:
// its comment and checks give the left column, and the committed transcript's sixth run gives the right one.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "filter-before-rank", width: 520, height: 340 });

  figure.group("query", () => {
    figure.box({ x: 150, y: 8, width: 220, height: 34 }, { label: "query: settings export" });
    figure.line([
      { x: 260, y: 42 },
      { x: 260, y: 56 },
      { x: 130, y: 56 },
    ]);
    figure.line([
      { x: 260, y: 56 },
      { x: 390, y: 56 },
    ]);
    figure.arrow({ x: 130, y: 56 }, { x: 130, y: 76 });
    figure.arrow({ x: 390, y: 56 }, { x: 390, y: 76 }, { tone: "accent" });
  });

  figure.group("rank-first", () => {
    const step1 = figure.box({ x: 10, y: 76, width: 240, height: 34 }, { label: "1. rank all 14 articles" });
    const step2 = figure.box({ x: 10, y: 130, width: 240, height: 34 }, { label: "2. keep Acme's" });
    figure.connect(step1, step2);
    const out = figure.box(
      { x: 10, y: 184, width: 240, height: 78 },
      { label: ["kb-04 single sign-on", "kb-02 reset a password", "kb-08 delete a workspace"] },
    );
    figure.connect(step2, out);
    figure.text({ x: 130, y: 286 }, "export: in 6 of 14,", { tone: "muted" });
    figure.text({ x: 130, y: 304 }, "so a common word", { tone: "muted" });
    figure.text({ x: 130, y: 330 }, "rank first: no export article", { tone: "muted" });
  });

  figure.group("filter-first", () => {
    const step1 = figure.box(
      { x: 270, y: 76, width: 240, height: 34 },
      { tone: "accent", label: "1. keep Acme's 9 articles" },
    );
    const step2 = figure.box({ x: 270, y: 130, width: 240, height: 34 }, { tone: "accent", label: "2. rank them" });
    figure.connect(step1, step2, { tone: "accent" });
    const out = figure.box(
      { x: 270, y: 184, width: 240, height: 78 },
      { tone: "accent", label: ["kb-10 planted export", "kb-01 export failed", "kb-04 single sign-on"] },
    );
    figure.connect(step2, out, { tone: "accent" });
    figure.text({ x: 390, y: 286 }, "export: in 2 of 9,", { tone: "accent" });
    figure.text({ x: 390, y: 304 }, "so a rare word", { tone: "accent" });
    figure.text({ x: 390, y: 330 }, "filter first: the tool's order", { tone: "accent" });
  });

  return figure;
}
