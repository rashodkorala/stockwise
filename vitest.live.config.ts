import path from "node:path";
import { defineConfig } from "vitest/config";

/** Live checks against the real data sources: npm run test:live */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["test/**/*.live.ts"],
    env: { STOCKWISE_FIXTURES: "" },
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
