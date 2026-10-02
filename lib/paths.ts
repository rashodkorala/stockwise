import path from "node:path";

/** Where the local app keeps its saved portfolio and fund cache. */
export function dataDir(): string {
  return path.resolve(process.env.STOCKWISE_DATA_DIR || path.join(process.cwd(), "data"));
}
