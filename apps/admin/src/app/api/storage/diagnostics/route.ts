import { NextRequest, NextResponse } from "next/server";
import { getAdminRequestContext } from "@/lib/admin-session";
import { getKnowledgeStorageDiagnostics } from "@/lib/knowledge-store";
import { getReviewStorageDiagnostics } from "@/lib/review-pool";
import { getUserStorageDiagnostics } from "@/lib/user-store";

export async function GET(request: NextRequest) {
  const admin = await getAdminRequestContext(request);
  if (!admin.authorized || !admin.isLeader) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const [review, users, knowledge] = await Promise.all([
    getReviewStorageDiagnostics(),
    getUserStorageDiagnostics(),
    getKnowledgeStorageDiagnostics(),
  ]);

  return NextResponse.json({
    ok: true,
    review,
    users,
    knowledge,
  });
}
