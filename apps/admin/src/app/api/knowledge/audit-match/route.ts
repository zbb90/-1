import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { parseAuditWorkbook, parseConsensusWorkbook } from "@/lib/audit-match-excel";
import { analyzeAuditConsensus } from "@/lib/audit-consensus-matcher";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  try {
    const formData = await request.formData();
    const auditFile = formData.get("auditFile");
    const consensusFile = formData.get("consensusFile");

    if (!(auditFile instanceof File) || !(consensusFile instanceof File)) {
      return NextResponse.json(
        { ok: false, message: "请同时上传稽核表与共识表 Excel 文件。" },
        { status: 400 },
      );
    }

    const [auditWorkbook, consensusWorkbook] = await Promise.all([
      auditFile.arrayBuffer().then(parseAuditWorkbook),
      consensusFile.arrayBuffer().then(parseConsensusWorkbook),
    ]);

    if (auditWorkbook.clauses.length === 0 || consensusWorkbook.entries.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message: "Excel 已读取，但未解析到有效数据，请检查表头和内容格式。",
          data: {
            warnings: [...auditWorkbook.warnings, ...consensusWorkbook.warnings],
          },
        },
        { status: 400 },
      );
    }

    const analysis = await analyzeAuditConsensus(
      auditWorkbook.clauses,
      consensusWorkbook.entries,
    );

    return NextResponse.json({
      ok: true,
      data: {
        ...analysis,
        auditSheets: auditWorkbook.sheetNames,
        consensusSheets: consensusWorkbook.sheetNames,
        warnings: [...auditWorkbook.warnings, ...consensusWorkbook.warnings],
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "稽核共识匹配失败",
      },
      { status: 500 },
    );
  }
}
