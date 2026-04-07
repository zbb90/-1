import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { importRows } from "@/lib/knowledge-store";
import type { KbTableName } from "@/lib/knowledge-csv";

const VALID_TABLES: KbTableName[] = [
  "rules",
  "consensus",
  "external-purchases",
  "old-items",
];

function parseExcel(buffer: ArrayBuffer): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];

  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return raw.map((row) => {
    const obj: Record<string, string> = {};
    for (const [key, val] of Object.entries(row)) {
      obj[key] = String(val ?? "").trim();
    }
    return obj;
  });
}

export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  try {
    const formData = await request.formData();
    const table = formData.get("table") as string;
    const mode = (formData.get("mode") as string) || "append";
    const file = formData.get("file") as File | null;

    if (!table || !VALID_TABLES.includes(table as KbTableName)) {
      return NextResponse.json(
        { ok: false, message: `无效的表名，可选：${VALID_TABLES.join(", ")}` },
        { status: 400 },
      );
    }

    if (!file) {
      return NextResponse.json(
        { ok: false, message: "请上传 Excel (.xlsx) 文件。" },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();
    const rows = parseExcel(buffer);
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, message: "Excel 文件为空或格式不正确，请按模板格式填写后重试。" },
        { status: 400 },
      );
    }

    const result = await importRows(
      table as KbTableName,
      rows,
      mode as "append" | "replace",
    );

    return NextResponse.json({
      ok: true,
      message: `成功导入 ${result.added} 条，当前共 ${result.total} 条记录。`,
      data: result,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "导入失败" },
      { status: 500 },
    );
  }
}
