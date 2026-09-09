/**
 * Pure TypeScript core — the single test seam (spec #20, "Testing Decisions").
 *
 * Nothing in this directory may import `vscode`, the host adapter, or the webview
 * bundle. It takes plain data in and returns plain data out, so it can be tested
 * without launching VS Code. The eslint config enforces the import boundary.
 */

export const EXTENSION_ID = 'ss14editor';
export const PUBLISHER = 'crystallpunk-14';

/** Fully-qualified extension identifier as VS Code reports it. */
export const QUALIFIED_EXTENSION_ID = `${PUBLISHER}.${EXTENSION_ID}`;

export { generateNonce } from './nonce';
export { renderWebviewHtml } from './webview-html';
export type { WebviewHtmlOptions } from './webview-html';
