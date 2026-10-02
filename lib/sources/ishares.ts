import Papa from "papaparse";
import { DAY, diskCached, HOUR } from "../cache";
import { fetchJson, fetchText } from "../http";
import { normaliseCountry } from "../identity";
import type { AssetClass, FundHoldings, Holding } from "../types";
import type { IsharesProduct } from "./registry";

type Region = "us" | "ca";

const SITES: Record<Region, { origin: string; productPath: string; screener: string }> = {
  us: {
    origin: "https://www.ishares.com",
    productPath: "/us/products",
    screener:
      "https://www.ishares.com/us/product-screener/product-screener-v3.1.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/us-ishares/ishares-product-screener-backend-config&siteEntryPassthrough=true",
  },
  ca: {
    origin: "https://www.blackrock.com",
    productPath: "/ca/investors/en/products",
    screener:
      "https://www.blackrock.com/ca/investors/en/product-screener/product-screener-v3.1.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/ca-one/product-screener-backend-config&siteEntryPassthrough=true",
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
  else if (ac === "fx" || ac.includes("future") || ac.includes("swap") || ac.includes("forward") || ac.includes("option"))
    cls = "derivative";
  else if (ac.includes("fixed income") || ac.includes("bond")) cls = "fixed_income";
  else if (ac.includes("fund") || ac === "etf") cls = "fund";
  else if (ac.includes("equity")) cls = "equity";

  const looksLikeFund = (ticker !== undefined && isKnownFund(ticker)) || (cls !== "cash" && FUND_NAME.test(name));
  if (looksLikeFund && cls !== "cash" && cls !== "derivative") cls = "fund";
  return { cls, isFund: cls === "fund" };
}

const isHeader = (r: string[]) => r[0] === "Ticker" || r[0] === "Issuer Ticker";

/** Reads one holdings table starting at its header row; stops at the first blank or short row. */
function parseTable(rows: string[][], headerIdx: number, isKnownFund: (t: string) => boolean): { holdings: Holding[]; end: number } {
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
  let i = headerIdx + 1;
  for (; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < header.length / 2 || !r[idx.name]) break;
    const weightPct = parseNumber(get(r, "weight"));
    if (weightPct === undefined) continue;
    const rowTicker = blankToUndefined(get(r, "ticker"));
    const rowName = get(r, "name")!;
    const { cls, isFund } = classify(get(r, "assetClass"), rowName, isKnownFund, rowTicker);
    holdings.push({
      ticker: rowTicker,
      tickerScheme: "blackrock",
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
  return { holdings: weightsFromMarketValue(holdings), end: i };
}

/**
 * The "Weight (%)" column is rounded to two decimals, so a fund's thousands of
 * smallest holdings read 0.00% and the total falls short by a percent or more.
 * Market values are exact, so each row's weight is its market value times the
 * fund's weight-per-dollar, measured on rows of at least 0.1% where rounding is
 * negligible. This also works on files that list only part of a fund.
 */
function weightsFromMarketValue(holdings: Holding[]): Holding[] {
  const big = holdings.filter((h) => Math.abs(h.weight) >= 0.001 && (h.marketValue ?? 0) > 0);
  const value = big.reduce((s, h) => s + h.marketValue!, 0);
  const weight = big.reduce((s, h) => s + h.weight, 0);
  if (!(value > 0) || !(weight > 0)) return holdings;
  const perDollar = weight / value;
  return holdings.map((h) => (h.marketValue === undefined ? h : { ...h, weight: h.marketValue * perDollar }));
}


/**
 * Parses an iShares (US) or BlackRock Canada holdings CSV: optional fund-name
 * and metadata rows, a header row starting with "Ticker", the holdings, then
 * legal boilerplate. BlackRock Canada files for funds of funds add a second
 * table with the issuer's own look-through, returned as `issuerLookThrough`.
 */
export function parseIsharesCsv(
  csv: string,
  ticker: string,
  region: Region,
  isKnownFund: (ticker: string) => boolean = () => false,
): FundHoldings {
  const { data } = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), { skipEmptyLines: false });
  const rows = data.map((r) => r.map((c) => (c ?? "").replace(/^\uFEFF/, "").trim()));

  const headerIdx = rows.findIndex(isHeader);
  if (headerIdx < 0) throw new Error("No holdings table found in iShares file");

  let asOf: string | undefined;
  for (const r of rows.slice(0, headerIdx)) {
    if (/holdings as of/i.test(r[0] ?? "")) asOf = parseIsharesDate(r[1] ?? "");
  }
  // US files open with the fund name; Canadian files go straight to "Fund Holdings as of".
  const name = rows[0]?.[0] && !/as of/i.test(rows[0][0]) ? rows[0][0] : ticker;

  const { holdings, end } = parseTable(rows, headerIdx, isKnownFund);
  if (holdings.length === 0) throw new Error("iShares file contained no holdings");

  const nextHeader = rows.findIndex((r, i) => i > end && isHeader(r));
  const issuerLookThrough = nextHeader > 0 ? parseTable(rows, nextHeader, () => false).holdings : undefined;

  return {
    ticker,
    name,
    asOf: asOf ?? new Date().toISOString().slice(0, 10),
    currency: region === "ca" ? "CAD" : "USD",
    source: region === "ca" ? "ishares-ca" : "ishares-us",
    holdings,
    ...(issuerLookThrough?.length ? { issuerLookThrough } : {}),
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
      const name = typeof obj.fundName === "string" ? obj.fundName : undefined;
      if (m) return { productId: m[1], slug: m[2], name };
    }
    stack.push(...Object.values(obj));
  }
  return undefined;
}

export async function discoverIshares(region: Region, ticker: string): Promise<IsharesProduct> {
  const feed = await diskCached(`ishares-screener:${region}`, DAY, () => fetchJson<unknown>(SITES[region].screener));
  const product = findInScreener(feed, ticker);
  if (!product) throw new Error(`${ticker} is not in the iShares ${region.toUpperCase()} product list`);
  return product;
}

/** Both sites ignore the slug segment, but it must be present. */
export function holdingsUrl(region: Region, ticker: string, p: IsharesProduct): string {
  const s = SITES[region];
  const base = `${s.origin}${s.productPath}/${p.productId}/${p.slug || "fund"}`;
  return region === "us"
    ? `${base}/latest-holdings.csv`
    : `${base}/1464253357814.ajax?fileType=csv&fileName=${ticker}_holdings&dataType=fund`;
}

export function fetchIsharesHoldings(
  region: Region,
  ticker: string,
  known: IsharesProduct | undefined,
  isKnownFund: (ticker: string) => boolean,
): Promise<FundHoldings> {
  return diskCached(`ishares:${region}:${ticker}`, 12 * HOUR, async () => {
    const attempt = async (p: IsharesProduct) => {
      const fund = parseIsharesCsv(await fetchText(holdingsUrl(region, ticker, p)), ticker, region, isKnownFund);
      return fund.name === ticker && p.name ? { ...fund, name: p.name } : fund;
    };
    if (known) {
      try {
        return await attempt(known);
      } catch {
        // Product IDs occasionally move; fall through to discovery.
      }
    }
    return attempt(await discoverIshares(region, ticker));
  });
}
