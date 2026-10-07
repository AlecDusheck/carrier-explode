/** UI state that is not in the URL: context menu, cross-bundle scan dialog, tree folding. */

import type { Attachment } from "svelte/attachments";
import { on } from "svelte/events";
import { opensMenu } from "./keys.ts";
import { shipsKind, type Platform } from "@carrier-explode/schema/types";

export type MenuItem =
	| { readonly kind: "action"; readonly label: string; readonly run: () => void }
	| { readonly kind: "separator" };

class ContextMenuState {
	x = $state(0);
	y = $state(0);
	title = $state("");
	items = $state.raw<MenuItem[]>([]);
	open = $state(false);
	/** What opened the menu: focus goes back there when the menu is left by keyboard or an item is chosen. */
	#trigger: HTMLElement | null = null;

	show(at: { clientX: number; clientY: number }, title: string, items: MenuItem[], trigger: HTMLElement) {
		this.x = Math.min(at.clientX, Math.max(8, innerWidth - 240));
		this.y = Math.min(at.clientY, Math.max(8, innerHeight - 40 - items.length * 26));
		this.title = title;
		this.items = items;
		this.open = true;
		this.#trigger = trigger;
	}

	hide(refocus: boolean) {
		this.open = false;
		if (refocus) this.#trigger?.focus({ preventScroll: true });
	}
}

export const contextMenu = new ContextMenuState();

/** Which sources a scan reads: every carrier of the platform, one country's carriers, or every iOS country bundle. */
export type ScanScope = "carriers" | "countries" | `country:${string}`;

/** A scan as the menu offers it (`country` stands for the source's own country), and as the dialog's Scope select names it. */
interface ScopeChoice {
	readonly scope: "carriers" | "countries" | "country";
	readonly menu: (cc: string) => string;
	readonly option: (cc: string) => string;
}

const COUNTRY: ScopeChoice = {
	scope: "country",
	menu: (cc) => `Compare across ${cc.toUpperCase()} carriers`,
	option: (cc) => `${cc.toUpperCase()} carriers`,
};
const CARRIERS: ScopeChoice = {
	scope: "carriers",
	menu: () => "Compare across all carriers",
	option: () => "All carriers",
};
const COUNTRIES: ScopeChoice = {
	scope: "countries",
	menu: () => "Compare across countries",
	option: () => "Countries",
};

/** What "compare across" offers on each platform, in menu order: across country bundles only where the platform ships them. */
const scanScopes = (platform: Platform): readonly ScopeChoice[] =>
	shipsKind(platform, "country") ? [COUNTRY, CARRIERS, COUNTRIES] : [COUNTRY, CARRIERS];

interface ScanQuery {
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

/** The dialog lists the whole-platform scopes countries first; one country's carriers only as the menu named it. */
const OPTION_ORDER = { countries: 0, carriers: 1 } as const;

/** The dialog's Scope options for a query on `platform` currently scoped to `current`. */
export function scopeOptions(
	platform: Platform,
	current: ScanScope,
): ReadonlyArray<readonly [ScanScope, string]> {
	const whole = scanScopes(platform)
		.flatMap((s): Array<readonly ["carriers" | "countries", string]> =>
			s.scope === "country" ? [] : [[s.scope, s.option("")]],
		)
		.toSorted(([a], [b]) => OPTION_ORDER[a] - OPTION_ORDER[b]);
	return current.startsWith("country:")
		? [[current, COUNTRY.option(current.slice("country:".length))], ...whole]
		: whole;
}

/** The "compare across" items for a key in `file`; one country's carriers only when the source has a country. */
export function scanMenuItems(platform: Platform, path: string, file: string, cc: string | null): MenuItem[] {
	return scanScopes(platform).flatMap(({ scope, menu }): MenuItem[] => {
		if (scope !== "country")
			return [{ kind: "action", label: menu(""), run: () => scan.start({ platform, path, file, scope }) }];
		return cc
			? [
					{
						kind: "action",
						label: menu(cc),
						run: () => scan.start({ platform, path, file, scope: `country:${cc}` }),
					},
				]
			: [];
	});
}

/** What one toolbar controls; several trees on a page can share it. */
export class TreeState {
	filter = $state("");
}

export function toggleIn<T>(set: Set<T>, key: T): void {
	if (!set.delete(key)) set.add(key);
}

/** Right-click, long-press and the menu key on an element, all opening the same menu. */
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
				contextMenu.show(e, title, items, node);
			}),
			on(node, "keydown", (e) => {
				if (!opensMenu(e)) return;
				e.preventDefault();
				const { left, bottom } = node.getBoundingClientRect();
				const { title, items } = build();
				contextMenu.show({ clientX: left, clientY: bottom }, title, items, node);
			}),
			on(
				node,
				"touchstart",
				(e) => {
					const t = e.touches[0];
					if (!t) return;
					fired = false;
					const at = { clientX: t.clientX, clientY: t.clientY };
					start = at;
					timer = setTimeout(() => {
						const { title, items } = build();
						contextMenu.show(at, title, items, node);
						fired = true;
						timer = null;
					}, 450);
				},
				{ passive: true },
			),
			on(
				node,
				"touchmove",
				(e) => {
					if (!timer || !start) return;
					const t = e.touches[0];
					if (!t) return;
					if (Math.abs(t.clientX - start.clientX) > 10 || Math.abs(t.clientY - start.clientY) > 10) cancel();
				},
				{ passive: true },
			),
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

export async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		try {
			document.execCommand("copy");
		} finally {
			ta.remove();
		}
	}
}
