import { screenToStage } from './keystone';
import { addImageFiles, deleteSelected, nudgeSelected, reorderSelected, selectedLayer, toggleInvertSelected, toggleLockSelected, toggleOutlineSelected } from './stage';
import { app, mutate } from './state';
import type { Layer, Pt } from './types';

type Drag =
  | { kind: 'move'; layer: Layer; start: Pt; origX: number; origY: number }
  | { kind: 'scale'; layer: Layer; startDist: number; origScale: number }
  | { kind: 'rotate'; layer: Layer; startAngle: number; origRotation: number };

let drag: Drag | null = null;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function pointerPt(e: PointerEvent | WheelEvent): Pt {
  return screenToStage({ x: e.clientX, y: e.clientY });
}

function layerFromEl(el: Element | null): Layer | undefined {
  const id = el?.closest<HTMLElement>('.layer')?.dataset.id;
  return app.project?.layers.find((l) => l.id === id);
}

function onPointerDown(e: PointerEvent): void {
  if (!app.project || e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest('#ui, #picker')) return;

  // preventDefault below suppresses the browser's default focus transfer, so
  // explicitly release focus from any UI control (e.g. a tilt slider) —
  // otherwise it keeps eating keyboard shortcuts and arrow keys.
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }

  const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
  const layer = layerFromEl(target);

  if (handle && app.selectedId !== null) {
    const sel = selectedLayer();
    if (!sel || sel.locked) return;
    const p = pointerPt(e);
    const center = { x: sel.x, y: sel.y };
    if (handle === 'rotate') {
      drag = {
        kind: 'rotate',
        layer: sel,
        startAngle: Math.atan2(p.y - center.y, p.x - center.x),
        origRotation: sel.rotation,
      };
    } else {
      drag = {
        kind: 'scale',
        layer: sel,
        startDist: Math.max(1, Math.hypot(p.x - center.x, p.y - center.y)),
        origScale: sel.scale,
      };
    }
  } else if (layer) {
    app.selectedId = layer.id;
    if (!layer.locked) {
      const p = pointerPt(e);
      drag = { kind: 'move', layer, start: p, origX: layer.x, origY: layer.y };
    }
    mutate();
  } else {
    app.selectedId = null;
    mutate();
  }
  if (drag) e.preventDefault();
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) return;
  const p = pointerPt(e);
  const layer = drag.layer;
  switch (drag.kind) {
    case 'move':
      layer.x = drag.origX + (p.x - drag.start.x);
      layer.y = drag.origY + (p.y - drag.start.y);
      break;
    case 'scale': {
      const dist = Math.hypot(p.x - layer.x, p.y - layer.y);
      layer.scale = clamp((drag.origScale * dist) / drag.startDist, 0.02, 50);
      break;
    }
    case 'rotate': {
      const angle = Math.atan2(p.y - layer.y, p.x - layer.x);
      let deg = drag.origRotation + ((angle - drag.startAngle) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      layer.rotation = deg;
      break;
    }
  }
  mutate();
}

function onWheel(e: WheelEvent): void {
  if (!app.project || (e.target as HTMLElement).closest('#ui, #picker')) return;
  const layer = layerFromEl(e.target as Element) ?? selectedLayer();
  if (!layer || layer.locked) return;
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0015);
  const newScale = clamp(layer.scale * factor, 0.02, 50);
  const k = newScale / layer.scale;
  // Keep the stage point under the cursor fixed while scaling.
  const p = pointerPt(e);
  layer.x = p.x + (layer.x - p.x) * k;
  layer.y = p.y + (layer.y - p.y) * k;
  layer.scale = newScale;
  mutate();
}

function onKeyDown(e: KeyboardEvent): void {
  if (!app.project) return;
  if ((e.target as HTMLElement).matches('input, textarea, select')) return;
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case 'Escape':
      app.selectedId = null;
      mutate();
      break;
    case 'Delete':
    case 'Backspace':
      deleteSelected();
      break;
    case 'ArrowLeft':
      nudgeSelected(-step, 0);
      break;
    case 'ArrowRight':
      nudgeSelected(step, 0);
      break;
    case 'ArrowUp':
      nudgeSelected(0, -step);
      break;
    case 'ArrowDown':
      nudgeSelected(0, step);
      break;
    case '[':
      reorderSelected(-1);
      break;
    case ']':
      reorderSelected(1);
      break;
    case 'f':
    case 'F':
      document.getElementById('btn-full')?.click();
      break;
    case 'g':
    case 'G':
      document.getElementById('btn-grid')?.click();
      break;
    case 't':
    case 'T':
      document.getElementById('btn-tilt')?.click();
      break;
    case 'l':
    case 'L':
      toggleLockSelected();
      break;
    case 'i':
    case 'I':
      toggleInvertSelected();
      break;
    case 'o':
    case 'O':
      toggleOutlineSelected();
      break;
    default:
      return;
  }
  e.preventDefault();
}

export function initInteractions(): void {
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', () => {
    drag = null;
  });
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!app.project || !e.dataTransfer) return;
    const files = [...e.dataTransfer.files];
    if (files.length > 0) {
      void addImageFiles(files, screenToStage({ x: e.clientX, y: e.clientY }));
    }
  });

  window.addEventListener('paste', (e) => {
    if (!app.project) return;
    const files = [...(e.clipboardData?.items ?? [])]
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length > 0) void addImageFiles(files);
  });
}
