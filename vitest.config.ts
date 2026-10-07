import { defineConfig } from 'vitest/config';

/* Unit tests (the resize engine). Runs in Node: the engine has no DOM dependency. */
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
