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

  const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const current = () => root.dataset.theme ?? (prefersDark() ? "dark" : "light");

  document.addEventListener("DOMContentLoaded", () => {
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      const sync = () => button.setAttribute("aria-pressed", String(current() === "dark"));
      sync();
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
  });
})();
