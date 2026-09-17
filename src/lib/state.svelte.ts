/** Shared app state: routing, the context menu, and the cross-carrier scan panel. */

export type View = "carriers" | "countries" | "watch" | "cbs" | "plmn" | "compare" | "about";

export const VIEWS: Array<[View, string]> = [
  ["carriers", "Carriers"],
  ["countries", "Countries"],
  ["watch", "Watch"],
  ["cbs", "Cell Broadcast"],
  ["plmn", "PLMN Lookup"],
  ["compare", "Compare"],
  ["about", "About"],
];

function parseHash(): { view: View; name: string | null } {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [head, ...rest] = raw.split("/");
  const view = VIEWS.some(([v]) => v === head) ? (head as View) : "carriers";
  return { view, name: rest.join("/") || null };
}

class Router {
  view = $state<View>("carriers");
  name = $state<string | null>(null);

  constructor() {
    const r = parseHash();
    this.view = r.view;
    this.name = r.name;
  }

  sync() {
    const r = parseHash();
    this.view = r.view;
    this.name = r.name;
  }

  go(view: View, name?: string | null) {
    location.hash = "#/" + view + (name ? "/" + encodeURIComponent(name) : "");
    this.view = view;
    this.name = name ?? null;
  }
}

export const router = new Router();

export interface MenuItem {
  label: string;
  run?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

class ContextMenuState {
  x = $state(0);
  y = $state(0);
  title = $state("");
  items = $state<MenuItem[]>([]);
  open = $state(false);

  show(ev: { clientX: number; clientY: number }, title: string, items: MenuItem[]) {
    this.x = Math.min(ev.clientX, Math.max(8, innerWidth - 240));
    this.y = Math.min(ev.clientY, Math.max(8, innerHeight - 40 - items.length * 26));
    this.title = title;
    this.items = items;
    this.open = true;
  }

  hide() {
    this.open = false;
  }
}

export const contextMenu = new ContextMenuState();

class ScanState {
  open = $state(false);
  path = $state("");
  file = $state("carrier.plist");
  scope = $state("countries");
  limit = $state(40);

  start(path: string, file: string, scope: string, limit = 40) {
    this.path = path;
    this.file = file;
    this.scope = scope;
    this.limit = limit;
    this.open = true;
  }
}

export const scan = new ScanState();

/** Attaches right-click and long-press to an element, both opening the same menu. */
export function menuTrigger(
  node: HTMLElement,
  build: () => { title: string; items: MenuItem[] },
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { clientX: number; clientY: number } | null = null;

  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    const { title, items } = build();
    contextMenu.show(e, title, items);
  };
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    start = { clientX: t.clientX, clientY: t.clientY };
    timer = setTimeout(() => {
      const { title, items } = build();
      contextMenu.show(start!, title, items);
      timer = null;
    }, 450);
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!timer || !start) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - start.clientX) > 10 || Math.abs(t.clientY - start.clientY) > 10) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const onTouchEnd = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  node.addEventListener("contextmenu", onContext);
  node.addEventListener("touchstart", onTouchStart, { passive: true });
  node.addEventListener("touchmove", onTouchMove, { passive: true });
  node.addEventListener("touchend", onTouchEnd);
  node.addEventListener("touchcancel", onTouchEnd);

  return {
    destroy() {
      node.removeEventListener("contextmenu", onContext);
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
      if (timer) clearTimeout(timer);
    },
  };
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch { /* clipboard unavailable */ }
    ta.remove();
  }
}
