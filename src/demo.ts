import { getProject, saveImageBlob, saveProject } from './store';
import { newProject, type ProjectDoc } from './types';

/** Fixed id so the demo project can be recognized (Reset instead of Delete). */
export const DEMO_ID = 'demo-calibration';

/** Bump to refresh the demo project in existing installs. */
const DEMO_VERSION = 2;

const DEMO_NAME = 'Demo — calibration target';
const W = 1200;
const H = 800;

/**
 * Test & calibration card. The ground is intentionally transparent and the
 * discs are translucent, so it doubles as an alpha-rendering test:
 * - 100 px grid, crosshair, diagonals, border: keystone/tilt calibration
 * - concentric circles + 30° ticks: they read as ellipses if skewed
 * - golden spiral on its Fibonacci squares: lopsided if proportions are off
 * - checkerboard: projector focus; palette daubs: brightness/color check
 */
const CALIBRATION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="checker" width="40" height="40" patternUnits="userSpaceOnUse">
      <rect width="20" height="20" fill="#1a1a1a"/>
      <rect x="20" y="20" width="20" height="20" fill="#1a1a1a"/>
    </pattern>
    <line id="tick" x1="600" y1="50" x2="600" y2="68" stroke="#444" stroke-width="2"/>
  </defs>

  <path d="M100 0v800M200 0v800M300 0v800M400 0v800M500 0v800M600 0v800M700 0v800M800 0v800M900 0v800M1000 0v800M1100 0v800M0 100h1200M0 200h1200M0 300h1200M0 400h1200M0 500h1200M0 600h1200M0 700h1200" stroke="#cfcfcf" stroke-width="1"/>
  <path d="M0 0L1200 800M1200 0L0 800" stroke="#c33" stroke-width="1" opacity="0.55"/>
  <path d="M600 0v800M0 400h1200" stroke="#c33" stroke-width="1.5"/>
  <rect x="2" y="2" width="1196" height="796" fill="none" stroke="#c33" stroke-width="3"/>
  <circle cx="600" cy="400" r="5" fill="#c33"/>

  <circle cx="600" cy="400" r="350" fill="none" stroke="#222" stroke-width="2"/>
  <circle cx="600" cy="400" r="175" fill="none" stroke="#222" stroke-width="1.5" stroke-dasharray="12 9"/>
  <use href="#tick"/>
  <use href="#tick" transform="rotate(30 600 400)"/>
  <use href="#tick" transform="rotate(60 600 400)"/>
  <use href="#tick" transform="rotate(90 600 400)"/>
  <use href="#tick" transform="rotate(120 600 400)"/>
  <use href="#tick" transform="rotate(150 600 400)"/>
  <use href="#tick" transform="rotate(180 600 400)"/>
  <use href="#tick" transform="rotate(210 600 400)"/>
  <use href="#tick" transform="rotate(240 600 400)"/>
  <use href="#tick" transform="rotate(270 600 400)"/>
  <use href="#tick" transform="rotate(300 600 400)"/>
  <use href="#tick" transform="rotate(330 600 400)"/>

  <g fill="none" stroke="#c98a1b">
    <path d="M90 460h272v272H90zM362 460h170v170H362zM430 630h102v102H430zM362 664h68v68h-68zM362 630h34v34h-34zM396 630h34v34h-34z" stroke-width="1" opacity="0.35"/>
    <path d="M90 732A272 272 0 0 1 362 460A170 170 0 0 1 532 630A102 102 0 0 1 430 732A68 68 0 0 1 362 664A34 34 0 0 1 396 630A34 34 0 0 1 430 664" stroke-width="3"/>
  </g>

  <g fill-opacity="0.5">
    <circle cx="190" cy="180" r="85" fill="#d33"/>
    <circle cx="260" cy="180" r="85" fill="#2a5"/>
    <circle cx="225" cy="240" r="85" fill="#34d"/>
  </g>
  <text x="225" y="352" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="17" fill="#666">50 % alpha</text>

  <rect x="960" y="110" width="160" height="160" fill="url(#checker)"/>
  <rect x="960" y="110" width="160" height="160" fill="none" stroke="#222" stroke-width="2"/>
  <text x="1040" y="295" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="17" fill="#666">focus</text>

  <g stroke="#666" stroke-width="1">
    <circle cx="660" cy="716" r="24" fill="#000"/>
    <circle cx="708" cy="704" r="24" fill="#404040"/>
    <circle cx="756" cy="693" r="24" fill="#808080"/>
    <circle cx="804" cy="684" r="24" fill="#bfbfbf"/>
    <circle cx="852" cy="678" r="24" fill="#fff"/>
    <circle cx="900" cy="676" r="24" fill="#d22"/>
    <circle cx="948" cy="678" r="24" fill="#2b2"/>
    <circle cx="996" cy="684" r="24" fill="#22d"/>
    <circle cx="1044" cy="693" r="24" fill="#0bb"/>
    <circle cx="1092" cy="704" r="24" fill="#b0b"/>
    <circle cx="1140" cy="716" r="24" fill="#bb0"/>
  </g>

  <text x="600" y="780" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="34" fill="#333">Artograph</text>
  <text x="600" y="30" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#777">calibration card · grid 100 px · ground is transparent</text>
</svg>`;

/** (Re)create the demo project in its pristine state, overwriting any edits. */
export async function createDemoProject(): Promise<ProjectDoc> {
  const blob = new Blob([CALIBRATION_SVG], { type: 'image/svg+xml' });
  const imageId = await saveImageBlob(blob);
  const doc = newProject(DEMO_NAME);
  doc.id = DEMO_ID;
  doc.demoVersion = DEMO_VERSION;
  doc.layers.push({
    id: crypto.randomUUID(),
    imageId,
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    scale: Math.min(1, (0.85 * window.innerWidth) / W, (0.85 * window.innerHeight) / H),
    rotation: 0,
    z: 1,
    opacity: 1,
    locked: false,
  });
  await saveProject(doc);
  return doc;
}

export async function ensureDemoProject(): Promise<void> {
  const existing = await getProject(DEMO_ID);
  if (!existing || existing.demoVersion !== DEMO_VERSION) await createDemoProject();
}
