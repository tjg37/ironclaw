import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "src/**/*.integration.test.ts"],
    passWithNoTests: true,
  },
});
