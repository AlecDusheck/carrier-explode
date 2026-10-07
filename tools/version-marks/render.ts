import type { Mark } from "./mark.ts";

const TILE = `x="0.5" y="0.5" width="23" height="23" rx="5.5"`;
const PLAIN_GRADIENT = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e8e93"/><stop offset="1" stop-color="#636366"/></linearGradient>`;

const svg = (body: string): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${body}</svg>\n`;

/** Apple's numerals are hairline-thin; regular weight stays legible at 20px. */
function numeral(major: number, font: string, fill: string, glass: boolean): string {
	const size = String(major).length > 1 ? 14 : 17;
	return (
		`<text x="12" y="12.6" text-anchor="middle" dominant-baseline="central" font-size="${size}" font-weight="${glass ? 600 : 400}"` +
		` letter-spacing="-0.6" font-family="${font}" fill="${fill}"${glass ? ` fill-opacity="0.85"` : ""}>${major}</text>`
	);
}

function gradient(dir: readonly number[], stops: readonly string[]): string {
	const offset = (i: number): string => (i / (stops.length - 1)).toFixed(3);
	return (
		`<defs><linearGradient id="g" x1="${dir[0]}" y1="${dir[1]}" x2="${dir[2]}" y2="${dir[3]}">` +
		stops.map((c, i) => `<stop offset="${offset(i)}" stop-color="${c}"/>`).join("") +
		`</linearGradient></defs>`
	);
}

export function renderMark(mark: Mark, major: number, font: string): string {
	switch (mark.on) {
		case "white":
			return svg(
				gradient(mark.dir, mark.stops) +
					`<rect ${TILE} fill="#fff" stroke="#d1d1d6"/>` +
					numeral(major, font, "url(#g)", false),
			);
		case "tile":
		case "glass": {
			const [first, ...rest] = mark.stops;
			const flat = rest.length === 0;
			const defs = flat ? "" : gradient(mark.dir, mark.stops);
			return svg(
				defs +
					`<rect ${TILE} fill="${flat ? first : "url(#g)"}"/>` +
					numeral(major, font, mark.ink, mark.on === "glass"),
			);
		}
	}
}

const PLAIN_TILE = `<defs>${PLAIN_GRADIENT}</defs><rect ${TILE} fill="url(#g)"/>`;

/** The grey tile, for a release with no mark of its own. */
export const renderPlain = (major: number, font: string): string =>
	svg(PLAIN_TILE + numeral(major, font, "#ffffff", false));

/** The grey tile without a numeral: a family's fallback. */
export const renderFallback = (): string => svg(PLAIN_TILE);
