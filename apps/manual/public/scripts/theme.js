// The reader's theme choice. The page loads this file as a blocking script in <head>, so a stored choice applies
// before the first paint and the page never flashes the other mode. Without JavaScript the page follows
// prefers-color-scheme and the toggle stays hidden. The file is served as-is from public/, not bundled, so it stays
// a same-origin script that a content security policy can allow by path.
(() => {
  const KEY = "manual-theme";
  const root = document.documentElement;
  const read = () => {
    try {
      const value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  };
  const stored = read();
  if (stored) root.dataset.theme = stored;

  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  const current = () => root.dataset.theme ?? (scheme.matches ? "dark" : "light");

  document.addEventListener("DOMContentLoaded", () => {
    const buttons = [...document.querySelectorAll("[data-theme-toggle]")];
    // The label names what a press does, so it always offers the other mode.
    const sync = () => {
      const label = current() === "dark" ? "Switch to light theme" : "Switch to dark theme";
      for (const button of buttons) button.textContent = label;
    };
    // With no stored choice the page follows the system, so the label follows it too.
    scheme.addEventListener("change", sync);
    for (const button of buttons) {
      button.hidden = false;
      button.addEventListener("click", () => {
        const next = current() === "dark" ? "light" : "dark";
        root.dataset.theme = next;
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // Storage can be off; the choice then lasts for this page only.
        }
        sync();
      });
    }
    sync();
  });
})();
