import { readFile } from "node:fs/promises";
import path from "node:path";
import { cached, HOUR } from "./cache";
import { fetchJson, HttpError } from "./http";
import { fixturesEnabled } from "./sources/fixtures";
import { fmpEnabled, fmpSymbol } from "./sources/fmp";

export interface Quote {
  symbol: string;
  price: number;
  currency: string;
}

interface YahooChart {
  chart?: { result?: { meta?: { regularMarketPrice?: number; currency?: string } }[] };
}

async function yahooQuote(symbol: string): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  let data: YahooChart;
  try {
    data = await fetchJson<YahooChart>(url);
  } catch (err) {
    // Yahoo rate-limits bursts with 429; one short pause usually clears it.
    if (!(err instanceof HttpError) || err.status !== 429) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    data = await fetchJson<YahooChart>(url);
  }
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`No price for ${symbol}`);
  return { symbol, price: meta.regularMarketPrice, currency: meta.currency ?? "USD" };
}

async function fmpQuote(symbol: string): Promise<Quote> {
  const rows = await fetchJson<{ price?: number; currency?: string }[]>(
    `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.FMP_API_KEY}`,
  );
  if (!rows[0]?.price) throw new Error(`No price for ${symbol}`);
  return { symbol, price: rows[0].price, currency: rows[0].currency ?? (symbol.endsWith(".TO") ? "CAD" : "USD") };
}

async function fixtureQuote(symbol: string): Promise<Quote> {
  const all = JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "quotes.json"), "utf8")) as Record<
    string,
    { price: number; currency: string }
  >;
  const q = all[symbol];
  if (!q) throw new Error(`No sample price for ${symbol}`);
  return { symbol, ...q };
}

/** Latest price for a ticker; Canadian listings take the ".TO" suffix. */
export function getQuote(ticker: string, country: "US" | "CA"): Promise<Quote> {
  const symbol = fmpSymbol(ticker, country);
  return cached(`quote:${symbol}`, HOUR / 4, async () => {
    if (fixturesEnabled()) return fixtureQuote(symbol);
    try {
      return await yahooQuote(symbol);
    } catch (err) {
      if (fmpEnabled()) return fmpQuote(symbol);
      throw err;
    }
  });
}

/** Units of `to` per one unit of `from`. */
export async function getFxRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const symbol = `${from}${to}=X`;
  return cached(`fx:${symbol}`, HOUR, async () => {
    if (fixturesEnabled()) return (await fixtureQuote(symbol)).price;
    try {
      return (await yahooQuote(symbol)).price;
    } catch (err) {
      if (fmpEnabled()) return (await fmpQuote(`${from}${to}`)).price;
      throw err;
    }
  });
}
