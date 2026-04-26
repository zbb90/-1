import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { importRows, readRows } from "@/lib/knowledge-store";
import type { KbTableName } from "@/lib/knowledge-csv";
import type { ConsensusRow, FaqRow, RuleRow } from "@/lib/types";
import {
  rebuildRuleVectorIndex,
  upsertConsensusVectors,
  upsertFaqVectors,
} from "@/lib/vector-store";
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
  "faq",
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

function normalizeCell(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function buildMergedCellValueGetter(ws: XLSX.WorkSheet) {
  const mergeAnchors = new Map<string, string>();
  for (const merge of ws["!merges"] ?? []) {
    const anchor = ws[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })]?.v;
    const anchorValue = normalizeCell(anchor);
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        mergeAnchors.set(`${r}:${c}`, anchorValue);
      }
    }
  }

  return (rowIndex: number, colIndex: number) => {
    const cell = ws[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })]?.v;
    const directValue = normalizeCell(cell);
    return directValue || mergeAnchors.get(`${rowIndex}:${colIndex}`) || "";
  };
}

function buildProductionChecklistKeywords(
  section: string,
  product: string,
  category: string,
  checkKind: string,
  detail: string,
) {
  const fragments = [
    product,
    category,
    checkKind,
    section,
    ...detail
      .split(/[，,。；;：:、/\\()（）[\]【】\s]+/g)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && item.length <= 12)
      .slice(0, 8),
  ].filter(Boolean);
  return [...new Set(fragments)].join("|");
}

function parseProductionChecklistExcel(
  buffer: ArrayBuffer,
  sourceFileName: string,
): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const rows: Record<string, string>[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws?.["!ref"]) continue;

    const range = XLSX.utils.decode_range(ws["!ref"]);
    const getValue = buildMergedCellValueGetter(ws);
    let section = "";

    for (let r = range.s.r; r <= range.e.r; r++) {
      const firstCol = getValue(r, 0);
      const secondCol = getValue(r, 1);
      const thirdCol = getValue(r, 2);
      const detail = getValue(r, 3);
      const explanation = getValue(r, 6);

      if (/产品检核表/.test(firstCol)) {
        section = firstCol.includes("调饮")
          ? "调饮"
          : firstCol.includes("后厨")
            ? "后厨"
            : firstCol;
        continue;
      }

      if (
        firstCol === "饮品" ||
        firstCol === "检查人" ||
        secondCol === "分类" ||
        detail === "检核点详情" ||
        !detail
      ) {
        continue;
      }

      const product = firstCol;
      const category = secondCol;
      const checkKind = thirdCol || category;
      if (!product || !category || !checkKind) continue;

      rows.push({
        资料类型: "出品操作检查扣分标准",
        标题: `${product}｜${checkKind}｜${detail.replace(/\n+/g, " / ")}`,
        适用对象: product,
        关键词: buildProductionChecklistKeywords(
          section,
          product,
          category,
          checkKind,
          detail,
        ),
        操作内容: detail,
        检核要点: [
          `检查区域：${section || sheetName}`,
          `扣分分类：${category}`,
          `检核类型：${checkKind}`,
          `检查点：${detail}`,
        ].join("\n"),
        解释说明: explanation,
        来源文件: sourceFileName,
        备注: `自动从出品操作检查表导入；sheet=${sheetName}；row=${r + 1}`,
        状态: "启用",
        tags: ["出品操作", "扣分标准", section, category, checkKind]
          .filter(Boolean)
          .join(","),
      });
    }
  }

  return rows;
}

function looksLikeProductionChecklist(rows: Record<string, string>[]) {
  const firstRowsText = rows
    .slice(0, 8)
    .map((row) => [...Object.keys(row), ...Object.values(row)].join(" "))
    .join(" ");
  return /产品检核表|出品操作检查表|检核点详情|饮品/.test(firstRowsText);
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
    const parsedRows = parseExcel(buffer);
    const rows =
      table === "operations" && looksLikeProductionChecklist(parsedRows)
        ? parseProductionChecklistExcel(buffer, file.name)
        : parsedRows;
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
    } else if (table === "faq") {
      void (async () => {
        try {
          const allFaq = (await readRows("faq")) as unknown as FaqRow[];
          const enabled = allFaq.filter((row) => row.状态 !== "停用");
          const sync = await upsertFaqVectors(enabled);
          if (!sync.ok) {
            console.warn("[knowledge-import] faq vector sync skipped", sync.reason);
          }
        } catch (err) {
          console.warn("[knowledge-import] faq vector sync failed", err);
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
      message:
        `成功导入 ${result.added} 条，当前共 ${result.total} 条记录。` +
        (result.skipped > 0 ? `已跳过 ${result.skipped} 条空白或无效行。` : ""),
      data: result,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "导入失败" },
      { status: 500 },
    );
  }
}
