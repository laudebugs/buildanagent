// Progressive enhancement for `.tabs`: without this script every panel shows under its own heading. With it, a tab
// list built from those headings shows one panel at a time, following the WAI-ARIA tabs pattern with automatic
// activation (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

function select(tabs: HTMLButtonElement[], panels: HTMLElement[], index: number, focus: boolean): void {
  tabs.forEach((tab, i) => {
    const selected = i === index;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = panels[i];
    if (panel) panel.hidden = !selected;
  });
  if (focus) tabs[index]?.focus();
}

function nextIndex(key: string, index: number, count: number): number | undefined {
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}

function enhance(root: HTMLElement): void {
  const panels = [...root.querySelectorAll<HTMLElement>(":scope > .tabs__panel")];
  if (panels.length === 0) return;
  const list = document.createElement("div");
  list.className = "tabs__list";
  list.setAttribute("role", "tablist");
  const label = root.dataset.label;
  if (label) list.setAttribute("aria-label", label);
  const tabs = panels.map((panel, i) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tabs__tab";
    tab.id = `${panel.id}-tab`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    tab.textContent = panel.querySelector(".tabs__heading")?.textContent?.trim() ?? `Tab ${i + 1}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    list.append(tab);
    return tab;
  });
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tabs, panels, i, false));
    tab.addEventListener("keydown", (event) => {
      const next = nextIndex(event.key, i, tabs.length);
      if (next === undefined) return;
      event.preventDefault();
      select(tabs, panels, next, true);
    });
  });
  root.prepend(list);
  root.dataset.enhanced = "";
  select(tabs, panels, 0, false);
}

for (const root of document.querySelectorAll<HTMLElement>(".tabs")) enhance(root);

// A module, so its functions stay out of the global scope the other page scripts share.
export {};
