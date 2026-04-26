import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { readRows } from "@/lib/knowledge-store";
import { getHeaders } from "@/lib/knowledge-store";
import type { KbTableName } from "@/lib/knowledge-csv";

const VALID_TABLES: KbTableName[] = [
  "rules",
  "consensus",
  "external-purchases",
  "old-items",
  "operations",
  "production-checks",
  "faq",
];

const TABLE_NAMES: Record<KbTableName, string> = {
  rules: "常规问题规则表",
  consensus: "共识解释表",
  "external-purchases": "外购清单表",
  "old-items": "旧品清单表",
  operations: "操作知识表",
  "production-checks": "出品检查标准表",
  faq: "常问沉积表",
};

export async function GET(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") as KbTableName;
  const type = searchParams.get("type") ?? "data";

  if (!table || !VALID_TABLES.includes(table)) {
    return NextResponse.json(
      { ok: false, message: `无效的表名，可选：${VALID_TABLES.join(", ")}` },
      { status: 400 },
    );
  }

  const filename =
    type === "template"
      ? `${TABLE_NAMES[table]}_导入模板.xlsx`
      : `${TABLE_NAMES[table]}_导出数据.xlsx`;

  const wb = XLSX.utils.book_new();

  if (type === "template") {
    const headers = getHeaders(table, []);
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    ws["!cols"] = headers.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws, TABLE_NAMES[table]);
  } else {
    const rows = await readRows(table);
    if (rows.length > 0) {
      const ws = XLSX.utils.json_to_sheet(rows);
      const headers = Object.keys(rows[0]);
      ws["!cols"] = headers.map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(wb, ws, TABLE_NAMES[table]);
    } else {
      const headers = getHeaders(table, []);
      const ws = XLSX.utils.aoa_to_sheet([headers]);
      ws["!cols"] = headers.map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(wb, ws, TABLE_NAMES[table]);
    }
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
