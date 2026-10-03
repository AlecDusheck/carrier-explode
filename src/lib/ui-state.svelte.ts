/** UI state that is not in the URL: context menu, cross-bundle scan dialog, tree folding. */

import type { Attachment } from "svelte/attachments";
import { on } from "svelte/events";
import type { Platform } from "#lib/schema/types.ts";

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

/** Which sources a scan reads: every carrier of the platform, one country's carriers, or every iOS country bundle. */
export type ScanScope = "carriers" | "countries" | `country:${string}`;

/** A scan as the menu offers it: `country` stands for the tree's own country. */
interface ScopeChoice {
  readonly scope: "carriers" | "countries" | "country";
  readonly label: (cc: string) => string;
}

const APPLE_SCOPES: readonly ScopeChoice[] = [
  { scope: "country", label: (cc) => `Compare across ${cc.toUpperCase()} carriers` },
  { scope: "carriers", label: () => "Compare across all carriers" },
  { scope: "countries", label: () => "Compare across countries" },
];

/** What "compare across" offers on each platform: Android has no country bundles. */
export const SCAN_SCOPES = {
  ios: APPLE_SCOPES,
  ipados: APPLE_SCOPES,
  watchos: APPLE_SCOPES,
  android: [
    { scope: "country", label: (cc) => `Compare across ${cc.toUpperCase()} carriers` },
    { scope: "carriers", label: () => "Compare across all carriers" },
  ],
} as const satisfies Record<Platform, readonly ScopeChoice[]>;

export interface ScanQuery {
  readonly platform: Platform;
  readonly path: string;
  readonly file: string;
  readonly scope: ScanScope;
}

class ScanState {
  open = $state(false);
  query = $state<ScanQuery>({ platform: "ios", path: "", file: "carrier.plist", scope: "carriers" });

  start(q: ScanQuery): void {
    this.query = q;
    this.open = true;
  }
}

export const scan = new ScanState();

/** What one toolbar controls; several trees on a page can share it. */
export class TreeState {
  filter = $state("");
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
