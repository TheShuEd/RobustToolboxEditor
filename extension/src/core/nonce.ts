const NONCE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a random nonce for a webview Content-Security-Policy.
 *
 * Follows the convention used across the VS Code webview samples: a 32-character
 * alphanumeric string, regenerated on every `resolveWebviewView` so the CSP can
 * authorise exactly one `<script>` tag without allowing inline script in general.
 */
export function generateNonce(length = 32): string {
  let nonce = '';
  for (let i = 0; i < length; i++) {
    nonce += NONCE_ALPHABET.charAt(Math.floor(Math.random() * NONCE_ALPHABET.length));
  }
  return nonce;
}
