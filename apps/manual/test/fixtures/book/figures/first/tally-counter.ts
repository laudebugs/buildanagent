// The fixture book's sample isometric analogy illustration: a hand tally counter on a bench, the fixture register's
// tally-counter entry. It shows that the `analogy` figure kind can be drawn with the anatomy skill and passes the same
// audit and line check as a technical figure.
import { audit, IsoFigure, IsoParts, kit, type Plan } from "../../../../../figures/lib/isokit.js";

const WIDTH = 420;
const HEIGHT = 220;

const BENCH: Plan = { x: -70, y: -55, w: 140, d: 110, r: 6 };
const BENCH_H = 6;
const HOUSING: Plan = { x: -40, y: -26, w: 80, d: 52, r: 10 };
const HOUSING_H = 22;
const WINDOW: Plan = { x: -30, y: -4, w: 44, d: 18, r: 2 };
const WINDOW_H = 0.8;
const PLUNGER: [number, number] = [24, -10];
const STEM_R = 4;
const STEM_H = 10;
const CAP_R = 8;
const CAP_H = 4;
const KNOB: [number, number] = [-26, -14];
const KNOB_R = 5;
const KNOB_H = 3;
const COUNT = 3;
const STRIP: Plan = { x: -60, y: 38, w: 80, d: 7, r: 1 };

export default function draw(): IsoFigure {
  const P = kit.fitProjection(
    [...kit.boxCorners(BENCH, -BENCH_H, 0), [PLUNGER[0], PLUNGER[1], HOUSING_H + STEM_H + CAP_H]],
    WIDTH,
    HEIGHT,
    { pad: 16 },
  );
  const R = audit.recorder(P);
  const parts = new IsoParts(P, R);

  const screws = kit.corners(BENCH, 8);
  parts.slab("stand.bench", BENCH, -BENCH_H, BENCH_H, {
    tone: "lo",
    bevel: 1,
    marks: [
      kit.lineSvg(kit.planOutline(kit.insetPlan(BENCH, 4), 0, P), { tone: "faint" }),
      kit.dotsSvg(
        screws.map(([x, y]) => kit.iso([x, y, 0], P)),
        { size: 0.5 },
      ),
    ].join(""),
  });
  const ticks = kit.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y + 0.8, 0.6, [1.6, 3], P);
  parts.slab("strip", STRIP, 0, 0.6, {
    tone: "lo",
    marks: kit.lineSvg(ticks.minor, { tone: "lo" }) + kit.lineSvg(ticks.major, { tone: "mid" }),
  });
  parts.slab("counter.housing", HOUSING, 0, HOUSING_H, {
    tone: "mid",
    bevel: 1.4,
    marks: kit.lineSvg(kit.planOutline(kit.insetPlan(HOUSING, 3), HOUSING_H, P), { tone: "faint" }),
  });
  parts.slab("counter.window", WINDOW, HOUSING_H, WINDOW_H, {
    tone: "hi",
    marks: parts.label(String(COUNT).padStart(4, "0"), [WINDOW.x + 4, WINDOW.y + 14], HOUSING_H + WINDOW_H),
  });
  parts.cylinder("counter.knob", KNOB, KNOB_R, HOUSING_H, KNOB_H, { tone: "mid" });
  parts.cylinder("counter.stem", PLUNGER, STEM_R, HOUSING_H, STEM_H, { tone: "mid" });
  parts.cylinder("counter.cap", PLUNGER, CAP_R, HOUSING_H + STEM_H, CAP_H, { tone: "hi", lit: true });

  return new IsoFigure({
    id: "tally-counter",
    width: WIDTH,
    height: HEIGHT,
    title: "Tally counter",
    hint: "One click per step",
    readout: `count ${COUNT}`,
    projection: P,
    recorder: R,
  });
}
