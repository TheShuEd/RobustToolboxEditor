export interface WebviewHtmlOptions {
  /** Webview-safe URI of the bundled ESM entry (`webview.asWebviewUri(...)`). */
  scriptUri: string;
  /** The webview's CSP source token (`webview.cspSource`). */
  cspSource: string;
  /** Per-load nonce authorising the single script tag. */
  nonce: string;
}

/**
 * Build the full HTML document for the inspector webview.
 *
 * Structural guarantees the predecessor lacked (spec #20, ADR-0002):
 *   - exactly one `<script>` tag, `type="module"`, no inline script;
 *   - a strict nonce-based CSP with `default-src 'none'`;
 *   - styles limited to the webview's own resource origin.
 */
export function renderWebviewHtml({ scriptUri, cspSource, nonce }: WebviewHtmlOptions): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} https: data:`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SS14 Inspector</title>
</head>
<body>
  <main id="app">SS14 Prototype Editor — extension active.</main>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}
