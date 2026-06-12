const toastEl = document.createElement('div');
toastEl.id = 'toast';
document.body.append(toastEl);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Feedback that can't be missed, for saves, locks, and errors. */
export function toast(msg: string, isError = false): void {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), isError ? 5000 : 1800);
}

export const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
