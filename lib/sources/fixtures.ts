import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FundHoldings } from "../types";
import { parseNportXml } from "./edgarNport";
import { parseIsharesCsv } from "./ishares";

const DIR = path.join(process.cwd(), "fixtures", "holdings");

/** Sample-data mode (STOCKWISE_FIXTURES=1) for demos, tests, and offline development. */
export function fixturesEnabled(): boolean {
  return process.env.STOCKWISE_FIXTURES === "1";
}

export async function loadFixtureHoldings(
  ticker: string,
  country: "US" | "CA",
  isKnownFund: (t: string) => boolean,
): Promise<FundHoldings> {
  const t = ticker.toUpperCase();
  const tryRead = (file: string) => readFile(path.join(DIR, file), "utf8").catch(() => undefined);

  const csv = await tryRead(`${t}.csv`);
  if (csv) {
    const region = country === "CA" ? "ca" : "us";
    return { ...parseIsharesCsv(csv, t, region, isKnownFund), source: "sample" };
  }
  const doc = await tryRead(`${t}.xml`);
  if (doc) return { ...parseNportXml(doc, t), source: "sample" };
  throw new Error(`No sample data for ${t}`);
}
