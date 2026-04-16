import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { getKnowledgeHealthReport } from "@/lib/knowledge-health";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  try {
    const report = await getKnowledgeHealthReport();
    return NextResponse.json({ ok: true, data: report });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "读取健康度失败" },
      { status: 500 },
    );
  }
}
