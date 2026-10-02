import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DAY, diskCached, HOUR } from "../cache";
import { fetchJson, HttpError } from "../http";
import { normaliseCountry } from "../identity";
import { dataDir } from "../paths";
import type { AssetClass, FundHoldings, Holding } from "../types";

/**
 * Massive (formerly Polygon.io): https://massive.com/docs. Optional; set
 * MASSIVE_API_KEY. Each capability needs a different plan, so a 403 is
 * remembered for a day and that capability quietly falls back to the free
 * sources. The free plan allows 5 requests a minute, which the shared limiter
 * enforces (raise it with MASSIVE_RATE_PER_MIN on paid plans).
 */
const BASE = "https://api.massive.com";

export type Capability = "prices" | "reference" | "etf-global" | "currencies" | "forex";

export class MassiveUnavailable extends Error {}

export const massiveEnabled = () => Boolean(process.env.MASSIVE_API_KEY);

/* ---------- Rate limiting ---------- */

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Allows at most `perMinute` calls in any rolling 60-second window. */
export class RateLimiter {
  private stamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private perMinute: number,
    private now: () => number = Date.now,
    private sleep: Sleep = realSleep,
  ) {}

  /**
   * Waits for a free slot. `abandon` is checked while waiting, so a request
   * that will be refused anyway (bad key, feature outside the plan) leaves the
   * queue instead of holding everyone behind it; it then rejects.
   */
  take(abandon?: () => boolean | Promise<boolean>): Promise<void> {
    const turn = this.queue.then(async () => {
      for (;;) {
        if (abandon && (await abandon())) throw new MassiveUnavailable("request abandoned");
        const t = this.now();
        this.stamps = this.stamps.filter((s) => t - s < 60_000);
        if (this.stamps.length < this.perMinute) {
          this.stamps.push(t);
          return;
        }
        await this.sleep(Math.min(1_000, 60_000 - (t - this.stamps[0]) + 25));
      }
    });
    this.queue = turn.catch(() => {});
    return turn;
  }
}

let limiter: RateLimiter | undefined;
const getLimiter = () =>
  (limiter ??= new RateLimiter(Math.max(1, Number(process.env.MASSIVE_RATE_PER_MIN) || 5)));

/** For tests: swap the limiter and sleep used between retries. */
export function _setMassiveInternals(opts: { limiter?: RateLimiter; sleep?: Sleep }) {
  if (opts.limiter) limiter = opts.limiter;
  if (opts.sleep) retrySleep = opts.sleep;
}
let retrySleep: Sleep = realSleep;

/* ---------- Plan detection ---------- */

const DENIAL_MS = DAY;
const denialsFile = () => path.join(dataDir(), "cache", "massive-denials.json");
let denials: Record<string, number> | undefined;

async function loadDenials(): Promise<Record<string, number>> {
  if (denials) return denials;
  try {
    denials = JSON.parse(await readFile(denialsFile(), "utf8")) as Record<string, number>;
  } catch {
    denials = {};
  }
  return denials;
}

export async function isDenied(cap: Capability): Promise<boolean> {
  const d = await loadDenials();
  return (d[cap] ?? 0) > Date.now();
}

async function markDenied(cap: Capability) {
  const d = await loadDenials();
  d[cap] = Date.now() + DENIAL_MS;
  try {
    await mkdir(path.dirname(denialsFile()), { recursive: true });
    const tmp = `${denialsFile()}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(d));
    await rename(tmp, denialsFile());
  } catch {
    // Memory still remembers it for this run.
  }
}

/** For tests: forget remembered denials and the auth style. */
export function _resetMassiveDenials() {
  denials = {};
  keyInQuery = false;
  keyRejected = false;
}

// Massive accepts the key as a bearer token; its docs also show it as a query
// parameter. If the header is ever rejected, switch to the parameter once.
let keyInQuery = false;
// Set once both styles are rejected: a bad key should not keep queueing
// requests behind the rate limiter for the rest of the run.
let keyRejected = false;

/* ---------- Requests ---------- */

type Params = Record<string, string | number | undefined>;

function urlFor(pathOrUrl: string, params: Params = {}): string {
  const url = new URL(pathOrUrl, BASE);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  return url.toString();
}

/**
 * GET with the key as a bearer token, through the rate limiter. A 403 marks
 * the capability as not in this plan; a 429 is retried once after a pause.
 */
export async function massiveGet<T>(cap: Capability, pathOrUrl: string, params: Params = {}): Promise<T> {
  if (!massiveEnabled()) throw new MassiveUnavailable("MASSIVE_API_KEY is not set");
  if (keyRejected) throw new MassiveUnavailable("Massive rejected the API key (check MASSIVE_API_KEY)");
  if (await isDenied(cap)) throw new MassiveUnavailable(`Massive plan does not include ${cap}`);
  for (let attempt = 0; ; attempt++) {
    const key = process.env.MASSIVE_API_KEY!;
    const url = urlFor(pathOrUrl, keyInQuery ? { ...params, apiKey: key } : params);
    const headers: Record<string, string> = keyInQuery ? { Accept: "application/json" } : { Authorization: `Bearer ${key}`, Accept: "application/json" };
    // Requests queued behind the limiter may learn, while waiting, that the key
    // or this feature is unusable; they leave the queue rather than spend a request.
    await getLimiter().take(async () => keyRejected || (await isDenied(cap)));
    try {
      return await fetchJson<T>(url, { headers });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : undefined;
      // ETF Global answers an unknown fund with an empty list, so a 404 there
      // means the endpoint itself is unavailable to this key: treat it like 403.
      if (status === 403 || (status === 404 && cap === "etf-global")) {
        await markDenied(cap);
        throw new MassiveUnavailable(`Massive plan does not include ${cap}`);
      }
      if (status === 401 && !keyInQuery) {
        keyInQuery = true;
        continue;
      }
      if (status === 401) {
        keyRejected = true;
        throw new MassiveUnavailable("Massive rejected the API key (check MASSIVE_API_KEY)");
      }
      if (status === 429 && attempt === 0) {
        await retrySleep(15_000);
        continue;
      }
      throw err;
    }
  }
}

interface Paged<R> {
  results?: R[];
  next_url?: string;
}

/** Follows next_url until the last page (at most `maxPages`). */
export async function massiveGetAll<R>(cap: Capability, path_: string, params: Params, maxPages = 20): Promise<R[]> {
  const out: R[] = [];
  let next: string | undefined = urlFor(path_, params);
  for (let page = 0; next && page < maxPages; page++) {
    const res: Paged<R> = await massiveGet<Paged<R>>(cap, next);
    out.push(...(res.results ?? []));
    next = res.next_url;
  }
  return out;
}

/* ---------- 1. Prices ---------- */

export interface MassiveQuote {
  price: number;
  currency: string;
  asOf: string;
}

interface Bar {
  T?: string;
  c: number;
  t: number;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Every US ticker's latest end-of-day close, from one daily market summary
 * request (the free plan's 5 requests a minute go a long way this way).
 * Walks back from yesterday over weekends and holidays.
 */
export function latestDailyCloses(today = new Date()): Promise<{ date: string; closes: Record<string, number> }> {
  return diskCached(`massive:grouped:${isoDay(today)}`, 6 * HOUR, async () => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    for (let tries = 0; tries < 6; tries++) {
      d.setUTCDate(d.getUTCDate() - 1);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      const res = await massiveGet<{ results?: Bar[] }>("prices", `/v2/aggs/grouped/locale/us/market/stocks/${isoDay(d)}`, {
        adjusted: "true",
      });
      if (res.results?.length) {
        const closes: Record<string, number> = {};
        for (const b of res.results) if (b.T && b.c > 0) closes[b.T] = b.c;
        return { date: isoDay(d), closes };
      }
    }
    throw new Error("Massive returned no recent trading day");
  });
}

/** Latest end-of-day price for a US ticker. */
export async function massiveQuote(ticker: string): Promise<MassiveQuote> {
  const t = ticker.toUpperCase();
  const { date, closes } = await latestDailyCloses();
  if (closes[t]) return { price: closes[t], currency: "USD", asOf: date };
  const prev = await massiveGet<{ results?: Bar[] }>("prices", `/v2/aggs/ticker/${encodeURIComponent(t)}/prev`, {
    adjusted: "true",
  });
  const bar = prev.results?.[0];
  if (!bar?.c) throw new Error(`Massive has no price for ${t}`);
  return { price: bar.c, currency: "USD", asOf: isoDay(new Date(bar.t)) };
}

/* ---------- 2. ETF holdings (ETF Global) ---------- */

export interface Constituent {
  composite_ticker?: string;
  constituent_ticker?: string | null;
  constituent_name?: string | null;
  asset_class?: string | null;
  security_type?: string | null;
  country_of_exchange?: string | null;
  currency_traded?: string | null;
  effective_date?: string;
  figi?: string | null;
  isin?: string | null;
  sedol?: string | null;
  us_code?: string | null;
  market_value?: number | null;
  shares_held?: number | null;
  weight?: number | null;
}

function constituentClass(c: Constituent): AssetClass {
  const s = `${c.asset_class ?? ""} ${c.security_type ?? ""}`.toLowerCase();
  if (/\b(etf|fund|etp)\b/.test(s)) return "fund";
  if (/cash|money market|currency/.test(s)) return "cash";
  if (/future|swap|forward|option|derivative/.test(s)) return "derivative";
  if (/bond|fixed income|debt|treasury|note/.test(s)) return "fixed_income";
  if (/equity|stock|share|reit|adr|depositary/.test(s)) return "equity";
  return "other";
}

/** Maps constituents to holdings, detecting whether weights are percentages or fractions. */
export function mapConstituents(rows: Constituent[], ticker: string): FundHoldings {
  if (rows.length === 0) throw new Error(`Massive has no holdings for ${ticker}`);
  const total = rows.reduce((s, r) => s + (r.weight ?? 0), 0);
  const scale = total > 5 ? 100 : 1; // ≈100 means percent, ≈1 means fraction
  const holdings: Holding[] = rows
    .filter((r) => r.weight !== null && r.weight !== undefined)
    .map((r) => {
      const assetClass = constituentClass(r);
      return {
        ticker: r.constituent_ticker ?? undefined,
        tickerScheme: "massive",
        name: r.constituent_name ?? r.constituent_ticker ?? "Unknown",
        isin: r.isin ?? undefined,
        cusip: r.us_code ?? undefined,
        country: normaliseCountry(r.country_of_exchange ?? undefined),
        assetClass,
        weight: (r.weight as number) / scale,
        marketValue: r.market_value ?? undefined,
        isFund: assetClass === "fund",
      };
    });
  const asOf = rows.reduce((d, r) => (r.effective_date && r.effective_date > d ? r.effective_date : d), "");
  return { ticker, name: ticker, asOf, currency: "USD", source: "massive-etf", holdings };
}

export function fetchMassiveEtfHoldings(ticker: string): Promise<FundHoldings> {
  return diskCached(`massive-etf:${ticker}`, 12 * HOUR, async () => {
    const latest = await massiveGet<Paged<Constituent>>("etf-global", "/etf-global/v1/constituents", {
      composite_ticker: ticker,
      sort: "effective_date.desc",
      limit: 1,
    });
    const date = latest.results?.[0]?.effective_date;
    if (!date) throw new Error(`Massive has no holdings for ${ticker}`);
    const rows = await massiveGetAll<Constituent>("etf-global", "/etf-global/v1/constituents", {
      composite_ticker: ticker,
      effective_date: date,
      limit: 5000,
    });
    return mapConstituents(rows, ticker);
  });
}

/* ---------- 3. Company details ---------- */

export interface CompanyDetails {
  name: string;
  sector?: string;
  industry?: string;
  country?: string;
}

// SIC descriptions to GICS-style sectors, by keyword; first match wins.
const SIC_SECTORS: [RegExp, string][] = [
  [/semiconductor|computer|software|prepackaged|electronic|data processing|internet|telephone & telegraph apparatus/i, "Information Technology"],
  [/pharmaceutical|biological|medical|surgical|hospital|health|diagnostic/i, "Health Care"],
  [/bank|savings institution|insurance|security brokers|finance|investment|credit|real estate investment trust/i, "Financials"],
  [/crude petroleum|oil|natural gas|petroleum refining|coal/i, "Energy"],
  [/electric services|gas & other services|water supply|utilit/i, "Utilities"],
  [/real estate|lessors of real property/i, "Real Estate"],
  [/telephone communications|radiotelephone|cable|television|motion picture|services-advertising/i, "Communication"],
  [/retail|motor vehicles|apparel|restaurants|eating|hotels|catalog|auto/i, "Consumer Discretionary"],
  [/food|beverage|tobacco|soap|cosmetic|grocery/i, "Consumer Staples"],
  [/chemical|mining|metal|steel|paper|plastic|gold|lumber/i, "Materials"],
  [/aircraft|machinery|railroad|trucking|air transport|construction|industrial|engineering|defense/i, "Industrials"],
];

export function sectorFromSic(sic?: string | null): string | undefined {
  if (!sic) return undefined;
  return SIC_SECTORS.find(([re]) => re.test(sic))?.[1] ?? sic;
}

interface TickerOverview {
  results?: { name?: string; sic_description?: string; locale?: string; market?: string; type?: string };
}

export function massiveCompanyDetails(ticker: string): Promise<CompanyDetails> {
  return diskCached(`massive:ticker:${ticker.toUpperCase()}`, 7 * DAY, async () => {
    const res = await massiveGet<TickerOverview>("reference", `/v3/reference/tickers/${encodeURIComponent(ticker.toUpperCase())}`);
    const r = res.results;
    if (!r?.name) throw new Error(`Massive has no details for ${ticker}`);
    return {
      name: r.name,
      sector: sectorFromSic(r.sic_description),
      industry: r.sic_description ?? undefined,
      country: r.locale === "us" ? "US" : undefined,
    };
  });
}

/* ---------- 4. Currency conversion ---------- */

/** Units of `to` per one unit of `from`. */
export async function massiveFxRate(from: string, to: string): Promise<number> {
  try {
    const res = await massiveGet<{ converted?: number }>("currencies", `/v1/conversion/${from}/${to}`, {
      amount: 1,
      precision: 6,
    });
    if (res.converted) return res.converted;
  } catch (err) {
    if (!(err instanceof MassiveUnavailable)) throw err;
  }
  const prev = await massiveGet<{ results?: Bar[] }>("forex", `/v2/aggs/ticker/C:${from}${to}/prev`);
  const c = prev.results?.[0]?.c;
  if (!c) throw new Error(`Massive has no ${from}/${to} rate`);
  return c;
}
