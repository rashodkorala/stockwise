import { normaliseTicker } from "../identity";
import type { Holding } from "../types";
import type { Exposure } from "./lookthrough";

export interface CrossCheck {
  /** Number of securities in the issuer's own look-through. */
  issuerCount: number;
  /** How many of the issuer's largest names were compared. */
  compared: number;
  /** How many of those we found in our look-through. */
  found: number;
  /** Largest absolute weight difference among compared names (fraction, 0.0005 = 0.05 pp). */
  maxDiff: number;
  worst?: { ticker: string; ours: number; issuer: number };
}

const key = (ticker?: string, country?: string) => {
  const t = normaliseTicker(ticker);
  return t ? `${t}|${country ?? ""}` : undefined;
};

/**
 * Compares our recursive look-through with the issuer's published one, name by
 * name for the issuer's largest holdings. Both come from the same issuer files,
 * so ticker plus country is a reliable key.
 */
export function crossCheck(exposures: Exposure[], issuer: Holding[], top = 50): CrossCheck {
  const ours = new Map<string, number>();
  for (const e of exposures) {
    const k = key(e.ticker, e.country);
    if (k) ours.set(k, (ours.get(k) ?? 0) + e.weight);
  }
  const theirs = new Map<string, { ticker: string; weight: number }>();
  for (const h of issuer) {
    if (h.assetClass !== "equity") continue;
    const k = key(h.ticker, h.country);
    if (!k) continue;
    const prev = theirs.get(k);
    theirs.set(k, { ticker: h.ticker!, weight: (prev?.weight ?? 0) + h.weight });
  }
  const largest = Array.from(theirs.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, top);

  let found = 0;
  let maxDiff = 0;
  let worst: CrossCheck["worst"];
  for (const [k, { ticker, weight }] of largest) {
    const mine = ours.get(k);
    if (mine !== undefined) found++;
    const diff = Math.abs((mine ?? 0) - weight);
    if (diff > maxDiff) {
      maxDiff = diff;
      worst = { ticker, ours: mine ?? 0, issuer: weight };
    }
  }
  return { issuerCount: issuer.length, compared: largest.length, found, maxDiff, worst };
}
