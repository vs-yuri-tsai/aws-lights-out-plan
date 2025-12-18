import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": "./src",
      "@core": "./src/core",
      "@handlers": "./src/handlers",
      "@discovery": "./src/discovery",
      "@utils": "./src/utils",
    },
  },
});
