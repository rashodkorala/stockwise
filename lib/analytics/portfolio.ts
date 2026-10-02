import type { Holding } from "../types";
import { aggregate, type Exposure, type Leaf, type LookThrough } from "./lookthrough";
import { computeOverlap } from "./overlap";

export interface ValuedPosition {
  ticker: string;
  /** Market value in the portfolio's base currency. */
  value: number;
  /** Present when the position is a fund that was looked through. */
  fund?: LookThrough;
  /** Present when the position is a single security. */
  security?: Holding;
}

export interface PortfolioExposure {
  total: number;
  /** Each exposure's weight is its share of the whole portfolio; value is in base currency. */
  exposures: (Exposure & { value: number })[];
  overlapMatrix: { tickers: string[]; values: number[][] };
}

/**
 * Rolls every position down to underlying securities and adds up how much of
 * each company the portfolio owns, however many funds it is spread across.
 */
export function computePortfolioExposure(positions: ValuedPosition[]): PortfolioExposure {
  const total = positions.reduce((s, p) => s + p.value, 0);
  const leaves: Leaf[] = [];
  for (const p of positions) {
    const share = total > 0 ? p.value / total : 0;
    if (p.fund) {
      for (const l of p.fund.leaves) leaves.push({ ...l, weight: l.weight * share });
    } else if (p.security) {
      leaves.push({ holding: p.security, weight: share, path: [] });
    }
  }
  // aggregate() resolves identities across every position, so a stock held
  // directly merges with the same stock inside a fund.
  const exposures = aggregate(leaves).map((e) => ({ ...e, value: e.weight * total }));

  const funds = positions.filter((p): p is ValuedPosition & { fund: LookThrough } => Boolean(p.fund));
  const values = funds.map(() => funds.map(() => 1));
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      values[i][j] = values[j][i] = computeOverlap(funds[i].fund, funds[j].fund).overlap;
    }
  }
  return { total, exposures, overlapMatrix: { tickers: funds.map((f) => f.ticker), values } };
}
