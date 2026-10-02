import Papa from "papaparse";
import { cached, DAY, HOUR } from "../cache";
import { fetchJson, fetchText } from "../http";
import { normaliseCountry } from "../identity";
import type { AssetClass, FundHoldings, Holding } from "../types";
import type { IsharesProduct } from "./registry";

type Region = "us" | "ca";

const SITES: Record<Region, { origin: string; productPath: string; ajax: string; screener: string }> = {
  us: {
    origin: "https://www.ishares.com",
    productPath: "/us/products",
    ajax: "1467271812596.ajax",
    screener:
      "https://www.ishares.com/us/product-screener/product-screener-v3.1.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/us-ishares/ishares-product-screener-backend-config&siteEntryPassthrough=true",
  },
  ca: {
    origin: "https://www.blackrock.com",
    productPath: "/ca/investors/en/products",
    ajax: "1464253357814.ajax",
    screener:
      "https://www.blackrock.com/ca/investors/en/product-screener/product-screener-v3.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/ca/product-screener-backend-config&siteEntryPassthrough=true",
  },
};

const COLUMN_ALIASES: Record<string, string[]> = {
  ticker: ["Ticker", "Issuer Ticker"],
  name: ["Name", "Security Name"],
  sector: ["Sector"],
  assetClass: ["Asset Class"],
  marketValue: ["Market Value"],
  weight: ["Weight (%)", "Weight", "% of Net Assets"],
  location: ["Location", "Location of Risk"],
  currency: ["Market Currency", "Currency"],
  isin: ["ISIN"],
  cusip: ["CUSIP"],
};

function parseNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const cleaned = v.replace(/[,%\s]/g, "");
  if (!cleaned || cleaned === "-") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function blankToUndefined(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && t !== "-" ? t : undefined;
}

/** "Sep 30, 2026" or "30-Sep-2026" to "2026-09-30". */
export function parseIsharesDate(v: string): string | undefined {
  const d = new Date(v.replace(/-/g, " "));
  if (Number.isNaN(d.getTime())) return undefined;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

const FUND_NAME = /\b(ETF|ISHARES|INDEX FUND|PORTFOLIO)\b/i;

function classify(assetClass: string | undefined, name: string, isKnownFund: (t: string) => boolean, ticker?: string) {
  const ac = (assetClass ?? "").toLowerCase();
  let cls: AssetClass = "other";
  if (ac.includes("money market") || ac.includes("cash")) cls = "cash";
  else if (ac.includes("future") || ac.includes("swap") || ac.includes("forward") || ac.includes("option"))
    cls = "derivative";
  else if (ac.includes("fixed income") || ac.includes("bond")) cls = "fixed_income";
  else if (ac.includes("fund") || ac === "etf") cls = "fund";
  else if (ac.includes("equity")) cls = "equity";

  const looksLikeFund = (ticker !== undefined && isKnownFund(ticker)) || (cls !== "cash" && FUND_NAME.test(name));
  if (looksLikeFund && cls !== "cash" && cls !== "derivative") cls = "fund";
  return { cls, isFund: cls === "fund" };
}

/**
 * Parses an iShares (US) or BlackRock Canada holdings CSV: a few metadata rows,
 * a header row starting with "Ticker", the holdings, then legal boilerplate.
 */
export function parseIsharesCsv(
  csv: string,
  ticker: string,
  region: Region,
  isKnownFund: (ticker: string) => boolean = () => false,
): FundHoldings {
  const { data } = Papa.parse<string[]>(csv.replace(/^﻿/, ""), { skipEmptyLines: false });
  const rows = data.map((r) => r.map((c) => (c ?? "").trim()));

  const headerIdx = rows.findIndex((r) => r[0] === "Ticker" || r[0] === "Issuer Ticker" || r.includes("Weight (%)"));
  if (headerIdx < 0) throw new Error("No holdings table found in iShares file");

  let asOf: string | undefined;
  for (const r of rows.slice(0, headerIdx)) {
    if (/holdings as of/i.test(r[0] ?? "")) asOf = parseIsharesDate(r[1] ?? "");
  }
  const name = rows[0]?.[0] && !/as of/i.test(rows[0][0]) ? rows[0][0] : ticker;

  const header = rows[headerIdx];
  const col = (field: string) => {
    for (const alias of COLUMN_ALIASES[field]) {
      const i = header.indexOf(alias);
      if (i >= 0) return i;
    }
    return -1;
  };
  const idx = Object.fromEntries(Object.keys(COLUMN_ALIASES).map((f) => [f, col(f)])) as Record<string, number>;
  if (idx.name < 0 || idx.weight < 0) throw new Error("iShares file is missing Name or Weight columns");
  const get = (r: string[], field: string) => (idx[field] >= 0 ? r[idx[field]] : undefined);

  const holdings: Holding[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    if (r.length < header.length / 2 || !r[idx.name]) break;
    const weightPct = parseNumber(get(r, "weight"));
    if (weightPct === undefined) continue;
    const rowTicker = blankToUndefined(get(r, "ticker"));
    const rowName = get(r, "name")!;
    const { cls, isFund } = classify(get(r, "assetClass"), rowName, isKnownFund, rowTicker);
    holdings.push({
      ticker: rowTicker,
      name: rowName,
      isin: blankToUndefined(get(r, "isin")),
      cusip: blankToUndefined(get(r, "cusip")),
      country: normaliseCountry(get(r, "location")),
      sector: blankToUndefined(get(r, "sector")),
      assetClass: cls,
      weight: weightPct / 100,
      marketValue: parseNumber(get(r, "marketValue")),
      isFund,
    });
  }
  if (holdings.length === 0) throw new Error("iShares file contained no holdings");

  return {
    ticker,
    name,
    asOf: asOf ?? new Date().toISOString().slice(0, 10),
    currency: region === "ca" ? "CAD" : "USD",
    source: region === "ca" ? "ishares-ca" : "ishares-us",
    holdings,
  };
}

/**
 * Finds a product in the iShares screener feed by walking it for any object
 * that names the ticker and a product page. Tolerates both the keyed-object and
 * array layouts the screener has used.
 */
export function findInScreener(feed: unknown, ticker: string): IsharesProduct | undefined {
  const want = ticker.toUpperCase();
  const stack: unknown[] = [feed];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    const obj = node as Record<string, unknown>;
    const t = obj.localExchangeTicker ?? obj.ticker ?? obj.fundTicker;
    const page = obj.productPageUrl ?? obj.productUrl;
    if (typeof t === "string" && t.toUpperCase() === want && typeof page === "string") {
      const m = page.match(/\/products\/(\d+)\/([^/?#]+)/);
      if (m) return { productId: m[1], slug: m[2] };
    }
    stack.push(...Object.values(obj));
  }
  return undefined;
}

async function discover(region: Region, ticker: string): Promise<IsharesProduct> {
  const feed = await cached(`ishares-screener:${region}`, DAY, () => fetchJson<unknown>(SITES[region].screener));
  const product = findInScreener(feed, ticker);
  if (!product) throw new Error(`${ticker} is not in the iShares ${region.toUpperCase()} product list`);
  return product;
}

function holdingsUrl(region: Region, ticker: string, p: IsharesProduct): string {
  const s = SITES[region];
  return `${s.origin}${s.productPath}/${p.productId}/${p.slug}/${s.ajax}?fileType=csv&fileName=${ticker}_holdings&dataType=fund`;
}

export function fetchIsharesHoldings(
  region: Region,
  ticker: string,
  known: IsharesProduct | undefined,
  isKnownFund: (ticker: string) => boolean,
): Promise<FundHoldings> {
  return cached(`ishares:${region}:${ticker}`, 12 * HOUR, async () => {
    const attempt = async (p: IsharesProduct) =>
      parseIsharesCsv(await fetchText(holdingsUrl(region, ticker, p)), ticker, region, isKnownFund);
    if (known) {
      try {
        return await attempt(known);
      } catch {
        // Product IDs occasionally move; fall through to discovery.
      }
    }
    return attempt(await discover(region, ticker));
  });
}
