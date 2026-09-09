import type { HostToWebview, WebviewToHost } from '../shared/protocol';

interface VsCodeApi {
  postMessage(message: WebviewToHost): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case 'hello': {
      const app = document.getElementById('app');
      if (app) {
        app.textContent = `SS14 Prototype Editor v${message.extensionVersion} — inspector ready.`;
      }
      break;
    }
  }
});

// Announce readiness so the host replies with the current state.
vscode.postMessage({ type: 'ready' });
