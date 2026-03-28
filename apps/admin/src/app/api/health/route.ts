import { NextResponse } from "next/server";
import { getStorageBackend } from "@/lib/review-pool";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "audit-ai-admin",
    storage: getStorageBackend(),
    time: new Date().toISOString(),
  });
}
