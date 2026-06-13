import { getImageBlob, saveImageBlob, saveProject } from './store';
import { defaultKeystone, type Layer, type OutlineOpts, type ProjectDoc } from './types';

interface ExportPayload {
  format: 'artograph';
  version: 1;
  project: ProjectDoc;
  /** imageId -> data URL */
  images: Record<string, string>;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

export async function exportProject(project: ProjectDoc): Promise<void> {
  const images: Record<string, string> = {};
  for (const id of new Set(project.layers.map((l) => l.imageId))) {
    const blob = await getImageBlob(id);
    if (blob) images[id] = await blobToDataURL(blob);
  }
  const payload: ExportPayload = { format: 'artograph', version: 1, project, images };
  const file = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = `${project.name || 'untitled'}.artograph`;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking immediately aborts the download in Firefox; give it time to start.
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validate an untrusted outline blob, or drop it (returns undefined). */
function parseOutline(v: unknown): OutlineOpts | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Partial<OutlineOpts>;
  const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#ff00ff';
  return {
    on: o.on === true,
    threshold: clamp(num(o.threshold, 0.18), 0, 1),
    thickness: clamp(Math.round(num(o.thickness, 1)), 0, 8),
    color,
  };
}

/** Parse untrusted file content into a validated ProjectDoc (or throw). */
export async function importProject(file: File): Promise<ProjectDoc> {
  const payload = JSON.parse(await file.text()) as Partial<ExportPayload>;
  if (payload?.format !== 'artograph' || typeof payload.project !== 'object' || payload.project === null) {
    throw new Error('Not an artograph project file');
  }
  const raw = payload.project as Partial<ProjectDoc>;
  const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];

  // Re-store every embedded image; the content hash the store returns is
  // authoritative, so remap layer references in case the file was edited.
  const idMap = new Map<string, string>();
  for (const [id, dataURL] of Object.entries(payload.images ?? {})) {
    if (typeof dataURL !== 'string' || !dataURL.startsWith('data:')) continue;
    const blob = await (await fetch(dataURL)).blob();
    idMap.set(id, await saveImageBlob(blob));
  }

  const ks = { ...defaultKeystone(), ...(typeof raw.keystone === 'object' ? raw.keystone : null) };
  if (!Array.isArray(ks.offsets) || ks.offsets.length !== 4) ks.offsets = defaultKeystone().offsets;
  for (const f of ['canvasW', 'canvasH'] as const) {
    const v = ks[f];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) delete ks[f];
  }

  const layers: Layer[] = rawLayers.flatMap((l: Partial<Layer>, i): Layer[] => {
    const imageId = typeof l.imageId === 'string' ? idMap.get(l.imageId) : undefined;
    if (imageId === undefined) return [];
    return [
      {
        id: crypto.randomUUID(),
        imageId,
        x: num(l.x, window.innerWidth / 2),
        y: num(l.y, window.innerHeight / 2),
        scale: num(l.scale, 1),
        rotation: num(l.rotation, 0),
        z: num(l.z, i),
        opacity: Math.min(1, Math.max(0.05, num(l.opacity, 1))),
        locked: l.locked === true,
        invert: l.invert === true,
        outline: parseOutline(l.outline),
      },
    ];
  });

  const doc: ProjectDoc = {
    id: crypto.randomUUID(),
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : 'Imported project',
    savedAt: Date.now(),
    keystone: ks,
    layers,
  };
  await saveProject(doc);
  return doc;
}
