import { screenToStage } from './keystone';
import { app, mutate } from './state';
import { getImageBlob, saveImageBlob } from './store';
import { toast } from './toast';
import type { Layer, Pt } from './types';

const layersEl = document.getElementById('layers') as HTMLElement;
const urlCache = new Map<string, string>();

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

/** Revoke object URLs when closing a project. */
export function releaseImageURLs(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
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
  void imageURL(layer.imageId).then((url) => {
    img.src = url;
  });
  const handles = document.createElement('div');
  handles.className = 'handles';
  for (const corner of ['tl', 'tr', 'br', 'bl']) {
    const h = document.createElement('span');
    h.className = `handle ${corner}`;
    h.dataset.handle = corner;
    handles.append(h);
  }
  const rot = document.createElement('span');
  rot.className = 'rot-handle';
  rot.dataset.handle = 'rotate';
  handles.append(rot);
  el.append(img, handles);
  return el;
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
    el.style.left = `${layer.x}px`;
    el.style.top = `${layer.y}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${layer.scale})`;
    el.style.zIndex = String(layer.z);
    el.style.opacity = String(layer.opacity);
    // Counter-scale so selection chrome keeps a constant on-screen size.
    el.style.setProperty('--k', String(1 / layer.scale));
    el.classList.toggle('selected', layer.id === app.selectedId);
    el.classList.toggle('locked', layer.locked === true);
  }
}

function nextZ(): number {
  return Math.max(0, ...(app.project?.layers.map((l) => l.z) ?? [])) + 1;
}

export async function addImageFiles(files: Iterable<File>, at?: Pt): Promise<void> {
  const project = app.project;
  if (!project) return;
  let pt = at ?? screenToStage({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const imageId = await saveImageBlob(file);
    const bmp = await createImageBitmap(file);
    const scale = Math.min(
      1,
      (0.6 * window.innerWidth) / bmp.width,
      (0.6 * window.innerHeight) / bmp.height,
    );
    bmp.close();
    const layer: Layer = {
      id: crypto.randomUUID(),
      imageId,
      x: pt.x,
      y: pt.y,
      scale,
      rotation: 0,
      z: nextZ(),
      opacity: 1,
      locked: false,
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

/** Move the selected layer one step forward (+1) or backward (-1) in z-order. */
export function reorderSelected(dir: 1 | -1): void {
  const project = app.project;
  const layer = selectedLayer();
  if (!project || !layer) return;
  const sorted = [...project.layers].sort((a, b) => a.z - b.z);
  const i = sorted.indexOf(layer);
  const neighbor = sorted[i + dir];
  if (!neighbor) return;
  [layer.z, neighbor.z] = [neighbor.z, layer.z];
  mutate();
}

export function nudgeSelected(dx: number, dy: number): void {
  const layer = selectedLayer();
  if (!layer || layer.locked) return;
  layer.x += dx;
  layer.y += dy;
  mutate();
}
