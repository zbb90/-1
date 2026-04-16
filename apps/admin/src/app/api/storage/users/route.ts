import { NextRequest, NextResponse } from "next/server";
import { getAdminRequestContext } from "@/lib/admin-session";
import { repairUserIndexes } from "@/lib/user-store";

export async function POST(request: NextRequest) {
  const admin = await getAdminRequestContext(request);
  if (!admin.authorized || !admin.isLeader) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const result = await repairUserIndexes();
  return NextResponse.json({ ok: true, result });
}
