import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Core tests only: fast, no VS Code, no Electron download.
    // The activation smoke test under test/smoke/ runs via `@vscode/test-electron`.
    include: ['test/core/**/*.test.ts'],
  },
});
