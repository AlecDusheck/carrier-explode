/** Keyboard movement inside composite widgets (lists, tab rows, menus, trees), and the site's shortcuts. */

import type { Attachment } from "svelte/attachments";
import { on } from "svelte/events";

export type Axis = "x" | "y";

interface Keyed {
	readonly key: string;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
}

/** Each axis's back and forth keys. */
const STEPS = {
	x: ["ArrowLeft", "ArrowRight"],
	y: ["ArrowUp", "ArrowDown"],
} as const satisfies Record<Axis, readonly [string, string]>;

/** Where `key` moves focus among `count` items from `at` (-1 when none has it), or null when it does not move it. */
export function step(key: string, axis: Axis, at: number, count: number): number | null {
	if (!count) return null;
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	const [back, forth] = STEPS[axis];
	if (key !== back && key !== forth) return null;
	if (at < 0) return key === forth ? 0 : count - 1;
	return Math.min(count - 1, Math.max(0, at + (key === forth ? 1 : -1)));
}

export type TreeMove = "unfold" | "fold" | "child" | "parent";

/** What Left or Right does to a tree row: `folded` is its fold state, null for a row with nothing to fold. */
export function treeMove(key: string, folded: boolean | null): TreeMove | null {
	if (key === "ArrowRight") return folded === null ? null : folded ? "unfold" : "child";
	if (key === "ArrowLeft") return folded === false ? "fold" : "parent";
	return null;
}

/** Anything structured like the DOM: a row and the element holding it. */
interface Nested<T> {
	readonly parentElement: { contains(other: T): boolean } | null;
}

/** The row `rows[at]` sits under: the nearest earlier row whose own container also holds it. */
export function parentIndex<T extends Nested<T>>(rows: readonly T[], at: number): number {
	const row = rows[at];
	if (!row) return -1;
	for (let i = at - 1; i >= 0; i--) {
		const box = rows[i]?.parentElement;
		if (box && box !== row.parentElement && box.contains(row)) return i;
	}
	return -1;
}

const plain = (e: Keyed): boolean => !e.altKey && !e.ctrlKey && !e.metaKey;

/** A key that types a character: in a list with a find box, it goes to the box. */
export const printable = (e: Keyed): boolean => plain(e) && e.key.length === 1 && e.key !== " ";

/** The ContextMenu key, or Shift+F10 where a keyboard has none. */
export const opensMenu = (e: Keyed): boolean =>
	plain(e) && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"));

/** Escape in a find box clears it; an empty box lets go of focus, unless a popover or dialog holds it and closes on that Escape. */
export function escapeFind(value: string, layered: boolean): "clear" | "blur" | null {
	if (value) return "clear";
	return layered ? null : "blur";
}

const typing = (el: EventTarget | null): boolean =>
	el instanceof HTMLElement && (el.isContentEditable || el.matches("input, textarea, select"));

const visible = <E extends HTMLElement = HTMLElement>(root: Element | Document, items: string): E[] =>
	[...root.querySelectorAll<E>(items)].filter((el) => el.checkVisibility());

/** One tab stop per widget: the item holding focus, else the current one, else the first. */
function roving(root: HTMLElement, items: string): () => void {
	const sync = (): void => {
		const all = [...root.querySelectorAll<HTMLElement>(items)].filter((el) => !typing(el));
		const active =
			all.find((el) => el.contains(document.activeElement)) ??
			all.find((el) => el.matches("[aria-current]")) ??
			all[0];
		for (const el of all) {
			const t = el === active ? "0" : "-1";
			if (el.getAttribute("tabindex") !== t) el.setAttribute("tabindex", t);
		}
	};
	sync();
	const watch = new MutationObserver(sync);
	watch.observe(root, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["aria-current"],
	});
	const off = on(root, "focusin", sync);
	return () => {
		watch.disconnect();
		off();
	};
}

/** Arrows, Home and End move between items; in a tree, Left and Right fold and Enter flips a row. */
function keys(items: string, axis: Axis, tree: boolean): Attachment<HTMLElement> {
	return (root) => {
		const stop = roving(root, items);
		const off = on(root, "keydown", (e) => {
			const target = e.target;
			if (e.defaultPrevented || !plain(e) || !(target instanceof HTMLElement)) return;
			const list = visible(root, items);
			const at = list.findIndex((el) => el.contains(target));
			const here = list[at];
			if (!here) return;
			const inField = typing(target);
			const go = (i: number): void => {
				e.preventDefault();
				list[i]?.focus();
			};

			if (inField && e.key === "Enter") {
				e.preventDefault();
				list.find((el) => !typing(el))?.click();
				return;
			}
			if (!inField && printable(e)) {
				// Focused before the key lands, so the character types into the box.
				list.find(typing)?.focus();
				return;
			}
			if (e.shiftKey || (inField && (axis === "x" || e.key === "Home" || e.key === "End"))) return;

			if (tree) {
				const fold = here.querySelector<HTMLElement>(":scope > :is(.twist, .fold)[aria-expanded]");
				if (fold && target === here && (e.key === "Enter" || e.key === " ")) {
					e.preventDefault();
					fold.click();
					return;
				}
				const move = treeMove(e.key, fold ? fold.getAttribute("aria-expanded") !== "true" : null);
				if (move === "unfold" || move === "fold") {
					e.preventDefault();
					fold?.click();
					return;
				}
				if (move === "child") return go(at + 1);
				if (move === "parent") {
					const p = parentIndex(list, at);
					if (p >= 0) go(p);
					return;
				}
			}

			const to = step(e.key, axis, at, list.length);
			if (to !== null) go(to);
		});
		return () => {
			off();
			stop();
		};
	};
}

/** A list, menu or tab row whose `items` the arrows move between. */
export const listKeys = (items: string, axis: Axis = "y"): Attachment<HTMLElement> =>
	keys(items, axis, false);

/** A value tree: its rows are the items. */
export const treeKeys: Attachment<HTMLElement> = keys(".row", "y", true);

/** The site-wide keys: `/` goes to the page's first find box, Escape clears or leaves one. */
export function shortcuts(e: KeyboardEvent): void {
	if (e.defaultPrevented) return;
	const el = e.target;
	if (e.key === "Escape" && el instanceof HTMLInputElement && el.type === "search") {
		const act = escapeFind(el.value, !!el.closest("[popover], dialog"));
		if (act === "clear") {
			e.preventDefault();
			el.value = "";
			el.dispatchEvent(new Event("input", { bubbles: true }));
		} else if (act === "blur") el.blur();
		return;
	}
	if (e.key !== "/" || !plain(e) || typing(el)) return;
	const scope = document.querySelector("dialog:modal") ?? document;
	const box = visible<HTMLInputElement>(scope, "input[type=search]")[0];
	if (!box) return;
	e.preventDefault();
	box.focus();
	box.select();
}
