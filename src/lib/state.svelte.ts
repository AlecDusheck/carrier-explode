/** Shared app state: routing, the context menu, and the cross-carrier scan panel. */

import type { Attachment } from "svelte/attachments";
import { on } from "svelte/events";

export type View = "carriers" | "countries" | "watch" | "cbs" | "plmn" | "compare";

export const VIEWS: Array<[View, string]> = [
  ["carriers", "Carriers"],
  ["countries", "Countries"],
  ["watch", "Watch"],
  ["cbs", "Cell Broadcast"],
  ["plmn", "PLMN Lookup"],
  ["compare", "Compare"],
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
  items = $state.raw<MenuItem[]>([]);
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

/** Right-click and long-press on an element, both opening the same menu. */
export function menuTrigger(build: () => { title: string; items: MenuItem[] }): Attachment<HTMLElement> {
  return (node) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let start: { clientX: number; clientY: number } | null = null;

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const off = [
      on(node, "contextmenu", (e) => {
        e.preventDefault();
        const { title, items } = build();
        contextMenu.show(e, title, items);
      }),
      on(node, "touchstart", (e) => {
        const t = e.touches[0];
        start = { clientX: t.clientX, clientY: t.clientY };
        timer = setTimeout(() => {
          const { title, items } = build();
          contextMenu.show(start!, title, items);
          timer = null;
        }, 450);
      }, { passive: true }),
      on(node, "touchmove", (e) => {
        if (!timer || !start) return;
        const t = e.touches[0];
        if (Math.abs(t.clientX - start.clientX) > 10 || Math.abs(t.clientY - start.clientY) > 10) cancel();
      }, { passive: true }),
      on(node, "touchend", cancel),
      on(node, "touchcancel", cancel),
    ];

    return () => {
      for (const f of off) f();
      cancel();
    };
  };
}

/**
 * The settled result of whichever promise `request` currently returns. A result is
 * matched to its promise, so a response that lands after the inputs have moved on is
 * never shown. Must be called while a component is initialising.
 */
export function resource<T>(request: () => Promise<T> | null) {
  const promise = $derived(request());
  let settled = $state.raw<{ promise: Promise<T>; value?: T; error?: string } | null>(null);

  $effect(() => {
    const p = promise;
    if (!p) return;
    let live = true;
    p.then(
      (value) => { if (live) settled = { promise: p, value }; },
      (e) => { if (live) settled = { promise: p, error: String(e?.message ?? e) }; },
    );
    return () => { live = false; };
  });

  const current = $derived(settled?.promise === promise ? settled : null);

  return {
    get value() { return current?.value; },
    get error() { return current?.error ?? null; },
    get busy() { return promise !== null && current === null; },
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
