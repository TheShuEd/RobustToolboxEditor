import * as vscode from 'vscode';

import { generateNonce, renderWebviewHtml } from '../core';
import type { WebviewToHost } from '../shared/protocol';

export const INSPECTOR_VIEW_ID = 'ss14editor.inspector';

/**
 * Sidebar webview view for the prototype inspector.
 *
 * Issue #21 ships only the shell: it proves the webview bundle loads as a single
 * ESM script tag under a strict CSP, and that the typed handshake round-trips.
 * Real inspector behaviour (cards, tree, widgets) arrives in later tickets.
 */
export class InspectorViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionVersion: string,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [distUri],
    };

    const scriptUri = webviewView.webview
      .asWebviewUri(vscode.Uri.joinPath(distUri, 'webview', 'main.js'))
      .toString();

    webviewView.webview.html = renderWebviewHtml({
      scriptUri,
      cspSource: webviewView.webview.cspSource,
      nonce: generateNonce(),
    });

    webviewView.webview.onDidReceiveMessage((message: WebviewToHost) => {
      if (message.type === 'ready') {
        void webviewView.webview.postMessage({
          type: 'hello',
          extensionVersion: this.extensionVersion,
        });
      }
    });
  }
}
