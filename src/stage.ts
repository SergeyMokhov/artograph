import { screenToStage } from './keystone';
import { renderOutline } from './outline';
import { app, mutate } from './state';
import { getImageBlob, saveImageBlob } from './store';
import { toast } from './toast';
import { defaultOutline, type Layer, type OutlineOpts, type Pt } from './types';

const layersEl = document.getElementById('layers') as HTMLElement;
const urlCache = new Map<string, string>();
// Computed-outline object URLs, keyed by image + the settings that produced it.
const outlineCache = new Map<string, string>();

async function imageURL(imageId: string): Promise<string> {
  let url = urlCache.get(imageId);
  if (url === undefined) {
    const blob = await getImageBlob(imageId);
    if (!blob) throw new Error(`image ${imageId} missing from store`);
    url = URL.createObjectURL(blob);
    urlCache.set(imageId, url);
  }
  return url;
}

function outlineKey(imageId: string, o: OutlineOpts): string {
  return `${imageId}|${o.threshold}|${o.thickness}|${o.color}`;
}

async function outlineURL(imageId: string, o: OutlineOpts): Promise<string> {
  const key = outlineKey(imageId, o);
  let url = outlineCache.get(key);
  if (url === undefined) {
    const blob = await getImageBlob(imageId);
    if (!blob) throw new Error(`image ${imageId} missing from store`);
    url = URL.createObjectURL(await renderOutline(blob, o));
    outlineCache.set(key, url);
  }
  return url;
}

/** Revoke object URLs when closing a project. */
export function releaseImageURLs(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  for (const url of outlineCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  outlineCache.clear();
}

export function selectedLayer(): Layer | undefined {
  return app.project?.layers.find((l) => l.id === app.selectedId);
}

function createLayerEl(layer: Layer): HTMLElement {
  const el = document.createElement('div');
  el.className = 'layer';
  el.dataset.id = layer.id;
  const img = document.createElement('img');
  img.draggable = false;
  img.alt = '';
  // src is set reactively in renderStage so it can swap to the outline render.
  const handles = document.createElement('div');
  handles.className = 'handles';
  for (const corner of ['tl', 'tr', 'br', 'bl']) {
    const h = document.createElement('span');
    h.className = `handle ${corner}`;
    h.dataset.handle = corner;
    h.title = 'Drag to resize (scales around the center)';
    handles.append(h);
  }
  const rot = document.createElement('span');
  rot.className = 'rot-handle';
  rot.dataset.handle = 'rotate';
  rot.title = 'Drag to rotate (hold Shift to snap to 15°)';
  handles.append(rot);
  el.append(img, handles);
  return el;
}

/**
 * Point an <img> at the original image or its computed outline, depending on
 * the layer's settings. The desired source is recorded on the element so we
 * only recompute when it actually changes, and a slow async outline render
 * that finishes after the user moved on is discarded.
 */
function resolveLayerSrc(img: HTMLImageElement, layer: Layer): void {
  const o = layer.outline;
  const want = o?.on ? `outline|${outlineKey(layer.imageId, o)}` : `orig|${layer.imageId}`;
  if (img.dataset.srcKey === want) return;
  img.dataset.srcKey = want;
  const pending = o?.on ? outlineURL(layer.imageId, o) : imageURL(layer.imageId);
  pending.then(
    (url) => {
      // Only apply if this is still the source the layer wants.
      if (img.dataset.srcKey === want) img.src = url;
    },
    (err: unknown) => {
      if (img.dataset.srcKey === want) toast(`Outline failed: ${String(err)}`, true);
    },
  );
}

export function renderStage(): void {
  const project = app.project;
  for (const el of [...layersEl.querySelectorAll<HTMLElement>('.layer')]) {
    if (!project?.layers.some((l) => l.id === el.dataset.id)) el.remove();
  }
  if (!project) return;
  for (const layer of project.layers) {
    let el = layersEl.querySelector<HTMLElement>(`.layer[data-id="${layer.id}"]`);
    if (!el) {
      el = createLayerEl(layer);
      layersEl.append(el);
    }
    const sx = layer.stretchX ?? 1;
    const sy = layer.stretchY ?? 1;
    // Keep the single-argument form when unstretched (the common case).
    const scale = sx === 1 && sy === 1 ? `scale(${layer.scale})` : `scale(${layer.scale * sx}, ${layer.scale * sy})`;
    el.style.left = `${layer.x}px`;
    el.style.top = `${layer.y}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${layer.rotation}deg) ${scale}`;
    el.style.zIndex = String(layer.z);
    el.style.opacity = String(layer.opacity);
    // Invert on the <img> only, so selection handles aren't affected.
    const img = el.querySelector('img');
    if (img) {
      img.style.filter = layer.invert ? 'invert(1)' : '';
      resolveLayerSrc(img, layer);
    }
    // Counter-scale so selection chrome keeps a constant on-screen size.
    // Split per-axis so handles stay square even when the image is stretched.
    el.style.setProperty('--kx', String(1 / (layer.scale * sx)));
    el.style.setProperty('--ky', String(1 / (layer.scale * sy)));
    el.style.setProperty('--k', String(1 / layer.scale));
    el.classList.toggle('selected', layer.id === app.selectedId);
    el.classList.toggle('locked', layer.locked === true);
  }
}

function nextZ(): number {
  return Math.max(0, ...(app.project?.layers.map((l) => l.z) ?? [])) + 1;
}

async function imageDimensions(blob: Blob): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const d = { w: bmp.width, h: bmp.height };
    bmp.close();
    return d;
  } catch {
    // createImageBitmap rejects SVG blobs; decode through an <img> instead.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { w: img.naturalWidth || 800, h: img.naturalHeight || 600 };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function addImageFiles(files: Iterable<File>, at?: Pt): Promise<void> {
  const project = app.project;
  if (!project) return;
  // Without an explicit drop point, cascade around the viewport center based on
  // how many layers already exist, so a re-imported (identical) image doesn't
  // land exactly on top of the previous one and become unselectable.
  const step = (project.layers.length % 6) * 34;
  let pt = at ?? screenToStage({ x: window.innerWidth / 2 - 85 + step, y: window.innerHeight / 2 - 85 + step });
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const imageId = await saveImageBlob(file);
    const { w, h } = await imageDimensions(file);
    const scale = Math.min(1, (0.6 * window.innerWidth) / w, (0.6 * window.innerHeight) / h);
    const layer: Layer = {
      id: crypto.randomUUID(),
      imageId,
      x: pt.x,
      y: pt.y,
      scale,
      stretchX: 1,
      stretchY: 1,
      rotation: 0,
      z: nextZ(),
      opacity: 1,
      locked: false,
      invert: false,
    };
    project.layers.push(layer);
    app.selectedId = layer.id;
    pt = { x: pt.x + 40, y: pt.y + 40 };
  }
  mutate();
}

export function deleteSelected(): void {
  const project = app.project;
  const layer = selectedLayer();
  if (!project || !layer) return;
  if (layer.locked) {
    toast('Image is frozen in place — press L to unfreeze it first');
    return;
  }
  project.layers = project.layers.filter((l) => l.id !== layer.id);
  app.selectedId = null;
  mutate();
}

export function toggleLockSelected(): void {
  const layer = selectedLayer();
  if (!layer) return;
  layer.locked = !layer.locked;
  toast(layer.locked ? 'Image frozen in place — press L to unfreeze' : 'Image unfrozen');
  mutate();
}

/** Invert the selected layer's colors. Allowed even when locked (not geometry). */
export function toggleInvertSelected(): void {
  const layer = selectedLayer();
  if (!layer) return;
  layer.invert = !layer.invert;
  mutate();
}

/**
 * Toggle the outline (edge-detection) effect on the selected layer. Keeps any
 * previously-tuned settings; only flips `on`. Allowed even when locked.
 */
export function toggleOutlineSelected(): void {
  const layer = selectedLayer();
  if (!layer) return;
  if (layer.outline) layer.outline.on = !layer.outline.on;
  else layer.outline = defaultOutline();
  mutate();
}

/**
 * Change the selected layer's number (z) by one step: forward (+1) or
 * backward (-1). The number is a direct, editable value — negatives allowed —
 * so this simply increments it rather than swapping with a neighbour.
 */
export function reorderSelected(dir: 1 | -1): void {
  const layer = selectedLayer();
  if (!layer) return;
  layer.z += dir;
  mutate();
}

/** Set the selected layer's number (z) directly. Negatives allowed; NaN → 0. */
export function setLayerZ(z: number): void {
  const layer = selectedLayer();
  if (!layer) return;
  layer.z = Number.isFinite(z) ? Math.round(z) : 0;
  mutate();
}

/** Set the selected layer's non-uniform stretch factors (default 1 = square). */
export function setStretch(axis: 'x' | 'y', value: number): void {
  const layer = selectedLayer();
  if (!layer || layer.locked) return;
  const v = Number.isFinite(value) && value > 0 ? value : 1;
  if (axis === 'x') layer.stretchX = v;
  else layer.stretchY = v;
  mutate();
}

/** Reset the selected layer's stretch back to square (1 × 1). */
export function resetStretch(): void {
  const layer = selectedLayer();
  if (!layer || layer.locked) return;
  layer.stretchX = 1;
  layer.stretchY = 1;
  mutate();
}

/** Center the selected image on the canvas (the projected source rectangle). */
export function centerSelectedOnCanvas(): void {
  const layer = selectedLayer();
  if (!layer || layer.locked) return;
  // Layers live in untransformed stage coordinates; the canvas source rect is
  // centered in the viewport, so its center is simply the viewport center.
  layer.x = window.innerWidth / 2;
  layer.y = window.innerHeight / 2;
  mutate();
}

/** Center the selected image on top of another image (shared center point). */
export function centerSelectedOnLayer(targetId: string): void {
  const layer = selectedLayer();
  const target = app.project?.layers.find((l) => l.id === targetId);
  if (!layer || layer.locked || !target || target.id === layer.id) return;
  layer.x = target.x;
  layer.y = target.y;
  mutate();
}

export function nudgeSelected(dx: number, dy: number): void {
  const layer = selectedLayer();
  if (!layer || layer.locked) return;
  layer.x += dx;
  layer.y += dy;
  mutate();
}
