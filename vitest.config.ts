import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Integration tests hit a live dev server; give them room.
    testTimeout: 30000,
    // Each on-chain test file needs its own ganache instance; avoid cross-file
    // port/provider contention by not parallelizing across files.
    fileParallelism: false,
  },
});
