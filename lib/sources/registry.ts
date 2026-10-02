import type { SourceId } from "../types";

export interface IsharesProduct {
  productId: string;
  slug: string;
  /** Fund name from the iShares screener, when discovered. */
  name?: string;
}

export interface RegistryEntry {
  ticker: string;
  name: string;
  country: "US" | "CA";
  /** Sources to try, in order. The FMP fallback is appended automatically when a key is set. */
  sources: SourceId[];
  /** Known iShares product page; when absent the provider discovers it from the iShares screener. */
  ishares?: IsharesProduct;
}

const ca = (ticker: string, name: string, ishares?: IsharesProduct): RegistryEntry => ({
  ticker,
  name,
  country: "CA",
  sources: ishares !== undefined || name.startsWith("iShares") ? ["ishares-ca"] : [],
  ishares,
});

const us = (ticker: string, name: string, sources: SourceId[], ishares?: IsharesProduct): RegistryEntry => ({
  ticker,
  name,
  country: "US",
  sources,
  ishares,
});

/**
 * Popular ETFs and the funds they hold. Fund-of-funds such as XEQT are only
 * fully looked through when their underlying funds resolve too.
 *
 * iShares product IDs below were verified against the live screeners; funds
 * without one are discovered from the screener at runtime.
 *
 * Vanguard Canada and BMO have no free machine-readable holdings source wired
 * up yet; they resolve through the paid fallback (FMP_API_KEY).
 */
const ishares = (productId: string): IsharesProduct => ({ productId, slug: "fund" });

const ENTRIES: RegistryEntry[] = [
  // iShares Canada asset-allocation portfolios and their building blocks
  ca("XEQT", "iShares Core Equity ETF Portfolio", ishares("309480")),
  ca("XGRO", "iShares Core Growth ETF Portfolio"),
  ca("XBAL", "iShares Core Balanced ETF Portfolio"),
  ca("XTOT", "iShares Core S&P Total U.S. Stock Market Index ETF", ishares("343519")),
  ca("XIC", "iShares Core S&P/TSX Capped Composite Index ETF", ishares("239837")),
  ca("XIU", "iShares S&P/TSX 60 Index ETF", ishares("239832")),
  ca("XUS", "iShares Core S&P 500 Index ETF", ishares("251422")),
  ca("XUU", "iShares Core S&P U.S. Total Market Index ETF"),
  ca("XEF", "iShares Core MSCI EAFE IMI Index ETF", ishares("251421")),
  ca("XEC", "iShares Core MSCI Emerging Markets IMI Index ETF", ishares("251423")),
  ca("XAW", "iShares Core MSCI All Country World ex Canada Index ETF"),

  // Vanguard Canada
  ca("VEQT", "Vanguard All-Equity ETF Portfolio"),
  ca("VGRO", "Vanguard Growth ETF Portfolio"),
  ca("VBAL", "Vanguard Balanced ETF Portfolio"),
  ca("VFV", "Vanguard S&P 500 Index ETF"),
  ca("VCN", "Vanguard FTSE Canada All Cap Index ETF"),
  ca("VUN", "Vanguard U.S. Total Market Index ETF"),
  ca("VIU", "Vanguard FTSE Developed All Cap ex North America Index ETF"),
  ca("VEE", "Vanguard FTSE Emerging Markets All Cap Index ETF"),

  // BMO
  ca("ZEQT", "BMO All-Equity ETF"),
  ca("ZSP", "BMO S&P 500 Index ETF"),
  ca("ZCN", "BMO S&P/TSX Capped Composite Index ETF"),

  // iShares US (daily CSV first, quarterly N-PORT as a fallback)
  us("ITOT", "iShares Core S&P Total U.S. Stock Market ETF", ["ishares-us", "edgar-nport"], ishares("239724")),
  us("IVV", "iShares Core S&P 500 ETF", ["ishares-us", "edgar-nport"], ishares("239726")),
  us("IEFA", "iShares Core MSCI EAFE ETF", ["ishares-us", "edgar-nport"], ishares("244049")),
  us("IEMG", "iShares Core MSCI Emerging Markets ETF", ["ishares-us", "edgar-nport"], ishares("244050")),
  us("IXUS", "iShares Core MSCI Total International Stock ETF", ["ishares-us", "edgar-nport"], ishares("244048")),
  us("IWM", "iShares Russell 2000 ETF", ["ishares-us", "edgar-nport"], ishares("239710")),

  // Vanguard US, Schwab, Invesco (N-PORT filers)
  us("VTI", "Vanguard Total Stock Market ETF", ["edgar-nport"]),
  us("VOO", "Vanguard S&P 500 ETF", ["edgar-nport"]),
  us("VXUS", "Vanguard Total International Stock ETF", ["edgar-nport"]),
  us("VEA", "Vanguard FTSE Developed Markets ETF", ["edgar-nport"]),
  us("VWO", "Vanguard FTSE Emerging Markets ETF", ["edgar-nport"]),
  us("VT", "Vanguard Total World Stock ETF", ["edgar-nport"]),
  us("VGT", "Vanguard Information Technology ETF", ["edgar-nport"]),
  us("SCHD", "Schwab U.S. Dividend Equity ETF", ["edgar-nport"]),
  us("QQQ", "Invesco QQQ Trust", ["edgar-nport"]),
  us("QQQM", "Invesco NASDAQ 100 ETF", ["edgar-nport"]),

  // A unit investment trust: files no N-PORT, so only the paid fallback covers it
  us("SPY", "SPDR S&P 500 ETF Trust", []),
];

const BY_TICKER = new Map(ENTRIES.map((e) => [e.ticker, e]));

export interface ParsedSymbol {
  ticker: string;
  /** Country implied by an exchange suffix such as ".TO", if any. */
  country?: "US" | "CA";
}

/** Accepts "xeqt", "XEQT.TO", "XEQT:CA", "TSX:XEQT". */
export function parseSymbol(input: string): ParsedSymbol {
  const raw = input.trim().toUpperCase();
  const tsxPrefix = raw.match(/^(?:TSX|TSE):(.+)$/);
  if (tsxPrefix) return { ticker: tsxPrefix[1], country: "CA" };
  const suffix = raw.match(/^(.+?)(?:\.(TO|TSX|NE|V)|:CA|-CA)$/);
  if (suffix) return { ticker: suffix[1], country: "CA" };
  const usSuffix = raw.match(/^(.+?)(?::US|-US)$/);
  if (usSuffix) return { ticker: usSuffix[1], country: "US" };
  return { ticker: raw };
}

export function lookupRegistry(ticker: string): RegistryEntry | undefined {
  return BY_TICKER.get(ticker.toUpperCase());
}

export function registryEntries(): readonly RegistryEntry[] {
  return ENTRIES;
}
