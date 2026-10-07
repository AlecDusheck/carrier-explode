import { describe, expect, it } from "vitest";
import { escapeFind, opensMenu, parentIndex, printable, step, treeMove } from "../src/lib/keys.ts";

const key = (
	k: string,
	mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {},
) => ({
	key: k,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	...mods,
});

describe("step", () => {
	it("moves along its own axis and stops at the ends", () => {
		expect(step("ArrowDown", "y", 0, 3)).toBe(1);
		expect(step("ArrowDown", "y", 2, 3)).toBe(2);
		expect(step("ArrowUp", "y", 0, 3)).toBe(0);
		expect(step("ArrowRight", "x", 1, 3)).toBe(2);
		expect(step("ArrowLeft", "x", 1, 3)).toBe(0);
	});
	it("ignores the other axis and other keys", () => {
		expect(step("ArrowRight", "y", 0, 3)).toBeNull();
		expect(step("ArrowDown", "x", 0, 3)).toBeNull();
		expect(step("a", "y", 0, 3)).toBeNull();
	});
	it("jumps with Home and End", () => {
		expect(step("Home", "y", 2, 3)).toBe(0);
		expect(step("End", "x", 0, 3)).toBe(2);
	});
	it("enters from either end when nothing has focus, and not at all when empty", () => {
		expect(step("ArrowDown", "y", -1, 3)).toBe(0);
		expect(step("ArrowUp", "y", -1, 3)).toBe(2);
		expect(step("ArrowDown", "y", 0, 0)).toBeNull();
	});
});

describe("treeMove", () => {
	it("unfolds a folded row, then goes into it", () => {
		expect(treeMove("ArrowRight", true)).toBe("unfold");
		expect(treeMove("ArrowRight", false)).toBe("child");
		expect(treeMove("ArrowRight", null)).toBeNull();
	});
	it("folds an open row, else goes to its parent", () => {
		expect(treeMove("ArrowLeft", false)).toBe("fold");
		expect(treeMove("ArrowLeft", true)).toBe("parent");
		expect(treeMove("ArrowLeft", null)).toBe("parent");
		expect(treeMove("ArrowDown", false)).toBeNull();
	});
});

describe("parentIndex", () => {
	// A box holds rows and boxes, as a tree's DOM does.
	class Box {
		readonly parentElement: Box | null;
		readonly kids: Box[] = [];
		constructor(parent: Box | null) {
			this.parentElement = parent;
			parent?.kids.push(this);
		}
		contains(other: Box): boolean {
			return other === this || this.kids.some((k) => k.contains(other));
		}
	}

	it("finds the row whose wrapper holds the row (a row and its children in one wrapper)", () => {
		const tree = new Box(null);
		const a = new Box(new Box(tree));
		const aKids = new Box(a.parentElement);
		const a1 = new Box(new Box(aKids));
		const a2 = new Box(new Box(aKids));
		const b = new Box(new Box(tree));
		const rows = [a, a1, a2, b];
		expect(parentIndex(rows, 2)).toBe(0);
		expect(parentIndex(rows, 1)).toBe(0);
		expect(parentIndex(rows, 3)).toBe(-1);
	});

	it("skips siblings that share the row's container (a row beside its children's box)", () => {
		const tree = new Box(null);
		const head = new Box(tree);
		const kids = new Box(tree);
		const k1 = new Box(kids);
		const k2 = new Box(kids);
		const after = new Box(tree);
		const rows = [head, k1, k2, after];
		expect(parentIndex(rows, 2)).toBe(0);
		expect(parentIndex(rows, 3)).toBe(-1);
	});
});

describe("keys", () => {
	it("takes a typed character but not Space or a shortcut", () => {
		expect(printable(key("a"))).toBe(true);
		expect(printable(key("A", { shiftKey: true }))).toBe(true);
		expect(printable(key(" "))).toBe(false);
		expect(printable(key("f", { metaKey: true }))).toBe(false);
		expect(printable(key("ArrowDown"))).toBe(false);
	});
	it("opens a menu on the ContextMenu key and Shift+F10 alone", () => {
		expect(opensMenu(key("ContextMenu"))).toBe(true);
		expect(opensMenu(key("F10", { shiftKey: true }))).toBe(true);
		expect(opensMenu(key("F10"))).toBe(false);
		expect(opensMenu(key("F10", { shiftKey: true, ctrlKey: true }))).toBe(false);
	});
	it("clears a find box first, then lets go unless a popover or dialog closes on Escape", () => {
		expect(escapeFind("att", false)).toBe("clear");
		expect(escapeFind("att", true)).toBe("clear");
		expect(escapeFind("", false)).toBe("blur");
		expect(escapeFind("", true)).toBeNull();
	});
});
