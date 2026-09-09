/**
 * Typed host <-> webview message protocol.
 *
 * Issue #21 ships only the handshake. Later tickets extend these unions with the
 * inspector model, field-edit intents (`{ path, value, range }`), and
 * "not synchronised" signals. Both sides `switch` on `type`; payloads are never
 * untyped `postMessage` blobs (spec #20).
 */

export interface HelloMessage {
  type: 'hello';
  extensionVersion: string;
}

export interface ReadyMessage {
  type: 'ready';
}

/** Messages the host sends to the webview. */
export type HostToWebview = HelloMessage;

/** Messages the webview sends to the host. */
export type WebviewToHost = ReadyMessage;
