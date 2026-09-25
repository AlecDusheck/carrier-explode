/** UI state that is not in the URL: context menu, cross-bundle scan dialog, tree folding. */

import type { Attachment } from "svelte/attachments";
import { on } from "svelte/events";

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

  show(at: { clientX: number; clientY: number }, title: string, items: MenuItem[]) {
    this.x = Math.min(at.clientX, Math.max(8, innerWidth - 240));
    this.y = Math.min(at.clientY, Math.max(8, innerHeight - 40 - items.length * 26));
    this.title = title;
    this.items = items;
    this.open = true;
  }

  hide() {
    this.open = false;
  }
}

export const contextMenu = new ContextMenuState();

/** Which bundles a scan reads: every country bundle, every carrier, or one country's carriers. */
export type ScanScope = "countries" | "all" | `country:${string}`;

class ScanState {
  open = $state(false);
  path = $state("");
  file = $state("carrier.plist");
  scope = $state<ScanScope>("countries");

  start(path: string, file: string, scope: ScanScope) {
    this.path = path;
    this.file = file;
    this.scope = scope;
    this.open = true;
  }
}

export const scan = new ScanState();

/** A node's own open/closed choice, stamped with the expand-all or collapse-all it was made after. */
export interface FoldToggle { epoch: number; open: boolean }

/**
 * Expand all / collapse all over a tree whose nodes also open one by one. A
 * node's own toggle counts until the next expand-all or collapse-all.
 */
export class Folding {
  #epoch = $state(0);
  #all = $state<boolean | null>(null);

  expandAll() { this.#set(true); }
  collapseAll() { this.#set(false); }

  #set(open: boolean) {
    this.#all = open;
    this.#epoch++;
  }

  /** The toggle a node stores when it is opened or closed by hand. */
  toggle(open: boolean): FoldToggle {
    return { epoch: this.#epoch, open };
  }

  /** Whether a node is open: its own toggle, else the last expand/collapse-all, else `auto`. */
  openFor(auto: boolean, toggled: FoldToggle | null | undefined): boolean {
    if (toggled?.epoch === this.#epoch) return toggled.open;
    return this.#all ?? auto;
  }
}

/** Adds `key` to the set, or removes it when it is there. */
export function toggleIn<T>(set: Set<T>, key: T) {
  if (!set.delete(key)) set.add(key);
}

/** Right-click and long-press on an element, both opening the same menu. */
export function menuTrigger(build: () => { title: string; items: MenuItem[] }): Attachment<HTMLElement> {
  return (node) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let start: { clientX: number; clientY: number } | null = null;
    // A long-press on a link would otherwise also follow it when the finger lifts.
    let fired = false;

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
        fired = false;
        timer = setTimeout(() => {
          const { title, items } = build();
          contextMenu.show(start!, title, items);
          fired = true;
          timer = null;
        }, 450);
      }, { passive: true }),
      on(node, "touchmove", (e) => {
        if (!timer || !start) return;
        const t = e.touches[0];
        if (Math.abs(t.clientX - start.clientX) > 10 || Math.abs(t.clientY - start.clientY) > 10) cancel();
      }, { passive: true }),
      on(node, "touchend", (e) => {
        cancel();
        if (fired) e.preventDefault();
      }),
      on(node, "touchcancel", cancel),
    ];

    return () => {
      for (const f of off) f();
      cancel();
    };
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
