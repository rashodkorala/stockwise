import { identifiersFor, normaliseTicker, resolveEntities } from "../identity";
import type { AssetClass, FundHoldings, Holding, HoldingsResult, SourceId } from "../types";

/** A security reached through the fund tree, with its weight in the root fund. */
export interface Leaf {
  holding: Holding;
  weight: number;
  /** Fund tickers from the root down to the fund that holds this row directly. */
  path: string[];
}

export interface FundNode {
  ticker: string;
  name: string;
  /** Weight of this fund within the root (1 for the root itself). */
  weight: number;
  asOf?: string;
  source?: SourceId;
  /** Set when this fund could not be expanded; its weight then stays as a single leaf. */
  error?: string;
  funds: FundNode[];
  /** Directly held, non-fund rows. Weights are relative to the root. */
  leaves: Leaf[];
}

export interface Exposure {
  id: string;
  name: string;
  ticker?: string;
  country?: string;
  sector?: string;
  assetClass: AssetClass;
  weight: number;
  via: { path: string[]; weight: number }[];
}

export interface LookThrough {
  ticker: string;
  name: string;
  asOf: string;
  source: SourceId;
  tree: FundNode;
  leaves: Leaf[];
  exposures: Exposure[];
  /** Every fund that was loaded, with its own as-of date and source. */
  funds: { ticker: string; name: string; asOf?: string; source?: SourceId; error?: string }[];
  directCount: number;
  /** The root fund issuer's own look-through, when its file publishes one. */
  issuerLookThrough?: Holding[];
}

export type FundLoader = (symbol: string) => Promise<HoldingsResult>;

/** Symbol to load a fund row from, carrying the listing country so "XIC" resolves to the TSX fund. */
function childSymbol(h: Holding): string | undefined {
  const t = normaliseTicker(h.ticker);
  if (!t) return undefined;
  return h.country === "CA" ? `${t}.TO` : t;
}

/**
 * Funds below this weight in the root are kept as a single holding instead of
 * being expanded: IEFA's 0.01% slice of VEA would otherwise pull in a 3 MB filing.
 */
export const MIN_EXPAND_WEIGHT = 0.0005;

export async function lookThrough(
  rootSymbol: string,
  load: FundLoader,
  { maxDepth = 3, minExpandWeight = MIN_EXPAND_WEIGHT } = {},
): Promise<LookThrough | null> {
  const rootResult = await load(rootSymbol);
  if (!rootResult.ok) return null;
  const root = rootResult.fund;
  const funds: LookThrough["funds"] = [];

  async function expand(fund: FundHoldings, weight: number, path: string[], depth: number): Promise<FundNode> {
    funds.push({ ticker: fund.ticker, name: fund.name, asOf: fund.asOf, source: fund.source });
    const node: FundNode = {
      ticker: fund.ticker,
      name: fund.name,
      weight,
      asOf: fund.asOf,
      source: fund.source,
      funds: [],
      leaves: [],
    };
    const here = [...path, fund.ticker];

    await Promise.all(
      fund.holdings.map(async (h) => {
        const w = weight * h.weight;
        const sym = h.isFund ? childSymbol(h) : undefined;
        const ticker = normaliseTicker(h.ticker);
        if (sym && ticker && depth < maxDepth && !here.includes(ticker) && Math.abs(w) >= minExpandWeight) {
          const child = await load(sym);
          if (child.ok) {
            node.funds.push(await expand(child.fund, w, here, depth + 1));
            return;
          }
          const error = child.attempts.map((a) => `${a.source}: ${a.error}`).join("; ");
          node.funds.push({ ticker, name: h.name, weight: w, error, funds: [], leaves: [{ holding: h, weight: w, path: here }] });
          funds.push({ ticker, name: h.name, error });
          return;
        }
        node.leaves.push({ holding: h, weight: w, path: here });
      }),
    );
    node.funds.sort((a, b) => b.weight - a.weight);
    node.leaves.sort((a, b) => b.weight - a.weight);
    return node;
  }

  const tree = await expand(root, 1, [], 0);
  const leaves = collectLeaves(tree);
  return {
    ticker: root.ticker,
    name: root.name,
    asOf: root.asOf,
    source: root.source,
    tree,
    leaves,
    exposures: aggregate(leaves),
    funds,
    directCount: root.holdings.length,
    issuerLookThrough: root.issuerLookThrough,
  };
}

export function collectLeaves(node: FundNode): Leaf[] {
  const out = [...node.leaves];
  for (const f of node.funds) out.push(...collectLeaves(f));
  return out;
}

function entityId(h: Holding): string {
  const ids = identifiersFor(h);
  const tk = ids.strong.find((s) => s.kind === "tk");
  return tk?.value ?? ids.strong[0]?.value ?? ids.names[0] ?? h.name;
}

/** Merges leaves that are the same security into one exposure each, largest first. */
export function aggregate(leaves: Leaf[]): Exposure[] {
  const groups = resolveEntities(leaves.map((l) => l.holding));
  const byGroup = new Map<number, Leaf[]>();
  groups.forEach((g, i) => {
    const list = byGroup.get(g) ?? [];
    list.push(leaves[i]);
    byGroup.set(g, list);
  });

  const out: Exposure[] = [];
  byGroup.forEach((list) => {
    // Label each security from its heaviest rows, so one odd row (a stray
    // country code in a minor fund's filing) cannot relabel it.
    const heaviest = [...list].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    const lead = heaviest.find((l) => l.holding.ticker) ?? heaviest[0];
    const viaMap = new Map<string, { path: string[]; weight: number }>();
    for (const l of list) {
      const key = l.path.join(">");
      const v = viaMap.get(key) ?? { path: l.path, weight: 0 };
      v.weight += l.weight;
      viaMap.set(key, v);
    }
    out.push({
      id: entityId(lead.holding),
      // A position entered by ticker has no real name; borrow one from a fund's row.
      name: heaviest.find((l) => l.holding.name !== l.holding.ticker)?.holding.name ?? lead.holding.name,
      ticker: lead.holding.ticker,
      country: heaviest.find((l) => l.holding.country)?.holding.country,
      sector: heaviest.find((l) => l.holding.sector)?.holding.sector,
      assetClass: lead.holding.assetClass,
      weight: list.reduce((s, l) => s + l.weight, 0),
      via: Array.from(viaMap.values()).sort((a, b) => b.weight - a.weight),
    });
  });
  return out.sort((a, b) => b.weight - a.weight);
}

/** Sums exposure weights by a field, largest first. */
export function breakdown(exposures: Exposure[], field: "sector" | "country" | "assetClass"): { label: string; weight: number }[] {
  const totals = new Map<string, number>();
  for (const e of exposures) {
    const label = (e[field] as string | undefined) ?? "Unclassified";
    totals.set(label, (totals.get(label) ?? 0) + e.weight);
  }
  return Array.from(totals, ([label, weight]) => ({ label, weight })).sort((a, b) => b.weight - a.weight);
}
