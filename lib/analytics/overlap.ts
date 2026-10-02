import { resolveEntities } from "../identity";
import type { Leaf, LookThrough } from "./lookthrough";

export interface OverlapRow {
  name: string;
  ticker?: string;
  sector?: string;
  country?: string;
  weightA: number;
  weightB: number;
}

export interface Overlap {
  a: { ticker: string; name: string; count: number };
  b: { ticker: string; name: string; count: number };
  /** Sum over shared securities of min(weightA, weightB): the portion of the two funds that is identical. */
  overlap: number;
  /** Share of A (by weight) in securities that B also holds, and vice versa. */
  aInB: number;
  bInA: number;
  shared: OverlapRow[];
  onlyA: OverlapRow[];
  onlyB: OverlapRow[];
}

/** Cash and derivatives are excluded: every fund holds "USD cash", which says nothing about overlap. */
const comparable = (l: Leaf) => l.holding.assetClass !== "cash" && l.holding.assetClass !== "derivative";

/**
 * Compares two look-through results security by security. Each side is
 * rescaled to 100% of its comparable holdings first, so funds with different
 * cash levels still compare fairly.
 */
export function computeOverlap(a: LookThrough, b: LookThrough): Overlap {
  const la = a.leaves.filter(comparable);
  const lb = b.leaves.filter(comparable);
  const totalA = la.reduce((s, l) => s + l.weight, 0) || 1;
  const totalB = lb.reduce((s, l) => s + l.weight, 0) || 1;

  const all = [...la.map((l) => ({ l, side: "a" as const })), ...lb.map((l) => ({ l, side: "b" as const }))];
  const groups = resolveEntities(all.map((x) => x.l.holding));

  const rows = new Map<number, OverlapRow>();
  groups.forEach((g, i) => {
    const { l, side } = all[i];
    const row = rows.get(g) ?? {
      name: l.holding.name,
      ticker: l.holding.ticker,
      sector: l.holding.sector,
      country: l.holding.country,
      weightA: 0,
      weightB: 0,
    };
    if (!row.ticker && l.holding.ticker) {
      row.ticker = l.holding.ticker;
      row.name = l.holding.name;
    }
    row.sector ??= l.holding.sector;
    row.country ??= l.holding.country;
    if (side === "a") row.weightA += l.weight / totalA;
    else row.weightB += l.weight / totalB;
    rows.set(g, row);
  });

  const shared: OverlapRow[] = [];
  const onlyA: OverlapRow[] = [];
  const onlyB: OverlapRow[] = [];
  rows.forEach((r) => {
    if (r.weightA > 0 && r.weightB > 0) shared.push(r);
    else if (r.weightA > 0) onlyA.push(r);
    else if (r.weightB > 0) onlyB.push(r);
  });
  shared.sort((x, y) => Math.min(y.weightA, y.weightB) - Math.min(x.weightA, x.weightB));
  onlyA.sort((x, y) => y.weightA - x.weightA);
  onlyB.sort((x, y) => y.weightB - x.weightB);

  return {
    a: { ticker: a.ticker, name: a.name, count: shared.length + onlyA.length },
    b: { ticker: b.ticker, name: b.name, count: shared.length + onlyB.length },
    overlap: shared.reduce((s, r) => s + Math.min(r.weightA, r.weightB), 0),
    aInB: shared.reduce((s, r) => s + r.weightA, 0),
    bInA: shared.reduce((s, r) => s + r.weightB, 0),
    shared,
    onlyA,
    onlyB,
  };
}
