import { defineConfig } from "vitest/config";

export default defineConfig({
  mode: "node",
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    root: "."
  },
  resolve: {
    extensions: [".ts", ".js"]
  }
});
