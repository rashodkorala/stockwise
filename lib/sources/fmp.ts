import { diskCached, HOUR } from "../cache";
import { fetchJson } from "../http";
import type { FundHoldings, Holding } from "../types";

const BASE = "https://financialmodelingprep.com/stable";

export function fmpEnabled(): boolean {
  return Boolean(process.env.FMP_API_KEY);
}

interface FmpHolding {
  asset?: string;
  name?: string;
  isin?: string;
  securityCusip?: string;
  cusip?: string;
  weightPercentage?: number;
  marketValue?: number;
  updatedAt?: string;
  updated?: string;
}

/** FMP lists Canadian listings with a ".TO" suffix. */
export function fmpSymbol(ticker: string, country?: string): string {
  return country === "CA" ? `${ticker}.TO` : ticker;
}

export function mapFmpHoldings(rows: FmpHolding[], ticker: string, isKnownFund: (t: string) => boolean): FundHoldings {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`FMP has no holdings for ${ticker}`);
  const holdings: Holding[] = rows.map((r) => {
    const t = r.asset?.replace(/\.(TO|V|NE)$/, "");
    const isFund = t ? isKnownFund(t) || /\bETF\b/i.test(r.name ?? "") : false;
    return {
      ticker: t,
      name: r.name ?? t ?? "Unknown",
      isin: r.isin || undefined,
      cusip: r.securityCusip || r.cusip || undefined,
      assetClass: isFund ? "fund" : "equity",
      weight: (r.weightPercentage ?? 0) / 100,
      marketValue: r.marketValue,
      isFund,
    };
  });
  const asOf = (rows[0].updatedAt ?? rows[0].updated ?? "").slice(0, 10);
  return { ticker, name: ticker, asOf, source: "fmp", holdings };
}

export function fetchFmpHoldings(
  ticker: string,
  country: string | undefined,
  isKnownFund: (t: string) => boolean,
): Promise<FundHoldings> {
  return diskCached(`fmp:${ticker}:${country ?? ""}`, 12 * HOUR, async () => {
    const symbol = fmpSymbol(ticker, country);
    const rows = await fetchJson<FmpHolding[]>(
      `${BASE}/etf/holdings?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.FMP_API_KEY}`,
    );
    return mapFmpHoldings(rows, ticker, isKnownFund);
  });
}
