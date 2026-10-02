import "server-only";
import { crossCheck, type CrossCheck } from "./analytics/crosscheck";
import { breakdown, lookThrough, type Exposure, type FundNode, type LookThrough } from "./analytics/lookthrough";
import { computeOverlap, type Overlap, type OverlapRow } from "./analytics/overlap";
import { computePortfolioExposure } from "./analytics/portfolio";
import { cached, HOUR, invalidate } from "./cache";
import { normaliseCountry } from "./identity";
import { getFxRate, getQuote, type Quote } from "./quotes";
import { massiveCompanyDetails, massiveEnabled, type CompanyDetails } from "./sources/massive";
import { withEnrichment } from "./sources/enrich";
import { getFundHoldings, resolveSymbol } from "./sources/resolve";
import type { Holding, SourceAttempt } from "./types";

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string; attempts: SourceAttempt[] };

/** Fund loader for pages: SEC filings get tickers and sectors filled in from iShares reference funds. */
const loadFund = withEnrichment(getFundHoldings);

export async function loadLookThrough(symbol: string): Promise<Loaded<LookThrough>> {
  const sym = resolveSymbol(symbol);
  const key = `lt:${sym.ticker}:${sym.country}`;
  try {
    const lt = await cached(key, HOUR, async () => {
      const result = await lookThrough(symbol, loadFund);
      if (!result) {
        const r = await getFundHoldings(symbol);
        throw Object.assign(new Error(`Could not load holdings for ${sym.ticker}`), {
          attempts: r.ok ? [] : r.attempts,
        });
      }
      return result;
    });
    return { ok: true, data: lt };
  } catch (err) {
    return { ok: false, error: (err as Error).message, attempts: (err as { attempts?: SourceAttempt[] }).attempts ?? [] };
  }
}

/* ---------- Refresh ---------- */

// Cache keys that hold one fund's data carry its ticker as a segment:
// ishares:ca:XEQT, vanguard-ca:VEQT, nport:VTI, fmp:VEQT:CA, lt:XEQT:CA, enriched:…:VTI:….
const FUND_KEY_PREFIXES = new Set(["ishares", "vanguard-ca", "massive-etf", "nport", "fmp", "lt", "enriched"]);
const MIN_REFRESH_GAP_MS = 30_000;
const lastRefreshed = new Map<string, number>();

/**
 * Forgets the cached data for these funds and every fund they hold, plus their
 * prices and exchange rates, so the next page load fetches it fresh. Funds
 * refreshed in the last 30 seconds are skipped to spare the data sources.
 */
export async function refreshData(symbols: string[]): Promise<{ tickers: string[]; dropped: number }> {
  const tickers = new Set<string>();
  for (const s of symbols) {
    tickers.add(resolveSymbol(s).ticker);
    const lt = await loadLookThrough(s); // already cached when called from a page
    if (lt.ok) lt.data.funds.forEach((f) => tickers.add(f.ticker));
  }
  const now = Date.now();
  const due = Array.from(tickers).filter((t) => now - (lastRefreshed.get(t) ?? 0) >= MIN_REFRESH_GAP_MS);
  due.forEach((t) => lastRefreshed.set(t, now));
  const wanted = new Set(due);
  if (wanted.size === 0) return { tickers: [], dropped: 0 };

  const dropped = await invalidate((key) => {
    const [prefix, ...rest] = key.split(":");
    if (prefix === "quote") return wanted.has(rest.join(":").replace(/\.TO$/, ""));
    if (prefix === "fx") return true;
    // Massive's end-of-day closes for every US ticker come in one request; refetch it too.
    if (prefix === "massive" && rest[0] === "grouped") return true;
    return FUND_KEY_PREFIXES.has(prefix) && rest.some((segment) => wanted.has(segment));
  });
  return { tickers: due, dropped };
}

/* ---------- Views: compact, serialisable shapes for client components ---------- */

export interface TreemapNode {
  name: string;
  ticker?: string;
  weight?: number;
  /** The folded "N other holdings" cell. */
  other?: boolean;
  children?: TreemapNode[];
}

export interface ExposureRow {
  name: string;
  ticker?: string;
  country?: string;
  sector?: string;
  assetClass: string;
  weight: number;
  via: string[];
}

export interface EtfView {
  ticker: string;
  name: string;
  asOf: string;
  source: string;
  funds: LookThrough["funds"];
  direct: { name: string; ticker?: string; weight: number; isFund: boolean; assetClass: string; expanded: boolean }[];
  exposures: ExposureRow[];
  exposureCount: number;
  /** Sum of all looked-through weights; below 1 when a source lists only part of a fund. */
  coverage: number;
  sectors: { label: string; weight: number }[];
  countries: { label: string; weight: number }[];
  treemap: TreemapNode;
  /** Comparison with the issuer's own look-through, when one is published. */
  issuerCheck?: CrossCheck;
}

const toRow = (e: Exposure): ExposureRow => ({
  name: e.name,
  ticker: e.ticker,
  country: e.country,
  sector: e.sector,
  assetClass: e.assetClass,
  weight: e.weight,
  via: e.via.slice(0, 4).map((v) => v.path.join(" › ")),
});

/** Each fund keeps its largest names; the rest fold into one "Other" cell so the treemap stays legible. */
function treemapOf(node: FundNode, perFund: number): TreemapNode {
  const children: TreemapNode[] = node.funds.map((f) => treemapOf(f, perFund));
  const leaves = node.leaves.filter((l) => l.weight > 0);
  for (const l of leaves.slice(0, perFund)) {
    children.push({ name: l.holding.name, ticker: l.holding.ticker, weight: l.weight });
  }
  const rest = leaves.slice(perFund);
  if (rest.length) {
    children.push({ name: `${rest.length} other holdings`, weight: rest.reduce((s, l) => s + l.weight, 0), other: true });
  }
  return { name: node.name, ticker: node.ticker, children };
}

export function toEtfView(lt: LookThrough, limit = 1000): EtfView {
  const expanded = new Set(lt.tree.funds.filter((f) => !f.error).map((f) => f.ticker));
  return {
    ticker: lt.ticker,
    name: lt.name,
    asOf: lt.asOf,
    source: lt.source,
    funds: lt.funds,
    direct: [
      ...lt.tree.funds.map((f): EtfView["direct"][number] => ({
        name: f.name,
        ticker: f.ticker,
        weight: f.weight,
        isFund: true,
        assetClass: "fund",
        expanded: expanded.has(f.ticker),
      })),
      ...lt.tree.leaves.map((l): EtfView["direct"][number] => ({
        name: l.holding.name,
        ticker: l.holding.ticker,
        weight: l.weight,
        isFund: l.holding.isFund,
        assetClass: l.holding.assetClass,
        expanded: false,
      })),
    ].sort((a, b) => b.weight - a.weight),
    exposures: lt.exposures.slice(0, limit).map(toRow),
    exposureCount: lt.exposures.length,
    coverage: lt.exposures.reduce((s, e) => s + e.weight, 0),
    sectors: breakdown(lt.exposures.filter((e) => e.assetClass === "equity"), "sector"),
    countries: breakdown(lt.exposures.filter((e) => e.assetClass === "equity"), "country"),
    treemap: treemapOf(lt.tree, 30),
    issuerCheck: lt.issuerLookThrough ? crossCheck(lt.exposures, lt.issuerLookThrough) : undefined,
  };
}

export interface OverlapView extends Omit<Overlap, "shared" | "onlyA" | "onlyB"> {
  shared: OverlapRow[];
  onlyA: OverlapRow[];
  onlyB: OverlapRow[];
  sharedCount: number;
  onlyACount: number;
  onlyBCount: number;
}

export async function loadOverlap(a: string, b: string, limit = 500): Promise<Loaded<OverlapView>> {
  const [la, lb] = await Promise.all([loadLookThrough(a), loadLookThrough(b)]);
  if (!la.ok) return la;
  if (!lb.ok) return lb;
  const o = computeOverlap(la.data, lb.data);
  return {
    ok: true,
    data: {
      ...o,
      shared: o.shared.slice(0, limit),
      onlyA: o.onlyA.slice(0, limit),
      onlyB: o.onlyB.slice(0, limit),
      sharedCount: o.shared.length,
      onlyACount: o.onlyA.length,
      onlyBCount: o.onlyB.length,
    },
  };
}

/* ---------- Portfolio ---------- */

export interface PositionInput {
  ticker: string;
  units?: number | null;
  marketValue?: number | null;
  currency?: string | null;
}

export interface PortfolioView {
  baseCurrency: string;
  total: number;
  positions: {
    ticker: string;
    kind: "fund" | "security";
    name: string;
    value: number;
    price?: number;
    priceCurrency?: string;
    /** Trading day of the price, when the source reports it (Massive end-of-day). */
    priceAsOf?: string;
    priceSource?: Quote["source"];
    error?: string;
  }[];
  exposures: (ExposureRow & { value: number })[];
  exposureCount: number;
  sectors: { label: string; weight: number }[];
  countries: { label: string; weight: number }[];
  overlapMatrix: { tickers: string[]; values: number[][] };
}

export async function loadPortfolio(inputs: PositionInput[], baseCurrency: "CAD" | "USD"): Promise<PortfolioView> {
  const positions = await Promise.all(
    inputs.map(async (p) => {
      const sym = resolveSymbol(p.ticker);
      const label = sym.country === "CA" ? `${sym.ticker}.TO` : sym.ticker;
      try {
        let value: number;
        let price: number | undefined;
        let priceCurrency: string | undefined;
        let priceAsOf: string | undefined;
        let priceSource: Quote["source"];
        if (p.units != null && p.units > 0) {
          const q = await getQuote(sym.ticker, sym.country);
          price = q.price;
          priceCurrency = q.currency;
          priceAsOf = q.asOf;
          priceSource = q.source;
          value = p.units * q.price * (await getFxRate(q.currency, baseCurrency));
        } else if (p.marketValue != null && p.marketValue > 0) {
          const ccy = p.currency || (sym.country === "CA" ? "CAD" : "USD");
          value = p.marketValue * (await getFxRate(ccy, baseCurrency));
        } else {
          throw new Error("Enter units or a market value");
        }

        const lt = await loadLookThrough(p.ticker);
        const priced = { ticker: label, value, price, priceCurrency, priceAsOf, priceSource };
        if (lt.ok) return { ...priced, fund: lt.data, name: lt.data.name };
        // A single stock: Massive's ticker overview supplies its name and sector (US listings).
        let details: CompanyDetails | undefined;
        if (massiveEnabled() && sym.country === "US") details = await massiveCompanyDetails(sym.ticker).catch(() => undefined);
        const security: Holding = {
          ticker: sym.ticker,
          name: details?.name ?? sym.ticker,
          country: normaliseCountry(sym.country),
          sector: details?.sector,
          assetClass: "equity",
          weight: 1,
          isFund: false,
        };
        return { ...priced, security, name: security.name };
      } catch (err) {
        return { ticker: label, value: 0, name: sym.ticker, error: (err as Error).message };
      }
    }),
  );

  const valued = positions.filter((p) => !("error" in p && p.error));
  const result = computePortfolioExposure(valued);
  const equity = result.exposures.filter((e) => e.assetClass === "equity");
  return {
    baseCurrency,
    total: result.total,
    positions: positions.map((p) => ({
      ticker: p.ticker,
      kind: "fund" in p && p.fund ? "fund" : "security",
      name: p.name,
      value: p.value,
      price: "price" in p ? p.price : undefined,
      priceCurrency: "priceCurrency" in p ? p.priceCurrency : undefined,
      priceAsOf: "priceAsOf" in p ? p.priceAsOf : undefined,
      priceSource: "priceSource" in p ? p.priceSource : undefined,
      error: "error" in p ? p.error : undefined,
    })),
    exposures: result.exposures.slice(0, 500).map((e) => ({ ...toRow(e), value: e.value })),
    exposureCount: result.exposures.length,
    sectors: breakdown(equity, "sector"),
    countries: breakdown(equity, "country"),
    overlapMatrix: result.overlapMatrix,
  };
}
