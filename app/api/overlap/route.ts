import { NextResponse } from "next/server";
import { loadOverlap } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const a = params.get("a");
  const b = params.get("b");
  if (!a || !b) return NextResponse.json({ error: "Pass ?a=XEQT&b=VEQT" }, { status: 400 });
  const result = await loadOverlap(a, b);
  return result.ok ? NextResponse.json(result.data) : NextResponse.json(result, { status: 404 });
}
