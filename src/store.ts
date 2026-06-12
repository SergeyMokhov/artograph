import { createStore, del, get, getMany, keys, set } from 'idb-keyval';
import type { ProjectDoc } from './types';

// idb-keyval supports one object store per database, so projects and image
// blobs live in separate databases.
const projectStore = createStore('artograph-projects', 'projects');
const imageStore = createStore('artograph-images', 'images');

export async function listProjects(): Promise<ProjectDoc[]> {
  const ids = (await keys(projectStore)) as string[];
  const docs = await getMany<ProjectDoc>(ids, projectStore);
  return docs.filter((d): d is ProjectDoc => d != null).sort((a, b) => b.savedAt - a.savedAt);
}

export function getProject(id: string): Promise<ProjectDoc | undefined> {
  return get<ProjectDoc>(id, projectStore);
}

export async function saveProject(doc: ProjectDoc): Promise<void> {
  doc.savedAt = Date.now();
  await set(doc.id, doc, projectStore);
}

export async function deleteProject(id: string): Promise<void> {
  await del(id, projectStore);
  await gcImages();
}

/** Store an image blob keyed by content hash; dedups across projects. */
export async function saveImageBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const id = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if ((await get(id, imageStore)) === undefined) await set(id, blob, imageStore);
  return id;
}

export function getImageBlob(id: string): Promise<Blob | undefined> {
  return get<Blob>(id, imageStore);
}

/** Drop image blobs no longer referenced by any project. */
export async function gcImages(): Promise<void> {
  const referenced = new Set((await listProjects()).flatMap((p) => p.layers.map((l) => l.imageId)));
  for (const k of (await keys(imageStore)) as string[]) {
    if (!referenced.has(k)) await del(k, imageStore);
  }
}
