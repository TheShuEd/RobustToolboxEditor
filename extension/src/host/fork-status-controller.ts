import * as vscode from 'vscode';

import { detectFork } from '../core';
import type { ForkFolderStatus, ForkStatusMessage } from '../shared/protocol';
import { createForkFs } from './fork-fs';

const REFRESH_DEBOUNCE_MS = 300;

/**
 * Owns the fork-detection verdict and keeps the inspector webview in sync with
 * it (issue #23).
 *
 * The panel is a persistent `WebviewView`, so the webview document is destroyed
 * whenever the view is hidden and rebuilt when shown; the controller re-pushes
 * on `onDidChangeVisibility`. It also re-runs detection when the workspace
 * folders change or the built DLLs change on disk, so a "build is stale" verdict
 * clears after a rebuild without a window reload (spec #20, "Инвалидация").
 */
export class ForkStatusController implements vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private viewBinding: vscode.Disposable | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    const dllWatcher = vscode.workspace.createFileSystemWatcher(
      '**/bin/Content.{Server,Client}/*.dll',
    );
    const bump = () => this.scheduleRefresh();
    dllWatcher.onDidCreate(bump, undefined, this.disposables);
    dllWatcher.onDidChange(bump, undefined, this.disposables);
    dllWatcher.onDidDelete(bump, undefined, this.disposables);

    this.disposables.push(
      dllWatcher,
      vscode.workspace.onDidChangeWorkspaceFolders(bump),
    );
  }

  /**
   * Attach the live webview view and push the current verdict immediately.
   * Safe to call again when the view is re-resolved after being hidden — the
   * previous visibility subscription is replaced, not stacked.
   */
  bind(view: vscode.WebviewView): void {
    this.view = view;
    this.viewBinding?.dispose();
    this.viewBinding = view.onDidChangeVisibility(() => {
      if (view.visible) this.publish();
    });
    this.publish();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.publish(), REFRESH_DEBOUNCE_MS);
  }

  private publish(): void {
    const message: ForkStatusMessage = { type: 'forkStatus', folder: this.detect() };
    void this.view?.webview.postMessage(message);
  }

  /**
   * The verdict for the first local workspace folder, which must itself be the
   * fork root. Multi-root and nested forks are out of scope (spec #20).
   */
  private detect(): ForkFolderStatus | null {
    const folder = (vscode.workspace.workspaceFolders ?? []).find(
      (candidate) => candidate.uri.scheme === 'file',
    );
    if (!folder) return null;
    return { name: folder.name, status: detectFork(createForkFs(folder.uri.fsPath)) };
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.viewBinding?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
