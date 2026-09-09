import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/**
 * Three independent bundles (issue #21):
 *   - host    : the thin VS Code adapter + pure core, CommonJS for the Extension Host
 *   - webview : the sidebar inspector UI, ESM, loaded from a single <script type="module">
 *   - smoke   : the `@vscode/test-electron` activation test, compiled so the test CLI can run it
 *
 * The `dotnet publish` step for the C# schema extractor will slot in ahead of this
 * script (copying its output into `assets/`); nothing here depends on it yet.
 */

/** @type {import('esbuild').BuildOptions} */
const hostConfig = {
  entryPoints: ['src/host/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node14',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  outfile: 'dist/webview/main.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const smokeConfig = {
  entryPoints: ['test/smoke/activation.test.ts'],
  outdir: 'out/test/smoke',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node14',
  external: ['vscode', 'mocha'],
  sourcemap: true,
  logLevel: 'info',
};

const configs = [hostConfig, webviewConfig, smokeConfig];

if (watch) {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('esbuild: watching host, webview, smoke bundles...');
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
