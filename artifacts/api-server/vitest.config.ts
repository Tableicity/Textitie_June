import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Integration tests share a single Postgres connection pool, so run files
    // serially to keep DB state assertions deterministic.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
