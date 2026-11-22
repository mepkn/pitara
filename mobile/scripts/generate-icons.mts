// Draws the Pitara basket mark (same shapes as web/public/favicon.svg) into the app icons.
// Usage: npm run icons  (writes into assets/images)
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "assets/images";
const SAFFRON = "#D9822B"; // light primary
const SAFFRON_HI = "#E8963F"; // dark primary
const SAFFRON_LO = "#C06E1D";
const CREAM = "#FFF4E3";
const BROWN = "#7A3E0E";

// The favicon's shapes in a 64 x 64 box: lid with knob, rim, body, weave.
const lid = "M14 26c0-8 8-13 18-13s18 5 18 13z";
const rim = { x: 11, y: 26, w: 42, h: 5, r: 2.5 };
const body = "M15 31h34l-3.5 20a4 4 0 0 1-4 3.3h-19a4 4 0 0 1-4-3.3z";
const weave = "M17 38h30M18.5 46h27M26 31v23M38 31v23";

type MarkOptions = { fill: string; rimFill: string; weaveStroke: string; scale: number };

/** The basket centred on the 1024 canvas, `scale` times the full-bleed size (1 = 64 units -> 1024 px). */
function mark({ fill, rimFill, weaveStroke, scale }: MarkOptions): string {
  const k = 16 * scale; // 1024 / 64
  const offset = (1024 - 64 * k) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${k})">
    <path d="${lid}" fill="${fill}"/>
    <circle cx="32" cy="12" r="3.5" fill="${fill}"/>
    <rect x="${rim.x}" y="${rim.y}" width="${rim.w}" height="${rim.h}" rx="${rim.r}" fill="${rimFill}"/>
    <path d="${body}" fill="${fill}"/>
    <path d="${weave}" stroke="${weaveStroke}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
  </g>`;
}

const gradient = `<defs><radialGradient id="g" cx="0.25" cy="0.12" r="1.1">
  <stop offset="0" stop-color="${SAFFRON_HI}"/><stop offset="0.6" stop-color="${SAFFRON}"/><stop offset="1" stop-color="${SAFFRON_LO}"/>
</radialGradient></defs><rect width="1024" height="1024" fill="url(#g)"/>`;

// Monochrome (Android themed icons) uses only alpha: the rim and weave are cut out.
const mono = `<defs><mask id="m"><rect width="1024" height="1024" fill="white"/>
  <g transform="translate(${(1024 - 64 * 16 * 0.62) / 2} ${(1024 - 64 * 16 * 0.62) / 2}) scale(${16 * 0.62})">
    <rect x="${rim.x}" y="${rim.y}" width="${rim.w}" height="${rim.h}" rx="${rim.r}" fill="black" transform="translate(0 0)"/>
    <path d="${weave}" stroke="black" stroke-width="2.4" stroke-linecap="round" fill="none"/>
  </g></mask></defs>
  <g mask="url(#m)">${mark({ fill: "#fff", rimFill: "#fff", weaveStroke: "#fff", scale: 0.62 })}</g>`;

const svgs: Record<string, [size: number, body: string]> = {
  "icon.png": [1024, gradient + mark({ fill: CREAM, rimFill: BROWN, weaveStroke: SAFFRON, scale: 0.82 })],
  "android-icon-background.png": [1024, gradient],
  // Adaptive icons are cropped to the centre ~66%, so the mark is scaled down.
  "android-icon-foreground.png": [1024, mark({ fill: CREAM, rimFill: BROWN, weaveStroke: SAFFRON, scale: 0.62 })],
  "android-icon-monochrome.png": [1024, mono],
  "splash-icon.png": [1024, mark({ fill: SAFFRON, rimFill: BROWN, weaveStroke: "#FBF7F1", scale: 0.9 })],
  "splash-icon-dark.png": [1024, mark({ fill: SAFFRON_HI, rimFill: "#7A3E0E", weaveStroke: "#1C1814", scale: 0.9 })],
  "favicon.png": [48, gradient + mark({ fill: CREAM, rimFill: BROWN, weaveStroke: SAFFRON, scale: 0.82 })],
};

for (const [name, [size, body]] of Object.entries(svgs)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(`${OUT}/${name}`, png);
  console.log(name, size);
}
console.log("splash bg #FBF7F1 / #1C1814");
