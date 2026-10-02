import { NextResponse } from "next/server";
import { loadPortfolio, type PositionInput } from "@/lib/service";

export const dynamic = "force-dynamic";

const MAX_POSITIONS = 50;

export async function POST(req: Request) {
  let body: { positions?: PositionInput[]; baseCurrency?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const positions = (body.positions ?? [])
    .filter((p) => typeof p?.ticker === "string" && p.ticker.trim())
    .slice(0, MAX_POSITIONS)
    .map((p) => ({
      ticker: p.ticker.trim().toUpperCase().slice(0, 16),
      units: typeof p.units === "number" ? p.units : null,
      marketValue: typeof p.marketValue === "number" ? p.marketValue : null,
      currency: p.currency === "USD" || p.currency === "CAD" ? p.currency : null,
    }));
  if (positions.length === 0) return NextResponse.json({ error: "Add at least one position" }, { status: 400 });
  const base = body.baseCurrency === "USD" ? "USD" : "CAD";
  return NextResponse.json(await loadPortfolio(positions, base));
}
