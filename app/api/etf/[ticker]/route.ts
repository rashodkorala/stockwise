import { NextResponse } from "next/server";
import { loadLookThrough, toEtfView } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { ticker: string } }) {
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 1000, 20_000);
  const result = await loadLookThrough(decodeURIComponent(params.ticker));
  if (!result.ok) return NextResponse.json(result, { status: 404 });
  return NextResponse.json(toEtfView(result.data, limit));
}
