// The fixture book's sample isometric centerpiece: a bench with the agent loop's three stations, the context stack,
// the model and the tool, each with a lamp that lights while the loop is at that station. It is small on purpose; it
// shows that an isometric figure passes the anatomy skill's audit and line check in both themes and inlines into a
// chapter, as T10's, T20's and T22's centerpieces will.
import { audit, IsoFigure, IsoParts, kit, type Plan } from "../../../../../figures/lib/isokit.js";

const WIDTH = 480;
const HEIGHT = 260;

const PLATE: Plan = { x: -100, y: -70, w: 200, d: 140, r: 8 };
const PLATE_H = 8;
const FOOT_H = 4;
const STRIP: Plan = { x: -86, y: 54, w: 120, d: 8, r: 1 };

const CONTEXT: Plan = { x: -84, y: -54, w: 48, d: 36, r: 2 };
const PAGE_H = 4;
const PAGES = 3;
const MODEL: [number, number] = [6, -16];
const MODEL_R = 20;
const MODEL_H = 18;
const CAP_R = 11;
const CAP_H = 4;
const TOOL: Plan = { x: 34, y: 8, w: 46, d: 32, r: 3 };
const TOOL_H = 12;
const LAMP_R = 3.2;
const LAMP_H = 2;

/** The stations in the order the loop visits them, with the readout each shows while its lamp is lit. */
const STATIONS = ["context", "model", "tool"] as const;
const readout = (step: number): string => `step ${step + 1} of ${STATIONS.length} · ${STATIONS[step]}`;
// Each lamp has an id, which the inliner prefixes when a page shows the figure twice, as the gallery does.
const step = (index: number): Record<string, string> => ({
  id: `loop-bench--lamp-${STATIONS[index]}`,
  "data-iso-step": String(index),
  "data-iso-readout": readout(index),
});

export default function draw(): IsoFigure {
  const P = kit.fitProjection(
    [...kit.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [MODEL[0], MODEL[1], MODEL_H + CAP_H + LAMP_H]],
    WIDTH,
    HEIGHT,
    { pad: 16 },
  );
  const R = audit.recorder(P);
  const parts = new IsoParts(P, R);

  for (const [index, [x, y]] of kit.corners(PLATE, 16).entries()) {
    parts.cylinder(`stand.foot#${index + 1}`, [x, y], 6, -PLATE_H - FOOT_H, FOOT_H, { tone: "lo" });
  }
  const screws = kit.corners(PLATE, 8);
  const ticks = kit.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y + 0.8, 0.6, [1.8, 3.4], P);
  parts.slab("stand.plate", PLATE, -PLATE_H, PLATE_H, {
    tone: "mid",
    bevel: 1.2,
    marks: [
      kit.lineSvg(kit.planOutline(kit.insetPlan(PLATE, 5), 0, P), { tone: "faint" }),
      kit.lineSvg(screws.map(([x, y]) => kit.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }),
      parts.label("model", [MODEL[0] - 42, MODEL[1] + MODEL_R + 10], 0),
      kit.dotsSvg(
        screws.map(([x, y]) => kit.iso([x, y, 0], P)),
        { size: 0.5 },
      ),
    ].join(""),
  });
  parts.slab("strip", STRIP, 0, 0.6, {
    tone: "lo",
    marks: kit.lineSvg(ticks.minor, { tone: "lo" }) + kit.lineSvg(ticks.major, { tone: "mid" }),
  });

  for (let page = 0; page < PAGES; page++) {
    const top = (page + 1) * PAGE_H;
    parts.slab(`context.page#${page + 1}`, kit.insetPlan(CONTEXT, page * 1.5), page * PAGE_H, PAGE_H, {
      tone: page === PAGES - 1 ? "hi" : "mid",
      ...(page === PAGES - 1 ? { marks: parts.label("context", [CONTEXT.x + 5, CONTEXT.y + 29], top) } : {}),
    });
  }
  parts.cylinder("context.lamp", [CONTEXT.x + CONTEXT.w - 10, CONTEXT.y + 10], LAMP_R, PAGES * PAGE_H, LAMP_H, {
    tone: "hi",
    lit: true,
    attributes: step(0),
  });

  parts.cylinder("model.body", MODEL, MODEL_R, 0, MODEL_H, { tone: "hi", bevel: 1 });
  parts.cylinder("model.cap", MODEL, CAP_R, MODEL_H, CAP_H, { tone: "mid" });
  parts.cylinder("model.lamp", MODEL, LAMP_R, MODEL_H + CAP_H, LAMP_H, { tone: "hi", attributes: step(1) });

  parts.slab("tool.block", TOOL, 0, TOOL_H, {
    tone: "hi",
    bevel: 0.8,
    marks: parts.label("tool", [TOOL.x + 5, TOOL.y + 26], TOOL_H),
  });
  parts.cylinder("tool.lamp", [TOOL.x + TOOL.w - 8, TOOL.y + 8], LAMP_R, TOOL_H, LAMP_H, {
    tone: "hi",
    attributes: step(2),
  });

  return new IsoFigure({
    id: "loop-bench",
    width: WIDTH,
    height: HEIGHT,
    title: "Agent loop",
    hint: "Watch the lamps",
    readout: readout(0),
    projection: P,
    recorder: R,
  });
}
