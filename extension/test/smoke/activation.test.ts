import * as assert from 'node:assert';

import * as vscode from 'vscode';

import { INSPECTOR_VIEW_ID, QUALIFIED_EXTENSION_ID } from '../../src/core';

suite('activation smoke', () => {
  test('the extension is installed in the test host', () => {
    assert.ok(
      vscode.extensions.getExtension(QUALIFIED_EXTENSION_ID),
      `extension ${QUALIFIED_EXTENSION_ID} not found`,
    );
  });

  test('the extension activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(QUALIFIED_EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('the inspector webview view is contributed', () => {
    const ext = vscode.extensions.getExtension(QUALIFIED_EXTENSION_ID);
    const views = (ext?.packageJSON?.contributes?.views ?? {}) as Record<
      string,
      Array<{ id: string; type?: string }>
    >;
    const contributed = Object.values(views).flat();
    const inspector = contributed.find((v) => v.id === INSPECTOR_VIEW_ID);
    assert.ok(inspector, `${INSPECTOR_VIEW_ID} view is not contributed`);
    assert.strictEqual(inspector.type, 'webview');
  });
});
