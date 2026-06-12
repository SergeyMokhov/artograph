import { IDENTITY, adjugate, applyToPoint, homography, toMatrix3d, type Mat3 } from './homography';
import { app, mutate } from './state';
import { defaultKeystone, type KeystoneState, type Pt } from './types';

const stageEl = document.getElementById('stage') as HTMLElement;
const cornersEl = document.getElementById('corners') as HTMLElement;
const panelEl = document.getElementById('keystone-panel') as HTMLElement;

let H: Mat3 = IDENTITY;
let Hinv: Mat3 = IDENTITY;

/** Map a screen/pointer point into untransformed stage coordinates. */
export function screenToStage(p: Pt): Pt {
  return applyToPoint(Hinv, p);
}

const DEG = Math.PI / 180;

function baseCorners(w: number, h: number): [Pt, Pt, Pt, Pt] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

/** Stage corners after the rotation/perspective projection, before offsets. */
function projectedCorners(ks: KeystoneState, w: number, h: number): [Pt, Pt, Pt, Pt] {
  const cx = w / 2;
  const cy = h / 2;
  const ax = ks.rotX * DEG;
  const ay = ks.rotY * DEG;
  const az = ks.rotZ * DEG;
  return baseCorners(w, h).map((p) => {
    let x = p.x - cx;
    let y = p.y - cy;
    let z = 0;
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
    // Perspective divide; the clamp keeps corners in front of the camera so
    // extreme slider values distort instead of exploding/flipping.
    const s = ks.persp / Math.max(ks.persp - z, 50);
    return { x: cx + x * s, y: cy + y * s };
  }) as [Pt, Pt, Pt, Pt];
}

function finalCorners(ks: KeystoneState, w: number, h: number): [Pt, Pt, Pt, Pt] {
  return projectedCorners(ks, w, h).map((p, i) => ({
    x: p.x + ks.offsets[i].x * w,
    y: p.y + ks.offsets[i].y * h,
  })) as [Pt, Pt, Pt, Pt];
}

/** Recompute the stage matrix3d from the current keystone state. */
export function applyKeystone(): void {
  const ks = app.project?.keystone ?? defaultKeystone();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dst = finalCorners(ks, w, h);
  H = homography(baseCorners(w, h), dst);
  Hinv = adjugate(H);
  stageEl.style.transform = toMatrix3d(H);
  cornerEls.forEach((el, i) => {
    el.style.left = `${dst[i].x}px`;
    el.style.top = `${dst[i].y}px`;
  });
  syncSliders(ks);
}

const SLIDER_FIELDS = ['rotX', 'rotY', 'rotZ', 'persp'] as const;

function slider(field: (typeof SLIDER_FIELDS)[number]): HTMLInputElement {
  return document.getElementById(`ks-${field}`) as HTMLInputElement;
}

function syncSliders(ks: KeystoneState): void {
  for (const f of SLIDER_FIELDS) slider(f).value = String(ks[f]);
}

const cornerEls: HTMLElement[] = [];

export function initKeystone(): void {
  for (let i = 0; i < 4; i++) {
    const el = document.createElement('div');
    el.className = 'corner';
    el.title = 'Drag to pin this corner';
    cornersEl.append(el);
    cornerEls.push(el);
    el.addEventListener('pointerdown', (e) => beginCornerDrag(e, i));
  }

  for (const f of SLIDER_FIELDS) {
    slider(f).addEventListener('input', () => {
      const ks = app.project?.keystone;
      if (!ks) return;
      ks[f] = parseFloat(slider(f).value);
      mutate();
    });
  }

  (document.getElementById('ks-reset') as HTMLButtonElement).addEventListener('click', () => {
    if (!app.project) return;
    app.project.keystone = defaultKeystone();
    mutate();
  });

  window.addEventListener('resize', applyKeystone);
}

function beginCornerDrag(e: PointerEvent, i: number): void {
  e.preventDefault();
  e.stopPropagation();
  const onMove = (ev: PointerEvent) => {
    const ks = app.project?.keystone;
    if (!ks) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const proj = projectedCorners(ks, w, h)[i];
    // Offset chosen so the final corner lands exactly under the pointer.
    ks.offsets[i] = { x: (ev.clientX - proj.x) / w, y: (ev.clientY - proj.y) / h };
    mutate();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

export function toggleCalibrate(force?: boolean): void {
  const on = document.body.classList.toggle('calibrating', force);
  panelEl.hidden = !on;
  cornersEl.hidden = !on;
}
