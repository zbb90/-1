import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { buildAuditMatchCsv, buildAuditMatchWorkbook } from "@/lib/audit-match-export";
import type { AuditConsensusAnalysis } from "@/lib/audit-match-types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as {
      format?: "xlsx" | "csv";
      selectedKeys?: string[];
      analysis?: AuditConsensusAnalysis;
    };

    if (!body.analysis) {
      return NextResponse.json(
        { ok: false, message: "缺少分析结果，无法导出。" },
        { status: 400 },
      );
    }

    if (body.format === "csv") {
      const csv = buildAuditMatchCsv(body.analysis);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            "attachment; filename*=UTF-8''audit_consensus_match_results.csv",
        },
      });
    }

    const buffer = buildAuditMatchWorkbook(body.analysis, body.selectedKeys);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          "attachment; filename*=UTF-8''audit_consensus_match_results.xlsx",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "导出匹配结果失败",
      },
      { status: 500 },
    );
  }
}
