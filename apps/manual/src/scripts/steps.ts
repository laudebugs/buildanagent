// Progressive enhancement for the figure stepper and the replay of a recorded run. Both render every step in the
// HTML, so the page is complete without this script. With it, the stepper shows one step at a time and dims the
// figure parts of the other steps, and the replay reveals events up to the current one, with an optional autoplay.

interface Steps {
  readonly root: HTMLElement;
  readonly items: HTMLElement[];
  readonly status: HTMLElement | null;
  readonly unit: string;
  index: number;
}

function button(root: HTMLElement, action: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`[data-step-action="${action}"]`);
}

function render(steps: Steps): void {
  const { root, items, index } = steps;
  const cumulative = root.dataset.steps === "cumulative";
  items.forEach((item, i) => {
    if (cumulative) item.toggleAttribute("data-future", i > index);
    else if (i === index) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  const current = items[index]?.dataset.step;
  for (const part of root.querySelectorAll<SVGElement | HTMLElement>("[data-step-part]")) {
    const parts = (part.dataset.stepPart ?? "").split(/\s+/);
    part.toggleAttribute("data-dimmed", current !== undefined && !parts.includes(current));
  }
  if (steps.status) steps.status.textContent = `${steps.unit} ${index + 1} of ${items.length}`;
  const back = button(root, "back");
  const next = button(root, "next");
  disable(back, index === 0, next);
  disable(next, index === items.length - 1, back);
}

// A disabled button drops keyboard focus to the page, so focus moves to the other button first.
function disable(control: HTMLButtonElement | null, disabled: boolean, other: HTMLButtonElement | null): void {
  if (!control) return;
  if (disabled && document.activeElement === control) other?.focus();
  control.disabled = disabled;
}

function go(steps: Steps, index: number): void {
  steps.index = Math.max(0, Math.min(steps.items.length - 1, index));
  render(steps);
}

function autoplay(steps: Steps): void {
  const play = button(steps.root, "play");
  if (!play) return;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    play.setAttribute("aria-pressed", "false");
  };
  play.addEventListener("click", () => {
    if (timer !== undefined) return stop();
    if (steps.index === steps.items.length - 1) go(steps, 0);
    play.setAttribute("aria-pressed", "true");
    timer = setInterval(() => {
      if (steps.index === steps.items.length - 1) return stop();
      go(steps, steps.index + 1);
    }, 1500);
  });
  for (const action of ["back", "next", "restart"]) button(steps.root, action)?.addEventListener("click", stop);
}

function enhance(root: HTMLElement): void {
  const items = [...root.querySelectorAll<HTMLElement>("[data-step]")];
  if (items.length < 2) return;
  const steps: Steps = {
    root,
    items,
    status: root.querySelector<HTMLElement>("[data-step-status]"),
    unit: root.dataset.stepUnit ?? "Step",
    index: 0,
  };
  button(root, "back")?.addEventListener("click", () => go(steps, steps.index - 1));
  button(root, "next")?.addEventListener("click", () => go(steps, steps.index + 1));
  button(root, "restart")?.addEventListener("click", () => go(steps, 0));
  autoplay(steps);
  for (const controls of root.querySelectorAll<HTMLElement>("[data-step-controls]")) controls.hidden = false;
  root.dataset.enhanced = "";
  render(steps);
}

for (const root of document.querySelectorAll<HTMLElement>("[data-steps]")) enhance(root);

// A module, so its functions stay out of the global scope the other page scripts share.
export {};
