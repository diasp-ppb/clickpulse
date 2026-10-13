import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["packages/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/tracker/src/**/*.ts", "packages/edge-worker/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/dist/**",
        "**/node_modules/**",
        "packages/sync-cli/**"
      ]
    }
  }
});
