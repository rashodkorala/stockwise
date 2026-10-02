export function pct(w: number, digits = 2): string {
  return `${(w * 100).toFixed(digits)}%`;
}

export function money(v: number, currency = "CAD", compact = false): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(v);
}

export const SOURCE_LABELS: Record<string, string> = {
  "ishares-us": "iShares (US) daily holdings",
  "ishares-ca": "BlackRock Canada daily holdings",
  "edgar-nport": "SEC N-PORT quarterly filing",
  fmp: "Financial Modeling Prep",
  sample: "Sample data",
};
