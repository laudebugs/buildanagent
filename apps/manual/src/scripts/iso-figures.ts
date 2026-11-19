// Progressive enhancement for an isometric figure's card (figures/lib/isokit.ts). The card's first paint is complete:
// its lit part and readout show the figure's first step, and the alt text and caption describe the whole figure. With
// this script, a card whose parts carry `data-iso-step` walks through those steps: one part at a time takes the
// accent, the readout follows, and Play, Pause and Next controls appear under the card. It only adds motion and
// controls. It plays only while the card is on screen, and it starts paused when the reader prefers reduced motion.

const STEP_MS = 1800;

interface Card {
  readonly parts: HTMLElement[];
  readonly readout: HTMLElement | null;
  readonly status: HTMLElement;
  readonly play: HTMLButtonElement;
  index: number;
  timer: ReturnType<typeof setInterval> | undefined;
  visible: boolean;
  playing: boolean;
}

function show(card: Card, index: number): void {
  card.index = index;
  card.parts.forEach((part, i) => {
    // The kit marks a lit part on its solid's group, and its CSS draws that part in the accent.
    part.querySelector(".iso-solid")?.toggleAttribute("data-lit", i === index);
  });
  const text = card.parts[index]?.dataset.isoReadout ?? "";
  if (card.readout) card.readout.textContent = text;
  card.status.textContent = text;
}

function schedule(card: Card): void {
  clearInterval(card.timer);
  card.timer = undefined;
  if (card.playing && card.visible) {
    card.timer = setInterval(() => show(card, (card.index + 1) % card.parts.length), STEP_MS);
  }
  card.play.textContent = card.playing ? "Pause" : "Play";
  card.play.setAttribute("aria-pressed", String(card.playing));
}

function button(label: string): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "control";
  control.textContent = label;
  return control;
}

function enhance(root: HTMLElement): void {
  const parts = [...root.querySelectorAll<HTMLElement>("[data-iso-step]")].sort(
    (a, b) => Number(a.dataset.isoStep) - Number(b.dataset.isoStep),
  );
  if (parts.length < 2) return;
  const controls = document.createElement("div");
  controls.className = "controls iso-figure__controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Figure steps");
  const play = button("Play");
  const next = button("Next");
  const status = document.createElement("span");
  // The card's corners are hidden from screen readers, so this hidden status reads each step's readout aloud.
  status.className = "visually-hidden";
  status.setAttribute("aria-live", "polite");
  controls.append(play, next, status);
  root.append(controls);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const card: Card = {
    parts,
    readout: root.querySelector<HTMLElement>("[data-readout]"),
    status,
    play,
    index: 0,
    timer: undefined,
    visible: false,
    playing: !reduced,
  };
  play.addEventListener("click", () => {
    card.playing = !card.playing;
    schedule(card);
  });
  next.addEventListener("click", () => {
    card.playing = false;
    schedule(card);
    show(card, (card.index + 1) % card.parts.length);
  });
  new IntersectionObserver(([entry]) => {
    card.visible = entry?.isIntersecting ?? false;
    schedule(card);
  }).observe(root);
  root.dataset.enhanced = "";
  show(card, 0);
  schedule(card);
}

for (const root of document.querySelectorAll<HTMLElement>(".iso-figure[data-figure]")) enhance(root);

// A module, so its functions stay out of the global scope the other page scripts share.
export {};
