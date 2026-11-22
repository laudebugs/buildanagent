// The session-log chapter's isometric centerpiece: the log as a bench of entry blocks. Six entries run along the back
// row, each linked to the one it follows. A second row forks from the third entry and stays on the bench as an
// abandoned path. The fifth entry is a compaction, a taller block, and HEAD is a post with a lamp on the last entry.
// Each step lights one part, in the order the chapter explains them: an append, the fork, the compaction, HEAD.
import { audit, IsoFigure, IsoParts, kit, type Plan } from "../lib/isokit.js";

const WIDTH = 520;
const HEIGHT = 300;

const PLATE: Plan = { x: -150, y: -74, w: 300, d: 150, r: 8 };
const PLATE_H = 8;
const FOOT_H = 4;

const ENTRY_W = 30;
const ENTRY_D = 24;
const ENTRY_H = 6;
const COMPACTION_H = 14;
const PITCH = 42;
const FIRST_X = -138;
const ROW_A = -52;
const ROW_B = 8;
const LINK_H = 1.6;

const LAMP_R = 3.2;
const LAMP_H = 2;

/** The steps in order: the part each one lights and the readout it shows. */
const STEPS = [
  { part: "append", readout: "1/4 · append: an entry names its parent" },
  { part: "fork", readout: "2/4 · fork: a second child, nothing erased" },
  { part: "compaction", readout: "3/4 · compaction: one entry, no deletion" },
  { part: "head", readout: "4/4 · HEAD: where the next append goes" },
] as const;
const step = (index: number): Record<string, string> => ({
  id: `session-log-tree--step-${STEPS[index]?.part}`,
  "data-iso-step": String(index),
  "data-iso-readout": STEPS[index]?.readout ?? "",
});

export default function draw(): IsoFigure {
  const P = kit.fitProjection(
    [...kit.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [FIRST_X + 5 * PITCH + ENTRY_W / 2, ROW_A, 30]],
    WIDTH,
    HEIGHT,
    { pad: 16 },
  );
  const x = (index: number): number => FIRST_X + index * PITCH;
  const R = audit.recorder(P);
  const parts = new IsoParts(P, R);

  // The bench: feet, a plate and the labels engraved on it, in the free strip between the rows and beside the fork.
  for (const [index, [x, y]] of kit.corners(PLATE, 16).entries()) {
    parts.cylinder(`stand.foot#${index + 1}`, [x, y], 6, -PLATE_H - FOOT_H, FOOT_H, { tone: "lo" });
  }
  parts.slab("stand.plate", PLATE, -PLATE_H, PLATE_H, {
    tone: "mid",
    bevel: 1.2,
    marks: [
      kit.lineSvg(kit.planOutline(kit.insetPlan(PLATE, 5), 0, P), { tone: "faint" }),
      parts.label("entries", [FIRST_X, ROW_A + ENTRY_D + 14], 0),
      parts.label("fork", [x(2), ROW_B + 16], 0),
      parts.label("compaction", [x(4) - 8, ROW_A + ENTRY_D + 14], 0),
      parts.label("HEAD", [FIRST_X + 5 * PITCH - 6, ROW_A + ENTRY_D + 14], 0),
    ].join(""),
  });

  // The back row: entries 1 to 6, each with a link to the next. The fifth is the compaction.
  for (let index = 0; index < 6; index += 1) {
    const compaction = index === 4;
    const plan: Plan = { x: x(index), y: ROW_A, w: ENTRY_W, d: ENTRY_D, r: 1 };
    parts.slab(`entry#${index + 1}`, plan, 0, compaction ? COMPACTION_H : ENTRY_H, {
      tone: compaction ? "hi" : "mid",
      bevel: 0.5,
      marks: kit.lineSvg(kit.planOutline(kit.insetPlan(plan, 4), compaction ? COMPACTION_H : ENTRY_H, P), {
        tone: "faint",
      }),
    });
    if (index < 5) {
      parts.slab(
        `link#${index + 1}`,
        { x: x(index) + ENTRY_W, y: ROW_A + ENTRY_D / 2 - 2, w: PITCH - ENTRY_W, d: 4, r: 0.5 },
        0,
        LINK_H,
        { tone: "lo" },
      );
    }
  }

  // The fork: a link from the third entry down to a second row of two entries that the active path no longer follows.
  parts.slab(
    "fork.link",
    { x: x(2) + ENTRY_W / 2 - 2, y: ROW_A + ENTRY_D, w: 4, d: ROW_B - ROW_A - ENTRY_D, r: 0.5 },
    0,
    LINK_H,
    {
      tone: "lo",
    },
  );
  for (let index = 0; index < 2; index += 1) {
    const plan: Plan = { x: x(2 + index), y: ROW_B, w: ENTRY_W, d: ENTRY_D, r: 1 };
    parts.slab(`fork.entry#${index + 1}`, plan, 0, ENTRY_H, { tone: "lo", bevel: 0.5 });
    if (index === 0) {
      parts.slab(
        "fork.link2",
        { x: x(2) + ENTRY_W, y: ROW_B + ENTRY_D / 2 - 2, w: PITCH - ENTRY_W, d: 4, r: 0.5 },
        0,
        LINK_H,
        {
          tone: "lo",
        },
      );
    }
  }

  // The lamps: one lit part per step.
  parts.cylinder("append.lamp", [x(1) + ENTRY_W / 2, ROW_A + ENTRY_D / 2], LAMP_R, ENTRY_H, LAMP_H, {
    tone: "hi",
    attributes: step(0),
  });
  parts.cylinder("fork.lamp", [x(2) + ENTRY_W / 2, ROW_B + ENTRY_D / 2], LAMP_R, ENTRY_H, LAMP_H, {
    tone: "hi",
    attributes: step(1),
  });
  parts.cylinder("compaction.lamp", [x(4) + ENTRY_W / 2, ROW_A + ENTRY_D / 2], LAMP_R, COMPACTION_H, LAMP_H, {
    tone: "hi",
    attributes: step(2),
  });
  // HEAD: a post on the last entry with a lamp on top.
  const head: [number, number] = [x(5) + ENTRY_W / 2, ROW_A + ENTRY_D / 2];
  parts.cylinder("head.post", head, 2, ENTRY_H, 12, { tone: "mid" });
  parts.cylinder("head.lamp", head, LAMP_R, ENTRY_H + 12, LAMP_H, { tone: "hi", attributes: step(3) });

  return new IsoFigure({
    id: "session-log-tree",
    width: WIDTH,
    height: HEIGHT,
    title: "Session log",
    hint: "One part lights per step",
    readout: STEPS[0].readout,
    projection: P,
    recorder: R,
  });
}
