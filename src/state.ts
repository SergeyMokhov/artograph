import type { ProjectDoc } from './types';

/** Central mutable app state. Mutate fields, then call `mutate()` to re-render. */
export const app = {
  project: null as ProjectDoc | null,
  selectedId: null as string | null,
};

type Listener = () => void;
const listeners: Listener[] = [];

export function subscribe(fn: Listener): void {
  listeners.push(fn);
}

/** Notify all subscribers (render, keystone, toolbar, autosave) of a state change. */
export function mutate(): void {
  for (const fn of listeners) fn();
}
