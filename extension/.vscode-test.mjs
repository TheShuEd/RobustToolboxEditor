import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  label: 'smoke',
  files: 'out/test/smoke/**/*.test.js',
  version: 'stable',
  mocha: {
    ui: 'tdd',
    timeout: 60000,
  },
});
