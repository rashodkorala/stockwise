import { NextResponse } from "next/server";
import { refreshData } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { symbols?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const symbols = Array.isArray(body.symbols)
    ? body.symbols.filter((s): s is string => typeof s === "string" && /^[A-Za-z0-9.:\-]{1,16}$/.test(s)).slice(0, 20)
    : [];
  if (symbols.length === 0) return NextResponse.json({ error: "Pass symbols: [\"XEQT\"]" }, { status: 400 });
  return NextResponse.json(await refreshData(symbols));
}
