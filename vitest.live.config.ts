import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "vitest/config";

// Read .env, .env.local etc. the same way `pnpm dev` does, so keys such as
// SEC_USER_AGENT and MASSIVE_API_KEY reach the live checks. @next/env skips
// .env.local when NODE_ENV is "test" (as Vitest sets it), so load as
// development and then put NODE_ENV back.
const nodeEnv = process.env.NODE_ENV;
Object.assign(process.env, { NODE_ENV: "development" });
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
Object.assign(process.env, { NODE_ENV: nodeEnv });

/** Live checks against the real data sources: pnpm test:live */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["test/**/*.live.ts"],
    env: { STOCKWISE_FIXTURES: "" },
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
