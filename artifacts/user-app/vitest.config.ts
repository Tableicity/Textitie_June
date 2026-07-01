import { defineConfig } from "vitest/config";

// Lightweight vitest setup for pure-logic unit tests only (node env, no DOM
// harness). Front-end components in this repo are not otherwise unit-tested; the
// escalation thresholds in trialBanner.logic are extracted so they can be.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
