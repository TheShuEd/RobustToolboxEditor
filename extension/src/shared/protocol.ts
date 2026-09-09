/**
 * Typed host <-> webview message protocol.
 *
 * Issue #21 shipped the handshake; issue #23 adds the fork-status push. Later
 * tickets extend these unions with the inspector model and field-edit intents
 * (`{ path, value, range }`). Both sides `switch` on `type`; payloads are never
 * untyped `postMessage` blobs (spec #20).
 */

import type { ForkStatus } from '../core';

export interface HelloMessage {
  type: 'hello';
  extensionVersion: string;
}

export interface ReadyMessage {
  type: 'ready';
}

/** The workspace folder that was checked, plus the verdict for it. */
export interface ForkFolderStatus {
  name: string;
  status: ForkStatus;
}

/**
 * The host's current read of the workspace fork. `folder` is `null` when no
 * local folder is open. Re-sent on folder changes, on DLL changes, and whenever
 * the view becomes visible again (the webview is torn down while hidden).
 */
export interface ForkStatusMessage {
  type: 'forkStatus';
  folder: ForkFolderStatus | null;
}

/** Messages the host sends to the webview. */
export type HostToWebview = HelloMessage | ForkStatusMessage;

/** Messages the webview sends to the host. */
export type WebviewToHost = ReadyMessage;
