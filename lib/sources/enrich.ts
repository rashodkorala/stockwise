import { cached, HOUR } from "../cache";
import { resolveEntities } from "../identity";
import type { FundHoldings, Holding, HoldingsResult } from "../types";

/**
 * Broad iShares funds whose rows carry tickers and GICS sectors, used to fill
 * those gaps in SEC N-PORT filings (which have neither). US rows draw on ITOT;
 * everything else on the developed and emerging markets funds.
 */
const US_REFERENCE = ["ITOT"];
const INTL_REFERENCE = ["IEFA", "IEMG"];
/** Only bother when the rows missing a sector add up to more than this. */
const MIN_GAP = 0.005;

const needsHelp = (h: Holding) => h.assetClass === "equity" && (!h.ticker || !h.sector);

/**
 * Copies ticker and sector onto rows that lack them, from the reference row
 * that resolves to the same security. A copied ticker keeps the reference's
 * ticker scheme, so it is never mistaken for one the filing itself reported.
 */
export function enrichHoldings(holdings: Holding[], reference: Holding[]): Holding[] {
  const targets = holdings.map((h, i) => [h, i] as const).filter(([h]) => needsHelp(h));
  if (targets.length === 0 || reference.length === 0) return holdings;
  const groups = resolveEntities([...targets.map(([h]) => h), ...reference]);
  const refByGroup = new Map<number, Holding>();
  reference.forEach((r, j) => {
    const g = groups[targets.length + j];
    if (!refByGroup.has(g) && (r.ticker || r.sector)) refByGroup.set(g, r);
  });
  const out = [...holdings];
  targets.forEach(([h, i], k) => {
    const ref = refByGroup.get(groups[k]);
    if (!ref) return;
    out[i] = {
      ...h,
      ticker: h.ticker ?? ref.ticker,
      tickerScheme: h.ticker ? h.tickerScheme : ref.tickerScheme,
      sector: h.sector ?? ref.sector,
    };
  });
  return out;
}

type Loader = (symbol: string) => Promise<HoldingsResult>;

async function referenceRows(tickers: string[], self: string, load: Loader): Promise<Holding[]> {
  const results = await Promise.all(tickers.filter((t) => t !== self).map((t) => load(t)));
  return results.flatMap((r) => (r.ok ? r.fund.holdings.filter((h) => h.assetClass === "equity") : []));
}

/** Wraps a loader so funds missing tickers or sectors (SEC filings) get them filled in where possible. */
export function withEnrichment(load: Loader): Loader {
  return async (symbol) => {
    const result = await load(symbol);
    // Failures pass straight through, uncached, so a transient error is retried next time.
    if (!result.ok) return result;
    const fund: FundHoldings = result.fund;
    // Decided by the rows, not the source: in practice only N-PORT filings have the gap.
    const gap = (us: boolean) =>
      fund.holdings.filter((h) => needsHelp(h) && (h.country === "US") === us).reduce((s, h) => s + Math.abs(h.weight), 0);
    if (gap(true) <= MIN_GAP && gap(false) <= MIN_GAP) return result;
    const holdings = await cached(`enriched:${fund.source}:${fund.ticker}:${fund.asOf}`, HOUR, async () => {
      const reference = [
        ...(gap(true) > MIN_GAP ? await referenceRows(US_REFERENCE, fund.ticker, load) : []),
        ...(gap(false) > MIN_GAP ? await referenceRows(INTL_REFERENCE, fund.ticker, load) : []),
      ];
      return enrichHoldings(fund.holdings, reference);
    });
    return { ...result, fund: { ...fund, holdings } };
  };
}
