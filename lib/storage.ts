import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./paths";

export interface SavedPosition {
  ticker: string;
  units: number | null;
  marketValue: number | null;
  currency: "CAD" | "USD";
}

export interface SavedPortfolio {
  baseCurrency: "CAD" | "USD";
  positions: SavedPosition[];
  savedAt: string | null;
}

export const EMPTY_PORTFOLIO: SavedPortfolio = { baseCurrency: "CAD", positions: [], savedAt: null };
const MAX_POSITIONS = 50;

const file = () => path.join(dataDir(), "portfolio.json");

const amount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Coerces untrusted input into a valid portfolio, or throws with a reason. */
export function validatePortfolio(input: unknown): Omit<SavedPortfolio, "savedAt"> {
  const body = (input ?? {}) as { baseCurrency?: unknown; positions?: unknown };
  if (!Array.isArray(body.positions)) throw new Error("positions must be a list");
  if (body.positions.length > MAX_POSITIONS) throw new Error(`At most ${MAX_POSITIONS} positions`);
  const positions = body.positions.map((raw, i): SavedPosition => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const ticker = typeof p.ticker === "string" ? p.ticker.trim().toUpperCase() : "";
    if (!ticker || ticker.length > 16 || !/^[A-Z0-9.:\- ]+$/.test(ticker)) throw new Error(`Position ${i + 1}: invalid ticker`);
    return { ticker, units: amount(p.units), marketValue: amount(p.marketValue), currency: p.currency === "USD" ? "USD" : "CAD" };
  });
  return { baseCurrency: body.baseCurrency === "USD" ? "USD" : "CAD", positions };
}

export async function readPortfolio(): Promise<SavedPortfolio> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8"));
    return { ...validatePortfolio(parsed), savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null };
  } catch {
    return EMPTY_PORTFOLIO;
  }
}

/** Writes to a temporary file first so a crash never leaves a half-written portfolio. */
export async function writePortfolio(input: unknown): Promise<SavedPortfolio> {
  const saved: SavedPortfolio = { ...validatePortfolio(input), savedAt: new Date().toISOString() };
  await mkdir(dataDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(saved, null, 2));
  await rename(tmp, file());
  return saved;
}
