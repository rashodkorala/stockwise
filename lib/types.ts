export type AssetClass =
  | "equity"
  | "fund"
  | "cash"
  | "fixed_income"
  | "derivative"
  | "other";

/** One row of a fund's holdings file, normalised across sources. */
export interface Holding {
  ticker?: string;
  name: string;
  /** A second name used only for matching, such as an N-PORT filing's abbreviated title. */
  altName?: string;
  isin?: string;
  cusip?: string;
  /** ISO 3166-1 alpha-2 country of risk, when the source provides it. */
  country?: string;
  sector?: string;
  assetClass: AssetClass;
  /** Fraction of the fund's net assets (0.065 means 6.5%). */
  weight: number;
  marketValue?: number;
  /** True when this row is itself a fund that can be looked through. */
  isFund: boolean;
}

export type SourceId = "ishares-us" | "ishares-ca" | "edgar-nport" | "fmp" | "sample";

export interface FundHoldings {
  ticker: string;
  name: string;
  /** ISO date (YYYY-MM-DD) the holdings are reported as of. */
  asOf: string;
  currency?: string;
  source: SourceId;
  holdings: Holding[];
  /** The issuer's own look-through of a fund of funds, when its file includes one. */
  issuerLookThrough?: Holding[];
}

export interface SourceAttempt {
  source: SourceId;
  error: string;
}

export type HoldingsResult =
  | { ok: true; fund: FundHoldings; attempts: SourceAttempt[] }
  | { ok: false; attempts: SourceAttempt[] };
