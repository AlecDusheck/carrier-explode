import type { Module, PhoneShape } from "./shape.ts";

const TILE = 24;
/** The body fills the tile's height, less a unit above and below. */
const H = 22;
const EDGE = "#8e8e93";

/** Two decimals, no trailing zeros. toFixed rounds the double itself: 6.885 is 6.88499…, so 6.88. */
const n = (v: number): string => String(Number(v.toFixed(2)));

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}" width="${TILE}" height="${TILE}">${body}</svg>\n`;

/** A phone's back, drawn from its shape. */
export function renderShape(shape: PhoneShape): string {
  const W = H / shape.aspect;
  const ox = (TILE - W) / 2;
  const X = (f: number): number => ox + f * W;
  const Y = (f: number): number => 1 + f * H;
  const body = `x="${n(ox)}" y="1" width="${n(W)}" height="${H}" rx="${n(shape.radius * W)}"`;

  const rect = (x: number, y: number, w: number, h: number, rx: number, color: string): string =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rx)}" fill="${color}" stroke="${EDGE}" stroke-width="0.3"/>`;
  const module = (m: Module): string => {
    switch (m.kind) {
      case "plate":
        return rect(X(m.x), Y(m.y), m.w * W, m.h * H, m.radius * W, m.color);
      case "pill":
        return rect(X(m.x), Y(m.y), m.w * W, m.h * H, Math.min(m.w * W, m.h * H) / 2, m.color);
      case "band":
        return rect(ox, Y(m.y), W, m.h * H, 0, m.color);
    }
  };
  const circle = (x: number, y: number, d: number, paint: string): string =>
    `<circle cx="${n(X(x))}" cy="${n(Y(y))}" r="${n((d * W) / 2)}" ${paint}/>`;

  return svg(
    `<defs><clipPath id="b"><rect ${body}/></clipPath></defs>` +
      `<rect ${body} fill="${shape.color}" stroke="${EDGE}" stroke-width="0.6"/>` +
      `<g clip-path="url(#b)">` +
      shape.modules.map(module).join("") +
      shape.lenses.map(([x, y, d]) => circle(x, y, d, `fill="#2c2c2e" stroke="#636366" stroke-width="0.25"`)).join("") +
      shape.extras.map(([kind, x, y, d]) => circle(x, y, d, `fill="${kind === "flash" ? "#fff4cc" : "#1c1c1e"}"`)).join("") +
      `</g>`,
  );
}

/** The plain outline for a model with no shape: an iPhone's earpiece, or a Pixel's camera bar. */
export function renderPlain(family: "iphone" | "pixel"): string {
  const outline = `<rect x="6.5" y="2" width="11" height="20" rx="2.5" fill="none" stroke="${EDGE}" stroke-width="1.5"/>`;
  const mark =
    family === "iphone"
      ? `<rect x="10" y="3.6" width="4" height="1.2" rx="0.6" fill="${EDGE}"/>`
      : `<rect x="6.5" y="4.6" width="11" height="2.2" fill="${EDGE}"/>`;
  return svg(outline + mark);
}
