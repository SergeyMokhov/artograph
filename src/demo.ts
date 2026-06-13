import { getProject, saveImageBlob, saveProject } from './store';
import { newProject, type ProjectDoc } from './types';

/** Fixed id so the demo project can be recognized (Reset instead of Delete). */
export const DEMO_ID = 'demo-calibration';

const DEMO_NAME = 'Demo — calibration target';
const W = 1200;
const H = 800;

/**
 * Test & calibration target. The background is intentionally transparent and
 * the discs are translucent, so it doubles as an alpha-rendering test:
 * - 100 px grid, center crosshair, diagonals: keystone/tilt calibration
 * - concentric circles: they read as ellipses if the projection is skewed
 * - checkerboard: projector focus
 * - grayscale + color bars: brightness/color check
 */
const CALIBRATION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">
  <defs>
    <pattern id="checker" width="40" height="40" patternUnits="userSpaceOnUse">
      <rect width="20" height="20" fill="#000"/>
      <rect x="20" y="20" width="20" height="20" fill="#000"/>
    </pattern>
  </defs>
  <path d="M100 0v800M200 0v800M300 0v800M400 0v800M500 0v800M600 0v800M700 0v800M800 0v800M900 0v800M1000 0v800M1100 0v800M0 100h1200M0 200h1200M0 300h1200M0 400h1200M0 500h1200M0 600h1200M0 700h1200" stroke="#aaa" stroke-width="1"/>
  <path d="M0 0L1200 800M1200 0L0 800" stroke="#d11" stroke-width="1.5"/>
  <path d="M600 0v800M0 400h1200" stroke="#d11" stroke-width="2"/>
  <rect x="2" y="2" width="1196" height="796" fill="none" stroke="#d11" stroke-width="4"/>
  <circle cx="600" cy="400" r="350" fill="none" stroke="#111" stroke-width="2.5"/>
  <circle cx="600" cy="400" r="175" fill="none" stroke="#111" stroke-width="2.5"/>
  <circle cx="190" cy="180" r="85" fill="#e11" fill-opacity="0.5"/>
  <circle cx="260" cy="180" r="85" fill="#1a4" fill-opacity="0.5"/>
  <circle cx="225" cy="240" r="85" fill="#23e" fill-opacity="0.5"/>
  <text x="225" y="355" text-anchor="middle" font-size="20" fill="#444">50% alpha</text>
  <rect x="960" y="110" width="160" height="160" fill="url(#checker)"/>
  <rect x="960" y="110" width="160" height="160" fill="none" stroke="#111" stroke-width="2"/>
  <text x="1040" y="295" text-anchor="middle" font-size="20" fill="#444">focus</text>
  <g stroke="#555" stroke-width="1">
    <rect x="215" y="650" width="70" height="60" fill="#000"/>
    <rect x="285" y="650" width="70" height="60" fill="#404040"/>
    <rect x="355" y="650" width="70" height="60" fill="#808080"/>
    <rect x="425" y="650" width="70" height="60" fill="#bfbfbf"/>
    <rect x="495" y="650" width="70" height="60" fill="#fff"/>
    <rect x="565" y="650" width="70" height="60" fill="#e00"/>
    <rect x="635" y="650" width="70" height="60" fill="#0c0"/>
    <rect x="705" y="650" width="70" height="60" fill="#00e"/>
    <rect x="775" y="650" width="70" height="60" fill="#0cc"/>
    <rect x="845" y="650" width="70" height="60" fill="#c0c"/>
    <rect x="915" y="650" width="70" height="60" fill="#cc0"/>
  </g>
  <text x="600" y="745" text-anchor="middle" font-size="22" fill="#333">ARTOGRAPH calibration · grid 100 px · background is transparent</text>
</svg>`;

/** (Re)create the demo project in its pristine state, overwriting any edits. */
export async function createDemoProject(): Promise<ProjectDoc> {
  const blob = new Blob([CALIBRATION_SVG], { type: 'image/svg+xml' });
  const imageId = await saveImageBlob(blob);
  const doc = newProject(DEMO_NAME);
  doc.id = DEMO_ID;
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
  if (!(await getProject(DEMO_ID))) await createDemoProject();
}
