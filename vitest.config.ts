import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { include: ["test/**/*.test.ts"], env: { STOCKWISE_FIXTURES: "1" } },
});
