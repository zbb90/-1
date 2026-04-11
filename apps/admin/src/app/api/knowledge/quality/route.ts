import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import {
  getKnowledgeQualityReport,
  getUnmatchedQueries,
} from "@/lib/knowledge-quality";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const report = getKnowledgeQualityReport();
  const unmatchedQueries = getUnmatchedQueries();

  return NextResponse.json({
    ...report,
    unmatchedQueries: unmatchedQueries.slice(-50),
    unmatchedTotal: unmatchedQueries.length,
  });
}
