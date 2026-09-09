import * as vscode from 'vscode';

import { QUALIFIED_EXTENSION_ID } from '../core';
import { INSPECTOR_VIEW_ID, InspectorViewProvider } from './inspector-view';

export function activate(context: vscode.ExtensionContext): void {
  const manifest = vscode.extensions.getExtension(QUALIFIED_EXTENSION_ID)?.packageJSON as
    | { version?: string }
    | undefined;
  const version = manifest?.version ?? '0.0.0';

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      INSPECTOR_VIEW_ID,
      new InspectorViewProvider(context.extensionUri, version),
    ),
  );

  console.log(`SS14 Prototype Editor v${version} activated.`);
}

export function deactivate(): void {
  // No teardown needed: every disposable is registered on context.subscriptions.
}
