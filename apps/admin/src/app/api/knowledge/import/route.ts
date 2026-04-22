import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { importRows, readRows } from "@/lib/knowledge-store";
import type { KbTableName } from "@/lib/knowledge-csv";
import type { ConsensusRow, RuleRow } from "@/lib/types";
import { rebuildRuleVectorIndex, upsertConsensusVectors } from "@/lib/vector-store";
import {
  generateLinkSuggestions,
  isLinkSuggestionsEnabled,
} from "@/lib/link-suggester";

const VALID_TABLES: KbTableName[] = [
  "rules",
  "consensus",
  "external-purchases",
  "old-items",
  "operations",
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

    // 导入完成后，按表类型异步触发向量同步：
    // - rules：rebuild 整个规则向量集合（避免 append 出现重复 point id 漂移）
    // - consensus：upsert 全部启用项（B 档双源召回必须）
    // 失败仅记录日志，不影响导入成功状态；上线时建议管理员手动再点一次"重建索引"做兜底。
    if (table === "rules") {
      void (async () => {
        try {
          const allRules = (await readRows("rules")) as unknown as RuleRow[];
          const sync = await rebuildRuleVectorIndex(allRules);
          if (!sync.ok) {
            console.warn("[knowledge-import] rule vector rebuild skipped", sync.reason);
          }
        } catch (err) {
          console.warn("[knowledge-import] rule vector rebuild failed", err);
        }
      })();
    } else if (table === "consensus") {
      void (async () => {
        try {
          const allConsensus = (await readRows(
            "consensus",
          )) as unknown as ConsensusRow[];
          const enabled = allConsensus.filter((row) => row.状态 !== "停用");
          const sync = await upsertConsensusVectors(enabled);
          if (!sync.ok) {
            console.warn(
              "[knowledge-import] consensus vector sync skipped",
              sync.reason,
            );
          }
        } catch (err) {
          console.warn("[knowledge-import] consensus vector sync failed", err);
        }
      })();
    }

    // 导入 rules / consensus 成功后，若开启了 AI 关联建议功能，则后台异步触发一次增量扫描。
    // 失败被吞掉：这是导入流程的副作用，不能影响导入成功状态。
    if (isLinkSuggestionsEnabled() && (table === "rules" || table === "consensus")) {
      void generateLinkSuggestions({
        // 最大 60 对，避免一次性大批量导入时打爆 LLM 配额。
        maxPairs: 60,
      }).catch((err) => {
        console.warn("[knowledge-import] auto link suggest failed", err);
      });
    }

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
