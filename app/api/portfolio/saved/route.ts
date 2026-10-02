import { NextResponse } from "next/server";
import { readPortfolio, writePortfolio } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readPortfolio());
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  try {
    return NextResponse.json(await writePortfolio(body));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
