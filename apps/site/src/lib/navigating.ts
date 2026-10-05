import { navigating, page } from "$app/state";

/** Whether the navigation under way goes to `href`, so the link that started it can show it is loading. */
export function isNavigatingTo(href: string): boolean {
  const to = navigating.to?.url;
  if (!to) return false;
  const target = new URL(href, page.url.href);
  return to.pathname === target.pathname && to.search === target.search;
}
