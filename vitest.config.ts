import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The CLI tests spawn a real child process and build first, so they need
    // more headroom than a pure unit test.
    testTimeout: 30_000,
  },
});
