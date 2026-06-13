import { IDENTITY, adjugate, applyToPoint, homography, toMatrix3d, type Mat3 } from './homography';
import { app, mutate } from './state';
import { toast } from './toast';
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

/**
 * Source rectangle of the homography. Without a canvas size this is the full
 * viewport; with one it is the largest centered rect of the canvas's aspect,
 * so mapping it onto the canvas quad scales content uniformly.
 */
function srcCorners(ks: KeystoneState, w: number, h: number): [Pt, Pt, Pt, Pt] {
  let sw = w;
  let sh = h;
  const cw = ks.canvasW ?? 0;
  const ch = ks.canvasH ?? 0;
  if (cw > 0 && ch > 0) {
    const aspect = cw / ch;
    if (aspect < w / h) sw = h * aspect;
    else sh = w / aspect;
  }
  const x0 = (w - sw) / 2;
  const y0 = (h - sh) / 2;
  return [
    { x: x0, y: y0 },
    { x: x0 + sw, y: y0 },
    { x: x0 + sw, y: y0 + sh },
    { x: x0, y: y0 + sh },
  ];
}

/** Stage corners after the rotation/perspective projection, before offsets. */
function projectedCorners(ks: KeystoneState, w: number, h: number): [Pt, Pt, Pt, Pt] {
  const cx = w / 2;
  const cy = h / 2;
  const ax = ks.rotX * DEG;
  const ay = ks.rotY * DEG;
  const az = ks.rotZ * DEG;
  return srcCorners(ks, w, h).map((p) => {
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
  H = homography(srcCorners(ks, w, h), dst);
  Hinv = adjugate(H);
  stageEl.style.transform = toMatrix3d(H);
  // Keep the handles fully visible and grabbable even when the true corner
  // sits at (or beyond) the window edge.
  const M = 16;
  cornerEls.forEach((el, i) => {
    el.style.left = `${Math.min(Math.max(dst[i].x, M), w - M)}px`;
    el.style.top = `${Math.min(Math.max(dst[i].y, M), h - M)}px`;
  });
  syncSliders(ks);
  syncCanvasInputs(ks);
}

const SLIDER_FIELDS = ['rotX', 'rotY', 'rotZ', 'persp'] as const;
const CANVAS_FIELDS = ['canvasW', 'canvasH'] as const;

function canvasInput(field: (typeof CANVAS_FIELDS)[number]): HTMLInputElement {
  return document.getElementById(`ks-${field}`) as HTMLInputElement;
}

function syncCanvasInputs(ks: KeystoneState): void {
  for (const f of CANVAS_FIELDS) {
    const el = canvasInput(f);
    // Don't fight the user while they're typing in the field.
    if (document.activeElement === el) continue;
    const v = ks[f];
    el.value = v !== undefined && v > 0 ? String(v) : '';
  }
}

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

  for (const f of CANVAS_FIELDS) {
    canvasInput(f).addEventListener('input', () => {
      const ks = app.project?.keystone;
      if (!ks) return;
      const v = parseFloat(canvasInput(f).value);
      ks[f] = Number.isFinite(v) && v > 0 ? v : undefined;
      mutate();
    });
  }

  (document.getElementById('ks-from-pins') as HTMLButtonElement).addEventListener('click', adoptCanvasFromPins);

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
  const ks = app.project?.keystone;
  if (!ks) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const orig = { ...ks.offsets[i] };
  // Delta-based drag: the handle's displayed position is clamped into the
  // window, so the corner moves by the pointer's movement rather than
  // jumping to the pointer's absolute position.
  const onMove = (ev: PointerEvent) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ks.offsets[i] = {
      x: orig.x + (ev.clientX - startX) / w,
      y: orig.y + (ev.clientY - startY) / h,
    };
    mutate();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/**
 * Infer the canvas ratio from the pinned quad's average width/height and
 * adopt it without moving the quad: the source frame changes, so the offsets
 * are recomputed to keep every final corner exactly where the user pinned it.
 * Assumes the projector faces the canvas roughly square-on — under strong
 * tilt the quad conflates tilt with canvas shape and the estimate drifts.
 */
function adoptCanvasFromPins(): void {
  const ks = app.project?.keystone;
  if (!ks) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dst = finalCorners(ks, w, h);
  const avgW = (Math.hypot(dst[1].x - dst[0].x, dst[1].y - dst[0].y) + Math.hypot(dst[2].x - dst[3].x, dst[2].y - dst[3].y)) / 2;
  const avgH = (Math.hypot(dst[3].x - dst[0].x, dst[3].y - dst[0].y) + Math.hypot(dst[2].x - dst[1].x, dst[2].y - dst[1].y)) / 2;
  if (avgW < 40 || avgH < 40) {
    toast('Pin the four corners onto the canvas first', true);
    return;
  }
  // Express the ratio in small integers (1% precision): 0.75 -> 3 x 4.
  let cw = Math.round((avgW / avgH) * 100);
  let ch = 100;
  for (let d = 2; d <= cw && d <= ch; d++) {
    while (cw % d === 0 && ch % d === 0) {
      cw /= d;
      ch /= d;
    }
  }
  ks.canvasW = cw;
  ks.canvasH = ch;
  // Re-anchor the quad: new source frame, same final corners.
  const proj = projectedCorners(ks, w, h);
  ks.offsets = dst.map((p, i) => ({
    x: (p.x - proj[i].x) / w,
    y: (p.y - proj[i].y) / h,
  })) as [Pt, Pt, Pt, Pt];
  toast(`Canvas ratio set from pins: ${cw} × ${ch}`);
  mutate();
}

export function toggleCalibrate(force?: boolean): void {
  const on = document.body.classList.toggle('calibrating', force);
  panelEl.hidden = !on;
  cornersEl.hidden = !on;
}
