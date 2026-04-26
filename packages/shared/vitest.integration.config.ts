import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    exclude: ["dist/**"],
    globalSetup: ["src/test-utils/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Run test files sequentially to avoid cross-file table truncation conflicts
    fileParallelism: false,
    // Required: globalSetup runs in the parent process and cannot propagate
    // env vars to worker processes. This env block sets DATABASE_URL in
    // the test workers so connection.ts picks up the test DB at import time.
    env: {
      DATABASE_URL: `postgres://${process.env.POSTGRES_USER ?? "ironclaw"}:${process.env.POSTGRES_PASSWORD ?? "dev_password"}@${process.env.POSTGRES_HOST ?? "localhost"}:${process.env.POSTGRES_PORT ?? "5433"}/ironclaw_test`,
    },
  },
});
