/**
 * Pixel backs, measured from Google's hardware diagrams (support.google.com/pixelphone/answer/7157629),
 * colours sampled from Google's product images; aspect from Google's tech-specs pages. A Fold is drawn folded.
 */

import type { Circle, Extra, Module, PhoneShape } from "./shape.ts";

/** Width and height in millimetres. */
type Size = readonly [w: number, h: number];

/**
 * A model Google publishes no diagram for, drawn from its sibling's: every part keeps its size
 * and its offset from the top-left corner, on the larger body.
 */
function resized(base: PhoneShape, [bw, bh]: Size, [w, h]: Size): PhoneShape {
	const sx = bw / w;
	const sy = bh / h;
	const circle = ([x, y, d]: Circle): Circle => [x * sx, y * sy, d * sx];
	const module = (m: Module): Module => {
		switch (m.kind) {
			case "plate":
				return { ...m, x: m.x * sx, y: m.y * sy, w: m.w * sx, h: m.h * sy, radius: m.radius * sx };
			case "pill":
				return { ...m, x: m.x * sx, y: m.y * sy, w: m.w * sx, h: m.h * sy };
			case "band":
				return { ...m, y: m.y * sy, h: m.h * sy };
		}
	};
	return {
		aspect: h / w,
		radius: base.radius * sx,
		color: base.color,
		modules: base.modules.map(module),
		lenses: base.lenses.map(circle),
		extras: base.extras.map(([kind, ...c]): Extra => [kind, ...circle(c)]),
	};
}

const PIXEL_4: PhoneShape = {
	aspect: 147.1 / 68.8,
	radius: 0.123,
	color: "#e27765",
	modules: [{ kind: "plate", x: 0.075, y: 0.037, w: 0.336, h: 0.157, radius: 0.048, color: "#212023" }],
	lenses: [
		[0.154, 0.114, 0.081],
		[0.331, 0.114, 0.081],
	],
	extras: [["flash", 0.242, 0.161, 0.061]],
};
const PIXEL_3A: PhoneShape = {
	aspect: 151.3 / 70.1,
	radius: 0.117,
	color: "#d8d9ee",
	modules: [{ kind: "band", y: 0, h: 0.2, color: "#d6d7ec" }],
	lenses: [[0.205, 0.103, 0.12]],
	extras: [["flash", 0.393, 0.103, 0.054]],
};
const PIXEL_3: PhoneShape = {
	aspect: 145.6 / 68.2,
	radius: 0.106,
	color: "#ecdcdb",
	modules: [{ kind: "band", y: 0, h: 0.202, color: "#efe4e0" }],
	lenses: [[0.197, 0.095, 0.13]],
	extras: [["flash", 0.391, 0.095, 0.054]],
};
const PIXEL_2: PhoneShape = {
	aspect: 145.7 / 69.7,
	radius: 0.138,
	color: "#bcc6d2",
	modules: [{ kind: "band", y: 0, h: 0.229, color: "#b2c2d2" }],
	lenses: [[0.2, 0.116, 0.063]],
	extras: [["flash", 0.358, 0.116, 0.06]],
};
const PIXEL_2_XL = resized(PIXEL_2, [69.7, 145.7], [76.7, 157.9]);
const PIXEL: PhoneShape = {
	aspect: 143.84 / 69.54,
	radius: 0.12,
	color: "#6281f7",
	modules: [{ kind: "plate", x: 0.018, y: 0, w: 0.955, h: 0.36, radius: 0.04, color: "#2968c8" }],
	lenses: [[0.239, 0.057, 0.08]],
	extras: [["flash", 0.103, 0.057, 0.07]],
};
const PIXEL_4A_5G_SHAPE = {
	radius: 0.125,
	modules: [{ kind: "plate", x: 0.098, y: 0.051, w: 0.314, h: 0.148, radius: 0.048, color: "#050505" }],
	lenses: [
		[0.17, 0.124, 0.049],
		[0.338, 0.124, 0.049],
	],
	extras: [["flash", 0.254, 0.083, 0.056]],
} as const satisfies Omit<PhoneShape, "aspect" | "color">;

export const PIXEL_SHAPES = {
	cubs: {
		aspect: 152.8 / 72,
		radius: 0.168,
		color: "#b3b4cc",
		modules: [
			{ kind: "pill", x: 0.045, y: 0.087, w: 0.91, h: 0.157, color: "#c0c1d5" },
			{ kind: "pill", x: 0.061, y: 0.093, w: 0.877, h: 0.145, color: "#020202" },
		],
		lenses: [
			[0.204, 0.165, 0.08],
			[0.414, 0.165, 0.12],
			[0.6, 0.165, 0.08],
		],
		extras: [["flash", 0.792, 0.165, 0.085]],
	},
	grizzly: {
		aspect: 152.7 / 71.9,
		radius: 0.158,
		color: "#e88b7b",
		modules: [
			{ kind: "pill", x: 0.043, y: 0.084, w: 0.909, h: 0.15, color: "#eb9382" },
			{ kind: "pill", x: 0.058, y: 0.09, w: 0.881, h: 0.138, color: "#040404" },
		],
		lenses: [
			[0.202, 0.16, 0.096],
			[0.403, 0.16, 0.155],
			[0.591, 0.16, 0.1],
		],
		extras: [["flash", 0.8, 0.16, 0.081]],
	},
	kodiak: {
		aspect: 162.7 / 76.5,
		radius: 0.158,
		color: "#e88b7b",
		modules: [
			{ kind: "pill", x: 0.043, y: 0.084, w: 0.909, h: 0.15, color: "#ef9e8c" },
			{ kind: "pill", x: 0.058, y: 0.09, w: 0.881, h: 0.138, color: "#040404" },
		],
		lenses: [
			[0.202, 0.16, 0.096],
			[0.403, 0.16, 0.155],
			[0.591, 0.16, 0.1],
		],
		extras: [["flash", 0.8, 0.16, 0.081]],
	},
	yogi: {
		aspect: 155.2 / 76,
		radius: 0.173,
		color: "#a5aa8e",
		modules: [
			{ kind: "plate", x: 0.063, y: 0.028, w: 0.546, h: 0.244, radius: 0.09, color: "#bec0aa" },
			{ kind: "pill", x: 0.086, y: 0.039, w: 0.496, h: 0.102, color: "#000000" },
			{ kind: "pill", x: 0.086, y: 0.156, w: 0.496, h: 0.099, color: "#000000" },
		],
		lenses: [
			[0.476, 0.091, 0.07],
			[0.194, 0.207, 0.108],
			[0.374, 0.207, 0.08],
		],
		extras: [["flash", 0.194, 0.091, 0.079]],
	},
	stallion: {
		aspect: 153.9 / 73,
		radius: 0.175,
		color: "#819ff5",
		modules: [{ kind: "pill", x: 0.091, y: 0.075, w: 0.418, h: 0.134, color: "#000000" }],
		lenses: [
			[0.208, 0.142, 0.084],
			[0.393, 0.142, 0.084],
		],
		extras: [["flash", 0.624, 0.142, 0.083]],
	},
	rango: {
		aspect: 155.2 / 76.3,
		radius: 0.18,
		color: "#868fa1",
		modules: [
			{ kind: "plate", x: 0.054, y: 0.025, w: 0.624, h: 0.222, radius: 0.066, color: "#a0a6b3" },
			{ kind: "pill", x: 0.094, y: 0.04, w: 0.396, h: 0.088, color: "#050505" },
			{ kind: "pill", x: 0.094, y: 0.142, w: 0.396, h: 0.087, color: "#050505" },
		],
		lenses: [
			[0.396, 0.085, 0.084],
			[0.198, 0.185, 0.1],
			[0.394, 0.188, 0.084],
		],
		extras: [["flash", 0.582, 0.086, 0.074]],
	},
	blazer: {
		aspect: 152.8 / 72,
		radius: 0.165,
		color: "#737989",
		modules: [
			{ kind: "pill", x: 0.043, y: 0.083, w: 0.895, h: 0.142, color: "#9ca4b4" },
			{ kind: "pill", x: 0.051, y: 0.089, w: 0.679, h: 0.131, color: "#090808" },
		],
		lenses: [
			[0.17, 0.155, 0.083],
			[0.379, 0.155, 0.131],
			[0.539, 0.155, 0.1],
		],
		extras: [
			["flash", 0.813, 0.122, 0.083],
			["sensor", 0.813, 0.182, 0.077],
		],
	},
	frankel: {
		aspect: 152.8 / 72,
		radius: 0.179,
		color: "#426ecc",
		modules: [
			{ kind: "pill", x: 0.044, y: 0.089, w: 0.89, h: 0.141, color: "#467ce8" },
			{ kind: "pill", x: 0.056, y: 0.094, w: 0.657, h: 0.131, color: "#020202" },
		],
		lenses: [
			[0.194, 0.164, 0.078],
			[0.45, 0.164, 0.113],
			[0.618, 0.164, 0.066],
		],
		extras: [["flash", 0.818, 0.163, 0.086]],
	},
	mustang: {
		aspect: 162.8 / 76.6,
		radius: 0.165,
		color: "#747a8a",
		modules: [
			{ kind: "pill", x: 0.043, y: 0.083, w: 0.895, h: 0.142, color: "#9aa0af" },
			{ kind: "pill", x: 0.051, y: 0.089, w: 0.679, h: 0.131, color: "#0b090a" },
		],
		lenses: [
			[0.17, 0.155, 0.083],
			[0.379, 0.155, 0.131],
			[0.539, 0.155, 0.1],
		],
		extras: [
			["flash", 0.813, 0.122, 0.083],
			["sensor", 0.813, 0.182, 0.077],
		],
	},
	tegu: {
		aspect: 154.7 / 73.3,
		radius: 0.164,
		color: "#abb3da",
		modules: [{ kind: "pill", x: 0.092, y: 0.09, w: 0.428, h: 0.114, color: "#000000" }],
		lenses: [
			[0.214, 0.15, 0.084],
			[0.393, 0.15, 0.084],
		],
		extras: [["flash", 0.627, 0.148, 0.08]],
	},
	comet: {
		aspect: 155.2 / 77.1,
		radius: 0.165,
		color: "#2d2c2c",
		modules: [
			{ kind: "plate", x: 0.05, y: 0.026, w: 0.631, h: 0.234, radius: 0.084, color: "#545454" },
			{ kind: "pill", x: 0.09, y: 0.046, w: 0.367, h: 0.091, color: "#010101" },
			{ kind: "pill", x: 0.09, y: 0.149, w: 0.367, h: 0.091, color: "#010101" },
		],
		lenses: [
			[0.358, 0.091, 0.081],
			[0.194, 0.195, 0.102],
			[0.358, 0.192, 0.08],
		],
		extras: [["flash", 0.555, 0.091, 0.072]],
	},
	caiman: {
		aspect: 152.8 / 72,
		radius: 0.169,
		color: "#ece7e0",
		modules: [
			{ kind: "pill", x: 0.038, y: 0.09, w: 0.92, h: 0.136, color: "#d2cbc3" },
			{ kind: "pill", x: 0.066, y: 0.099, w: 0.678, h: 0.121, color: "#101010" },
		],
		lenses: [
			[0.186, 0.161, 0.096],
			[0.406, 0.161, 0.192],
			[0.588, 0.161, 0.1],
		],
		extras: [
			["flash", 0.825, 0.134, 0.077],
			["sensor", 0.825, 0.189, 0.077],
		],
	},
	komodo: {
		aspect: 162.8 / 76.6,
		radius: 0.159,
		color: "#ece7e1",
		modules: [
			{ kind: "pill", x: 0.039, y: 0.084, w: 0.919, h: 0.138, color: "#d4cdc5" },
			{ kind: "pill", x: 0.069, y: 0.093, w: 0.68, h: 0.118, color: "#0c0c0c" },
		],
		lenses: [
			[0.177, 0.152, 0.092],
			[0.384, 0.152, 0.178],
			[0.561, 0.152, 0.095],
		],
		extras: [
			["flash", 0.829, 0.126, 0.072],
			["sensor", 0.829, 0.178, 0.072],
		],
	},
	tokay: {
		aspect: 152.8 / 72,
		radius: 0.169,
		color: "#ffa2b2",
		modules: [
			{ kind: "pill", x: 0.042, y: 0.088, w: 0.917, h: 0.141, color: "#e4a5ad" },
			{ kind: "pill", x: 0.066, y: 0.1, w: 0.559, h: 0.122, color: "#111111" },
		],
		lenses: [
			[0.186, 0.161, 0.102],
			[0.405, 0.161, 0.161],
		],
		extras: [["flash", 0.799, 0.161, 0.078]],
	},
	akita: {
		aspect: 152.1 / 72.7,
		radius: 0.167,
		color: "#272727",
		modules: [
			{ kind: "band", y: 0.083, h: 0.12, color: "#505050" },
			{ kind: "pill", x: 0.13, y: 0.096, w: 0.377, h: 0.094, color: "#000000" },
		],
		lenses: [
			[0.23, 0.142, 0.096],
			[0.414, 0.142, 0.103],
		],
		extras: [["flash", 0.776, 0.142, 0.072]],
	},
	husky: {
		aspect: 162.6 / 76.5,
		radius: 0.117,
		color: "#8bbfed",
		modules: [
			{ kind: "band", y: 0.1, h: 0.132, color: "#cfe6fa" },
			{ kind: "pill", x: 0.103, y: 0.113, w: 0.62, h: 0.103, color: "#030303" },
		],
		lenses: [
			[0.208, 0.165, 0.13],
			[0.431, 0.165, 0.189],
			[0.617, 0.165, 0.106],
		],
		extras: [
			["flash", 0.846, 0.137, 0.069],
			["sensor", 0.846, 0.192, 0.069],
		],
	},
	shiba: {
		aspect: 150.5 / 70.8,
		radius: 0.122,
		color: "#868682",
		modules: [
			{ kind: "band", y: 0.078, h: 0.14, color: "#979998" },
			{ kind: "pill", x: 0.138, y: 0.095, w: 0.466, h: 0.106, color: "#010101" },
		],
		lenses: [
			[0.246, 0.147, 0.151],
			[0.492, 0.147, 0.174],
		],
		extras: [["flash", 0.821, 0.147, 0.074]],
	},
	felix: {
		aspect: 139.7 / 79.5,
		radius: 0.131,
		color: "#dcd4cb",
		modules: [
			{ kind: "plate", x: 0.072, y: 0.087, w: 0.833, h: 0.148, radius: 0.054, color: "#ede5d1" },
			{ kind: "pill", x: 0.198, y: 0.12, w: 0.339, h: 0.083, color: "#0c0e10" },
			{ kind: "pill", x: 0.566, y: 0.119, w: 0.147, h: 0.084, color: "#0c0e10" },
		],
		lenses: [
			[0.27, 0.162, 0.078],
			[0.43, 0.162, 0.072],
			[0.639, 0.161, 0.07],
		],
		extras: [["flash", 0.15, 0.134, 0.054]],
	},
	lynx: {
		aspect: 152 / 72.9,
		radius: 0.075,
		color: "#daeff9",
		modules: [
			{ kind: "band", y: 0.091, h: 0.107, color: "#d3dfeb" },
			{ kind: "pill", x: 0.147, y: 0.104, w: 0.35, h: 0.079, color: "#010101" },
		],
		lenses: [
			[0.231, 0.144, 0.098],
			[0.417, 0.144, 0.102],
		],
		extras: [["flash", 0.78, 0.144, 0.077]],
	},
	cheetah: {
		aspect: 162.9 / 76.6,
		radius: 0.082,
		color: "#838884",
		modules: [
			{ kind: "band", y: 0.101, h: 0.128, color: "#ebd9c6" },
			{ kind: "pill", x: 0.12, y: 0.124, w: 0.385, h: 0.082, color: "#0b0b0b" },
			{ kind: "pill", x: 0.525, y: 0.123, w: 0.177, h: 0.083, color: "#0b0b0b" },
		],
		lenses: [
			[0.208, 0.165, 0.117],
			[0.415, 0.165, 0.154],
			[0.613, 0.165, 0.091],
		],
		extras: [["flash", 0.838, 0.165, 0.069]],
	},
	panther: {
		aspect: 155.6 / 73.2,
		radius: 0.099,
		color: "#e7edd5",
		modules: [
			{ kind: "band", y: 0.097, h: 0.131, color: "#d4cdbd" },
			{ kind: "pill", x: 0.145, y: 0.117, w: 0.4, h: 0.086, color: "#0b0b0b" },
		],
		lenses: [
			[0.235, 0.161, 0.111],
			[0.452, 0.161, 0.087],
		],
		extras: [["flash", 0.839, 0.161, 0.07]],
	},
	bluejay: {
		aspect: 152.2 / 71.8,
		radius: 0.069,
		color: "#a6bbae",
		modules: [
			{ kind: "band", y: 0, h: 0.071, color: "#d7eed5" },
			{ kind: "band", y: 0.071, h: 0.108, color: "#121212" },
		],
		lenses: [
			[0.177, 0.122, 0.099],
			[0.339, 0.122, 0.099],
		],
		extras: [["flash", 0.798, 0.122, 0.084]],
	},
	oriole: {
		aspect: 158.6 / 74.8,
		radius: 0.086,
		color: "#ccded8",
		modules: [
			{ kind: "band", y: 0, h: 0.063, color: "#eaecc5" },
			{ kind: "band", y: 0.063, h: 0.132, color: "#111111" },
		],
		lenses: [
			[0.235, 0.13, 0.101],
			[0.432, 0.13, 0.091],
		],
		extras: [["flash", 0.795, 0.129, 0.081]],
	},
	raven: {
		aspect: 163.9 / 75.9,
		radius: 0.069,
		color: "#e6e1dc",
		modules: [
			{ kind: "band", y: 0, h: 0.106, color: "#d1c9c3" },
			{ kind: "band", y: 0.106, h: 0.126, color: "#121212" },
		],
		lenses: [
			[0.225, 0.167, 0.098],
			[0.417, 0.167, 0.084],
			[0.562, 0.167, 0.06],
		],
		extras: [["flash", 0.782, 0.167, 0.077]],
	},
	barbet: { aspect: 156.2 / 73.2, color: "#2f3b38", ...PIXEL_4A_5G_SHAPE },
	redfin: {
		aspect: 144.7 / 70.4,
		radius: 0.134,
		color: "#2e2f2f",
		modules: [{ kind: "plate", x: 0.094, y: 0.048, w: 0.336, h: 0.16, radius: 0.054, color: "#0d0d0d" }],
		lenses: [
			[0.171, 0.127, 0.054],
			[0.35, 0.127, 0.054],
		],
		extras: [["flash", 0.262, 0.082, 0.058]],
	},
	bramble: { aspect: 153.9 / 74, color: "#272a29", ...PIXEL_4A_5G_SHAPE },
	sunfish: {
		aspect: 144 / 69.4,
		radius: 0.126,
		color: "#272a29",
		modules: [{ kind: "plate", x: 0.099, y: 0.044, w: 0.279, h: 0.132, radius: 0.042, color: "#050505" }],
		lenses: [[0.296, 0.135, 0.081]],
		extras: [["flash", 0.18, 0.081, 0.069]],
	},
	coral: resized(PIXEL_4, [68.8, 147.1], [75.1, 160.4]),
	flame: PIXEL_4,
	bonito: resized(PIXEL_3A, [70.1, 151.3], [76.1, 160.1]),
	sargo: PIXEL_3A,
	crosshatch: resized(PIXEL_3, [68.2, 145.6], [76.7, 158]),
	blueline: PIXEL_3,
	// The 2 XL never came in the 2's blue; it is drawn in its black-and-white finish.
	taimen: {
		...PIXEL_2_XL,
		color: "#eceeee",
		// oxlint-disable-next-line oxc/no-map-spread -- the modules are PIXEL_2_XL's; assigning to them would recolor it.
		modules: PIXEL_2_XL.modules.map((m) => ({ ...m, color: "#0a0a0f" })),
	},
	walleye: PIXEL_2,
	marlin: resized(PIXEL, [69.54, 143.84], [75.74, 154.72]),
	sailfish: PIXEL,
} as const satisfies Readonly<Record<string, PhoneShape>>;
