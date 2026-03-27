import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "audit-ai-admin",
    time: new Date().toISOString(),
  });
}
