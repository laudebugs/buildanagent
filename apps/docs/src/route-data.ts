import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
// The plugin's declaration file adds `starlightSidebarTopics` to the request locals.
import type {} from "starlight-sidebar-topics";

// The topic tabs mark the current one only by colour, a filled icon and a class. The plugin's attributes for a tab are
// the same for every page, so this middleware, which runs after the plugin's, adds `aria-current="page"` to the current
// tab of the page being rendered. It replaces the tab's `attrs` object, because the plugin shares the original across
// pages and writing into it would mark the tab on every later page.
export const onRequest = defineRouteMiddleware((context) => {
  for (const topic of context.locals.starlightSidebarTopics?.topics ?? []) {
    if (topic.isCurrent) topic.attrs = { ...topic.attrs, "aria-current": "page" };
  }
});
