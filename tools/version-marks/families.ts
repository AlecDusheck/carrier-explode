import type { Family } from "./mark.ts";

/** Colours sampled from developer.apple.com's version icons: 13–15 on white, a filled tile from 16. */
export const IOS = {
	dir: "ios",
	fallback: "ios.svg",
	font: "-apple-system, system-ui, sans-serif",
	marks: {
		13: { on: "white", dir: [0, 0, 0, 1], stops: ["#fead14", "#fb860e", "#f46331", "#dd3d5e", "#4b1162"] },
		14: { on: "white", dir: [0, 0, 1, 1], stops: ["#f6af2b", "#f5822f", "#e44243", "#be559e", "#5962a4"] },
		15: { on: "white", dir: [0.3, 0, 0.7, 1], stops: ["#fd9c11", "#ffb308", "#76a6d4", "#3c5166"] },
		16: {
			on: "tile",
			dir: [1, 0, 0, 1],
			stops: ["#0080a0", "#058499", "#599d92", "#bba670", "#d19f4a"],
			ink: "#ffffff",
		},
		17: {
			on: "tile",
			dir: [0, 0, 0, 1],
			stops: ["#ff0000", "#ff5916", "#ff7105", "#f84c6a", "#d549e9"],
			ink: "#ffffff",
		},
		18: {
			on: "tile",
			dir: [0, 0, 1, 0],
			stops: ["#003b53", "#155f77", "#4397aa", "#a3b1c2", "#ffb2bb"],
			ink: "#e1ffff",
		},
		26: {
			on: "glass",
			dir: [1, 0, 0, 1],
			stops: ["#2e5fc3", "#4f84dd", "#72bedb", "#65d2cf", "#95e1db"],
			ink: "#ffffff",
		},
		27: {
			on: "glass",
			dir: [0, 0, 1, 1],
			stops: ["#9d7f58", "#b7a38b", "#9e8e7f", "#847676", "#757383"],
			ink: "#fffcf5",
		},
	},
	plain: [],
} as const satisfies Family;

/**
 * Colours sampled from Google's release badges (developer.android.com version heroes, Android Developers
 * Blog release posts). 7–10 had no numbered badge, so they get the plain tile.
 */
export const ANDROID = {
	dir: "android",
	fallback: "android.svg",
	font: "'Google Sans', 'Product Sans', Roboto, system-ui, sans-serif",
	marks: {
		11: { on: "tile", dir: [0, 0, 0, 1], stops: ["#153041"], ink: "#f86633" },
		12: { on: "tile", dir: [0, 0, 0, 1], stops: ["#71d88c"], ink: "#ffffff" },
		13: { on: "tile", dir: [0, 0, 0, 1], stops: ["#3ddc84"], ink: "#073042" },
		14: { on: "tile", dir: [0, 0, 0, 1], stops: ["#f86734"], ink: "#ffffff" },
		15: { on: "tile", dir: [0, 0, 0, 1], stops: ["#34a853"], ink: "#e9f3eb" },
		16: { on: "tile", dir: [0, 0, 0, 1], stops: ["#4285f4"], ink: "#e8f5e9" },
		17: { on: "tile", dir: [0, 0, 1, 1], stops: ["#b31f7f", "#66245a"], ink: "#ffffff" },
	},
	plain: [7, 8, 9, 10],
} as const satisfies Family;
