import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Many tests load the whole game data; on a busy machine 5 s isn't always enough.
    testTimeout: 20000,
  },
});
