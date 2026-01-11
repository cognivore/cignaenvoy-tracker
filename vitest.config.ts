import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
    hookTimeout: 10000,
    // E2E tests need longer timeouts - configure per-file via vitest.setTimeout
  },
});
