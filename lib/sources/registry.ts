import type { SourceId } from "../types";

export interface IsharesProduct {
  productId: string;
  slug: string;
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
 * Vanguard Canada and BMO have no free machine-readable holdings source wired
 * up yet; they resolve through the paid fallback (FMP_API_KEY).
 */
const ENTRIES: RegistryEntry[] = [
  // iShares Canada asset-allocation portfolios and their building blocks
  ca("XEQT", "iShares Core Equity ETF Portfolio", { productId: "309480", slug: "ishares-core-equity-etf-portfolio" }),
  ca("XGRO", "iShares Core Growth ETF Portfolio"),
  ca("XBAL", "iShares Core Balanced ETF Portfolio"),
  ca("XIC", "iShares Core S&P/TSX Capped Composite Index ETF", {
    productId: "239837",
    slug: "ishares-sptsx-capped-composite-index-etf",
  }),
  ca("XIU", "iShares S&P/TSX 60 Index ETF", { productId: "239832", slug: "ishares-sptsx-60-index-etf" }),
  ca("XUS", "iShares Core S&P 500 Index ETF"),
  ca("XUU", "iShares Core S&P U.S. Total Market Index ETF"),
  ca("XEF", "iShares Core MSCI EAFE IMI Index ETF"),
  ca("XEC", "iShares Core MSCI Emerging Markets IMI Index ETF"),
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

  // iShares US
  us("ITOT", "iShares Core S&P Total U.S. Stock Market ETF", ["ishares-us", "edgar-nport"], {
    productId: "239724",
    slug: "ishares-core-sp-total-us-stock-market-etf",
  }),
  us("IVV", "iShares Core S&P 500 ETF", ["ishares-us", "edgar-nport"], {
    productId: "239726",
    slug: "ishares-core-sp-500-etf",
  }),
  us("IEFA", "iShares Core MSCI EAFE ETF", ["ishares-us", "edgar-nport"], {
    productId: "244049",
    slug: "ishares-core-msci-eafe-etf",
  }),
  us("IEMG", "iShares Core MSCI Emerging Markets ETF", ["ishares-us", "edgar-nport"], {
    productId: "244050",
    slug: "ishares-core-msci-emerging-markets-etf",
  }),
  us("IWM", "iShares Russell 2000 ETF", ["ishares-us", "edgar-nport"], {
    productId: "239710",
    slug: "ishares-russell-2000-etf",
  }),

  // Vanguard US, Schwab, Invesco (N-PORT filers)
  us("VTI", "Vanguard Total Stock Market ETF", ["edgar-nport"]),
  us("VOO", "Vanguard S&P 500 ETF", ["edgar-nport"]),
  us("VXUS", "Vanguard Total International Stock ETF", ["edgar-nport"]),
  us("VEA", "Vanguard FTSE Developed Markets ETF", ["edgar-nport"]),
  us("VWO", "Vanguard FTSE Emerging Markets ETF", ["edgar-nport"]),
  us("VT", "Vanguard Total World Stock ETF", ["edgar-nport"]),
  us("VGT", "Vanguard Information Technology ETF", ["edgar-nport"]),
  us("SCHD", "Schwab U.S. Dividend Equity ETF", ["edgar-nport"]),
  us("QQQM", "Invesco NASDAQ 100 ETF", ["edgar-nport"]),

  // Unit investment trusts file no N-PORT, so only the paid fallback covers them
  us("SPY", "SPDR S&P 500 ETF Trust", []),
  us("QQQ", "Invesco QQQ Trust", []),
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
