import * as vscode from 'vscode';

import { QUALIFIED_EXTENSION_ID } from '../core';
import { ForkStatusController } from './fork-status-controller';
import { INSPECTOR_VIEW_ID, InspectorViewProvider } from './inspector-view';
import { SchemaController } from './schema-controller';
import { TextProviderController } from './text-providers';

export const REBUILD_SCHEMA_COMMAND = 'ss14editor.rebuildSchema';

export function activate(context: vscode.ExtensionContext): void {
  const manifest = vscode.extensions.getExtension(QUALIFIED_EXTENSION_ID)?.packageJSON as
    | { version?: string }
    | undefined;
  const version = manifest?.version ?? '0.0.0';

  const forkStatus = new ForkStatusController();
  const schema = new SchemaController(context, forkStatus);
  const textProviders = new TextProviderController(forkStatus, schema);

  context.subscriptions.push(
    forkStatus,
    schema,
    textProviders,
    vscode.commands.registerCommand(REBUILD_SCHEMA_COMMAND, () => schema.rebuild()),
    vscode.window.registerWebviewViewProvider(
      INSPECTOR_VIEW_ID,
      new InspectorViewProvider(context.extensionUri, version, forkStatus, schema),
    ),
  );

  console.log(`SS14 Prototype Editor v${version} activated.`);
}

export function deactivate(): void {
  // No teardown needed: every disposable is registered on context.subscriptions.
}
