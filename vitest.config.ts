import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Hardhat owns test/*.test.ts at the top level; vitest owns the agent
    // suite. Keeping them in separate directories avoids two runners fighting
    // over the same files.
    include: ['test/agent/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
