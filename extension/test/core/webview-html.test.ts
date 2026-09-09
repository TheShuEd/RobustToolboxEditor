import { describe, expect, it } from 'vitest';

import { renderWebviewHtml } from '../../src/core/webview-html';

const options = {
  scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/main.js',
  cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
  nonce: 'abc123ABC456def789ghi012jkl345mn',
};

describe('renderWebviewHtml', () => {
  it('loads the bundle from exactly one script tag', () => {
    const html = renderWebviewHtml(options);
    const scriptTags = html.match(/<script\b/g) ?? [];
    expect(scriptTags).toHaveLength(1);
  });

  it('loads the bundle as an ES module', () => {
    expect(renderWebviewHtml(options)).toContain(
      `<script type="module" nonce="${options.nonce}" src="${options.scriptUri}"></script>`,
    );
  });

  it('locks the CSP down to none by default', () => {
    expect(renderWebviewHtml(options)).toContain("default-src 'none'");
  });

  it('only permits the nonce-tagged script, never inline script', () => {
    const html = renderWebviewHtml(options);
    expect(html).toContain(`script-src 'nonce-${options.nonce}'`);
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain("script-src 'self'");
  });

  it('scopes styles to the webview resource origin', () => {
    expect(renderWebviewHtml(options)).toContain(`style-src ${options.cspSource}`);
  });

  it('is a complete HTML document', () => {
    const html = renderWebviewHtml(options);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
  });
});
