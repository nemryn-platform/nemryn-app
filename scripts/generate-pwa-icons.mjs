// Generates the Nemryn Driver PWA raster icons from the APPROVED brand master
// public/brand/nemryn-app-icon.svg (P1-PILOT-S5A). The symbol artwork is reused
// byte-for-byte (the original <g> element is embedded unchanged and only wrapped
// in a scaling transform for the maskable/apple variants) -- nothing is redrawn.
//
//   node scripts/generate-pwa-icons.mjs
//
// Needs a local Chrome/Chromium for headless rasterization (path override:
// CHROME_BIN). The generated PNGs are committed to public/pwa/; this script only
// needs to be re-run if the brand master changes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const master = fs.readFileSync(path.join(ROOT, "public/brand/nemryn-app-icon.svg"), "utf8");
const group = master.match(/<g [\s\S]*<\/g>/)?.[0];
if (!group) throw new Error("brand master symbol group not found");
const BG = "#171A1D"; // Deep Graphite (locked brand colour, brand README)
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// "any": the approved rounded tile, unchanged.
const anySvg = master;
// "maskable"/apple: full-bleed graphite square, symbol scaled to 88% about the centre so it stays inside
// the maskable safe zone (a circle of 40% of the icon size) on every launcher mask.
const bleedSvg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${BG}"/><g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${group}</g></svg>`;

const jobs = [
  { file: "icon-192.png", size: 192, svg: anySvg },
  { file: "icon-512.png", size: 512, svg: anySvg },
  { file: "icon-maskable-512.png", size: 512, svg: bleedSvg(0.88) },
  { file: "apple-touch-icon.png", size: 180, svg: bleedSvg(0.94) },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nemryn-pwa-"));
for (const job of jobs) {
  const html = path.join(tmp, `${job.file}.html`);
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${job.size}px;height:${job.size}px}</style>${job.svg}`);
  const out = path.join(ROOT, "public/pwa", job.file);
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${job.size},${job.size}`, `--screenshot=${out}`, `file://${html}`], { stdio: "ignore" });
  console.log("wrote", path.relative(ROOT, out), fs.statSync(out).size, "bytes");
}
fs.rmSync(tmp, { recursive: true, force: true });
