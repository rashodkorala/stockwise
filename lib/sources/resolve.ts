import type { FundHoldings, HoldingsResult, SourceAttempt, SourceId } from "../types";
import { fetchNportHoldings } from "./edgarNport";
import { fixturesEnabled, loadFixtureHoldings } from "./fixtures";
import { fetchFmpHoldings, fmpEnabled } from "./fmp";
import { fetchIsharesHoldings } from "./ishares";
import { lookupRegistry, parseSymbol } from "./registry";
import { fetchVanguardHoldings } from "./vanguard";

export const isKnownFund = (ticker: string) => lookupRegistry(ticker) !== undefined;

export interface ResolvedSymbol {
  ticker: string;
  country: "US" | "CA";
  name?: string;
  sources: SourceId[];
}

export function resolveSymbol(input: string): ResolvedSymbol {
  const parsed = parseSymbol(input);
  const entry = lookupRegistry(parsed.ticker);
  const country = parsed.country ?? entry?.country ?? "US";
  const sources: SourceId[] = fixturesEnabled()
    ? ["sample"]
    : entry && entry.country === country
      ? [...entry.sources]
      : country === "CA"
        ? ["ishares-ca", "vanguard-ca"]
        : ["ishares-us", "edgar-nport"];
  if (!fixturesEnabled() && fmpEnabled()) sources.push("fmp");
  return { ticker: parsed.ticker, country, name: entry?.name, sources };
}

function load(source: SourceId, sym: ResolvedSymbol): Promise<FundHoldings> {
  const entry = lookupRegistry(sym.ticker);
  switch (source) {
    case "sample":
      return loadFixtureHoldings(sym.ticker, sym.country, isKnownFund);
    case "ishares-us":
      return fetchIsharesHoldings("us", sym.ticker, entry?.ishares, isKnownFund);
    case "ishares-ca":
      return fetchIsharesHoldings("ca", sym.ticker, entry?.ishares, isKnownFund);
    case "vanguard-ca":
      return fetchVanguardHoldings(sym.ticker);
    case "edgar-nport":
      return fetchNportHoldings(sym.ticker);
    case "fmp":
      return fetchFmpHoldings(sym.ticker, sym.country, isKnownFund);
  }
}

/** Tries each source for the symbol in turn and reports every failure along the way. */
export async function getFundHoldings(input: string): Promise<HoldingsResult> {
  const sym = resolveSymbol(input);
  const attempts: SourceAttempt[] = [];
  for (const source of sym.sources) {
    try {
      const fund = await load(source, sym);
      const useRegistryName = sym.name && (fund.name === fund.ticker || source === "edgar-nport");
      return { ok: true, fund: useRegistryName ? { ...fund, name: sym.name! } : fund, attempts };
    } catch (err) {
      attempts.push({ source, error: (err as Error).message });
    }
  }
  if (!fmpEnabled() && !fixturesEnabled()) {
    attempts.push({
      source: "fmp",
      error:
        (attempts.length === 0 ? "No free source covers this fund. " : "") +
        "Paid fallback is off; set FMP_API_KEY to enable it.",
    });
  }
  return { ok: false, attempts };
}
