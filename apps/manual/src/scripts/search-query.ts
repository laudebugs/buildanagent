// The search box submits ?q= to the search page, but Pagefind's component UI does not read the URL. This script
// copies the query into Pagefind's input once the component has drawn it, so the results show on arrival.

const query = new URLSearchParams(location.search).get("q")?.trim();

function fill(): boolean {
  const input = document.querySelector<HTMLInputElement>("pagefind-input input");
  if (!input || !query) return false;
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

if (query && !fill()) {
  const observer = new MutationObserver(() => {
    if (fill()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// A module, so its functions stay out of the global scope the other page scripts share.
export {};
