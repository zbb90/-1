import { NextRequest, NextResponse } from "next/server";
import { getAdminRequestContext } from "@/lib/admin-session";
import { repairReviewTaskStorage, type ReviewRepairSource } from "@/lib/review-pool";

export async function POST(request: NextRequest) {
  const admin = await getAdminRequestContext(request);
  if (!admin.authorized || !admin.isLeader) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  let source: ReviewRepairSource = "redis";
  try {
    const body = (await request.json()) as { source?: ReviewRepairSource };
    if (
      body?.source === "legacy" ||
      body?.source === "file" ||
      body?.source === "redis"
    ) {
      source = body.source;
    }
  } catch {
    // ignore invalid or empty body, keep safe default
  }

  const result = await repairReviewTaskStorage(source);
  return NextResponse.json({ ok: true, result });
}
