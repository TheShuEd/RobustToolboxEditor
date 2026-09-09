import type { ForkFolderStatus } from '../shared/protocol';

/**
 * The webview's whole state and its renderer.
 *
 * Issue #23 keeps this deliberately small: one plain object, one pure
 * `render(root, state)`. It exists now so the inspector ticket extends a real
 * store instead of inventing one — and so there is never an ambient mutable
 * `window.state` like the predecessor had. The CSP forbids inline styles, so the
 * panel is plain themed text.
 */
export interface ViewState {
  extensionVersion: string | undefined;
  /** `null` until the host's first push, or when no local folder is open. */
  folder: ForkFolderStatus | null;
}

export const initialState: ViewState = {
  extensionVersion: undefined,
  folder: null,
};

export function render(root: HTMLElement, state: ViewState): void {
  root.textContent = statusText(state.folder);
}

function statusText(folder: ForkFolderStatus | null): string {
  if (folder === null) return 'Open an SS14 fork folder to get started.';
  if (folder.status.recognized) return '✓ SS14 fork recognized.';
  return folder.status.message;
}
