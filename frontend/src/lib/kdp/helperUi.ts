/** Whether the visible iPhone KDP helper screen is focused. */

type FocusListener = (focused: boolean) => void;

let focused = false;
const listeners = new Set<FocusListener>();

export function isKdpHelperScreenFocused(): boolean {
  return focused;
}

export function setKdpHelperScreenFocused(next: boolean): void {
  if (focused === next) return;
  focused = next;
  for (const listener of listeners) {
    try {
      listener(focused);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeKdpHelperScreenFocused(listener: FocusListener): () => void {
  listeners.add(listener);
  listener(focused);
  return () => {
    listeners.delete(listener);
  };
}
